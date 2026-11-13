'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/components/idioma';
import { BillCard, BudgetBar, Sticker } from '@/components/lucas-ui';
import { MonedaProvider } from '@/components/moneda';
import { Segmento } from '@/components/segmento';
import { monthName } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { LOCALE } from '@/lib/i18n';
import { DECIMALES, deCampo, dinero, type Moneda } from '@/lib/moneda';
import { EJEMPLO_INFORME, type Escenario, type Evento, type FrecuenciaPago, pagosDelSueldo, proyectar } from '@/lib/proyeccion';
import { createClient } from '@/utils/supabase/client';
import { ComoLoCalcula } from './como-lo-calcula';
import { type Entrada, Entradas } from './entradas';
import { GraficaSaldo } from './grafica-saldo';

interface Props {
  accountId: string;
  today: string;
  month: string;
  spent: number;
  budget: number | null;
  categories: { id: string; name: string; total: number; budget: number | null }[];
  ritmo: number;
  diasRitmo: number;
  puedeEditar: boolean;
  moneda: Moneda;
  /** Lo que entró este mes (migración 810) */
  entradas: Entrada[];
  usuario: string;
}

/** Un ingreso o un gasto grande, como lo escribe la persona: fecha y monto */
interface EventoForm {
  id: number;
  tipo: 'ingreso' | 'gasto';
  fecha: string;
  monto: number;
  reinicia: boolean;
}

interface Form {
  saldo: number;
  gastoHoy: number;
  gastoBase: number;
  k: number;
  umbral: number;
  eventos: EventoForm[];
  /** Lo que gana el hogar al mes; sus pagos entran solos como eventos */
  sueldo: number;
  frecuencia: FrecuenciaPago;
  diaPago: number;
  reiniciaPago: boolean;
}

const HORIZONTE = 90;

export function diasEntre(desde: string, hasta: string) {
  return Math.round((new Date(`${hasta}T12:00:00`).getTime() - new Date(`${desde}T12:00:00`).getTime()) / 86_400_000);
}

function masDias(iso: string, n: number) {
  const f = new Date(`${iso}T12:00:00`);
  f.setDate(f.getDate() + n);
  return f.toISOString().slice(0, 10);
}

/** Redondea a lo que se escribe a mano: mil pesos (o un dólar) */
const redondo = (n: number, moneda: Moneda) => {
  const paso = moneda === 'COP' || moneda === 'CLP' ? 1000 : 10 ** DECIMALES[moneda];
  return Math.max(0, Math.round(n / paso) * paso);
};

const entro = (p: Props) => p.entradas.reduce((s, e) => s + e.amount_cop, 0);

function inicial(p: Props): Form {
  // Con presupuesto: lo que queda de él; sin presupuesto: lo que entró menos lo que salió este mes
  const quedan = p.budget ? p.budget - p.spent : entro(p) - p.spent;
  const saldo = redondo(Math.max(quedan, 0), p.moneda);
  const gastoHoy = redondo(p.ritmo, p.moneda);
  return {
    saldo,
    gastoHoy,
    // En el informe el gasto base fue el 40 % del gasto inicial (40.000 de 100.000)
    gastoBase: redondo(gastoHoy * 0.4, p.moneda),
    k: 0.03,
    umbral: redondo(saldo * 0.15, p.moneda),
    eventos: [],
    sueldo: 0,
    frecuencia: 'quincenal',
    diaPago: 30,
    reiniciaPago: true,
  };
}

export function PresupuestoScreen(props: Props) {
  return (
    <MonedaProvider moneda={props.moneda}>
      <Pantalla {...props} />
    </MonedaProvider>
  );
}

function Pantalla(p: Props) {
  const t = useT();
  const fmt = (n: number) => dinero(n, p.moneda, t.idioma);
  const clave = `luks-proyeccion-${p.accountId}`;
  const [form, setForm] = useState<Form>(() => inicial(p));
  const [vista, setVista] = useState<'saldo' | 'gasto'>('saldo');

  // Lo último que la persona escribió en este aparato (solo una comodidad)
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al abrir la pantalla; después manda lo que escriba
  useEffect(() => {
    try {
      const guardado = localStorage.getItem(clave);
      if (guardado) setForm({ ...inicial(p), ...JSON.parse(guardado) });
    } catch {}
  }, [clave]);
  useEffect(() => {
    try {
      localStorage.setItem(clave, JSON.stringify(form));
    } catch {}
  }, [clave, form]);

  const cambiar = (parcial: Partial<Form>) => setForm((f) => ({ ...f, ...parcial }));

  const escenario: Escenario = useMemo(
    () => ({
      saldo: form.saldo,
      gastoHoy: form.gastoHoy,
      gastoBase: Math.min(form.gastoBase, form.gastoHoy),
      k: form.k,
      umbral: form.umbral,
      eventos: [
        ...pagosDelSueldo(p.today, form.sueldo, form.frecuencia, form.diaPago, form.reiniciaPago, HORIZONTE),
        ...form.eventos
          .filter((e) => e.monto > 0 && e.fecha >= p.today)
          .map<Evento>((e) => ({
            dia: diasEntre(p.today, e.fecha),
            monto: e.tipo === 'ingreso' ? e.monto : -e.monto,
            reinicia: e.tipo === 'ingreso' && e.reinicia,
          })),
      ],
    }),
    [form, p.today],
  );
  const listo = escenario.saldo > 0 && escenario.gastoHoy > 0;
  const r = useMemo(() => (listo ? proyectar(escenario, HORIZONTE) : null), [escenario, listo]);

  const fecha = (dia: number) =>
    new Date(`${masDias(p.today, Math.floor(dia))}T12:00:00`).toLocaleDateString(LOCALE[t.idioma], { weekday: 'short', day: 'numeric', month: 'short' });
  const dias = (dia: number) => dia.toLocaleString(LOCALE[t.idioma], { maximumFractionDigits: 1 });

  const ejemplo = () =>
    setForm({
      saldo: EJEMPLO_INFORME.saldo,
      gastoHoy: EJEMPLO_INFORME.gastoHoy,
      gastoBase: EJEMPLO_INFORME.gastoBase,
      k: EJEMPLO_INFORME.k,
      umbral: EJEMPLO_INFORME.umbral,
      eventos: [],
      sueldo: 0,
      frecuencia: form.frecuencia,
      diaPago: form.diaPago,
      reiniciaPago: form.reiniciaPago,
    });

  // Sin presupuesto, el saldo de hoy sale de lo que ganan menos lo que ya gastaron este mes
  const conSueldo = !p.budget && form.sueldo > 0 ? redondo(Math.max(form.sueldo - p.spent, 0), p.moneda) : null;

  const nuevoEvento = (tipo: EventoForm['tipo']) =>
    cambiar({
      eventos: [
        ...form.eventos,
        {
          id: Date.now(),
          tipo,
          fecha: masDias(p.today, tipo === 'ingreso' ? 15 : 7),
          monto: tipo === 'ingreso' ? form.gastoHoy * 10 : form.gastoHoy * 3,
          reinicia: tipo === 'ingreso',
        },
      ],
    });
  const editarEvento = (id: number, parcial: Partial<EventoForm>) => cambiar({ eventos: form.eventos.map((e) => (e.id === id ? { ...e, ...parcial } : e)) });

  const mitad = form.k > 0 ? Math.log(2) / form.k : null;

  return (
    <div className="hd pr">
      <div className="hd-main">
        <header className="pr-head">
          <h1 className="lu-display">{t('Presupuesto')}</h1>
          <span className="lu-small lu-muted">{t('Lo que entra, lo que sale y hasta cuándo les alcanza')}</span>
        </header>

        <BillCard label={t('Saldo de hoy')} amount={form.saldo} moneda={p.moneda} roll>
          <span>{t('Este mes entró {entro} y salió {salio}', { entro: fmt(entro(p)), salio: fmt(p.spent) })}</span>
          <span>{t('Gastan {monto} al día', { monto: fmt(form.gastoHoy) })}</span>
          {form.sueldo > 0 && <span>{t('Ganan {monto} al mes', { monto: fmt(form.sueldo) })}</span>}
        </BillCard>

        {r ? (
          <section className="pr-card pr-result" aria-labelledby="pr-res" aria-live="polite">
            {r.alerta ? (
              <Sticker tone="alerta" className="pr-sticker" rotate={5} />
            ) : (
              <Sticker tone="confirmado" className="pr-sticker" rotate={5}>
                {t('Alcanza')}
              </Sticker>
            )}
            <h2 className="lu-title" id="pr-res">
              {t('¿Les alcanza?')}
            </h2>
            {r.alerta ? (
              <div className="pr-alerta">
                <span className="lu-label">{t('Alerta')}</span>
                <strong className="lu-title">
                  {r.alerta.dia === 0
                    ? t('Ya están por debajo de {monto}', { monto: fmt(form.umbral) })
                    : t('Llegarían a {monto} el {fecha}', { monto: fmt(form.umbral), fecha: fecha(r.alerta.dia) })}
                </strong>
                {r.alerta.dia > 0 && <span className="lu-small">{t('en {n} días, aun bajando el gasto poco a poco', { n: dias(r.alerta.dia) })}</span>}
              </div>
            ) : (
              <div className="pr-alerta is-bien">
                <strong className="lu-title">{t('No bajan de {monto} en los próximos {n} días', { monto: fmt(form.umbral), n: HORIZONTE })}</strong>
              </div>
            )}

            <dl className="pr-datos">
              <div>
                <dt className="lu-label">{t('Se acabaría')}</dt>
                <dd className="lu-num">
                  {r.agotamiento ? `${fecha(r.agotamiento.dia)} · ${t('día {n}', { n: dias(r.agotamiento.dia) })}` : t('No en {n} días', { n: HORIZONTE })}
                </dd>
              </div>
              <div>
                <dt className="lu-label">{t('Gastando siempre {monto}', { monto: fmt(form.gastoHoy) })}</dt>
                <dd className="lu-num">{r.alertaConstante ? t('alerta el día {n}', { n: dias(r.alertaConstante.dia) }) : t('sin alerta')}</dd>
              </div>
              {r.alerta && r.agotamiento && r.agotamiento.dia > r.alerta.dia && (
                <div>
                  <dt className="lu-label">{t('Margen después de la alerta')}</dt>
                  <dd className="lu-num">{t('{n} días', { n: dias(r.agotamiento.dia - r.alerta.dia) })}</dd>
                </div>
              )}
            </dl>

            <Segmento
              label={t('Qué ver en la gráfica')}
              value={vista}
              onChange={setVista}
              opciones={[
                { value: 'saldo', label: t('Saldo') },
                { value: 'gasto', label: t('Gasto diario') },
              ]}
            />
            <GraficaSaldo e={escenario} r={r} vista={vista} horizonte={HORIZONTE} moneda={p.moneda} fecha={fecha} />
            <p className="lu-small lu-muted pr-nota">
              {t('Es un escenario con sus datos, no una promesa: si cambian el gasto o llega plata que no está aquí, cambia la fecha.')}
            </p>
          </section>
        ) : (
          <p className="lu-small lu-muted pr-card">{t('Escriban el saldo de hoy y el gasto diario para ver hasta cuándo les alcanza.')}</p>
        )}

        {r && <ComoLoCalcula e={escenario} r={r} moneda={p.moneda} />}
      </div>

      <aside className="hd-aside">
        <Entradas accountId={p.accountId} today={p.today} entradas={p.entradas} usuario={p.usuario} administra={p.puedeEditar} moneda={p.moneda} />

        <section className="pr-card" aria-labelledby="pr-datos">
          <div className="hd-sec">
            <h2 className="lu-title" id="pr-datos">
              {t('¿Con qué cuentan?')}
            </h2>
            <button type="button" className="lu-btn lu-btn--ghost lu-btn--sm" onClick={ejemplo}>
              {t('Usar el ejemplo del informe')}
            </button>
          </div>
          <div className="pr-sueldo">
            <div className="pr-grid">
              <CampoPlata
                id="pr-sueldo"
                label={t('¿Cuánto ganan al mes?')}
                ayuda={t('Entre todos los del hogar, después de descuentos')}
                value={form.sueldo}
                moneda={p.moneda}
                onChange={(sueldo) => cambiar({ sueldo })}
              />
              <div className="lu-field">
                <label className="lu-label" htmlFor="pr-frecuencia">
                  {t('Les pagan')}
                </label>
                <div className="pr-pago">
                  <select id="pr-frecuencia" value={form.frecuencia} onChange={(e) => cambiar({ frecuencia: e.target.value as FrecuenciaPago })}>
                    <option value="quincenal">{t('cada quincena (15 y fin de mes)')}</option>
                    <option value="mensual">{t('una vez al mes')}</option>
                  </select>
                  {form.frecuencia === 'mensual' && (
                    <input
                      type="number"
                      min={1}
                      max={31}
                      aria-label={t('Día de pago')}
                      value={form.diaPago}
                      onChange={(e) => cambiar({ diaPago: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })}
                    />
                  )}
                </div>
                <label className="pr-ev__reinicia lu-small">
                  <input type="checkbox" checked={form.reiniciaPago} onChange={(e) => cambiar({ reiniciaPago: e.target.checked })} />
                  {t('Cuando les pagan vuelven a gastar como hoy')}
                </label>
              </div>
            </div>
          </div>

          <div className="pr-grid">
            <CampoPlata
              id="pr-saldo"
              label={t('Saldo de hoy')}
              ayuda={t('Lo que tienen para gastar desde hoy')}
              value={form.saldo}
              moneda={p.moneda}
              onChange={(saldo) => cambiar({ saldo })}
            >
              {conSueldo != null && conSueldo !== form.saldo && (
                <button
                  type="button"
                  className="pr-sugerencia lu-small"
                  onClick={() => cambiar({ saldo: conSueldo, umbral: redondo(conSueldo * 0.15, p.moneda) })}
                >
                  {t('Usar lo que ganan menos lo gastado este mes: {monto}', { monto: fmt(conSueldo) })}
                </button>
              )}
            </CampoPlata>
            <CampoPlata
              id="pr-gasto"
              label={t('Gasto diario de hoy')}
              ayuda={t('Promedio de los últimos {n} días: {monto}', { n: p.diasRitmo, monto: fmt(p.ritmo) })}
              value={form.gastoHoy}
              moneda={p.moneda}
              onChange={(gastoHoy) => cambiar({ gastoHoy })}
            />
            <CampoPlata
              id="pr-base"
              label={t('Gasto que no se recorta')}
              ayuda={t('Arriendo, servicios, mercado básico: lo de todos los días')}
              value={form.gastoBase}
              moneda={p.moneda}
              onChange={(gastoBase) => cambiar({ gastoBase })}
            />
            <CampoPlata
              id="pr-umbral"
              label={t('Avísenme al llegar a')}
              ayuda={t('El saldo mínimo que no quieren tocar')}
              value={form.umbral}
              moneda={p.moneda}
              onChange={(umbral) => cambiar({ umbral })}
            />
          </div>

          <div className="lu-field pr-k">
            <div className="lu-field__top">
              <label className="lu-label" htmlFor="pr-k">
                {t('¿Qué tan rápido se ajustan?')}
              </label>
              <span className="lu-num lu-small">
                k = {form.k.toLocaleString(LOCALE[t.idioma], { minimumFractionDigits: 3 })} {t('por día')}
              </span>
            </div>
            <input id="pr-k" type="range" min={0} max={0.08} step={0.005} value={form.k} onChange={(e) => cambiar({ k: Number(e.target.value) })} />
            <div className="pr-k__ends lu-small lu-muted">
              <span>{t('Siguen igual')}</span>
              <span>{t('Recortan rápido')}</span>
            </div>
            <span className="lu-small lu-muted">
              {mitad
                ? t('El gasto de más se reduce a la mitad en {n} días.', { n: Math.round(mitad) })
                : t('Con k = 0 el gasto no cambia: es el modelo de gasto constante.')}
            </span>
          </div>
        </section>

        <section className="pr-card" aria-label={t('Lo que viene')}>
          <div className="pr-eventos">
            <span className="lu-label">{t('Lo que viene')}</span>
            {form.eventos.length === 0 && (
              <p className="lu-small lu-muted pr-vacio">{t('Agreguen la quincena, una prima o un pago grande que ya saben que viene.')}</p>
            )}
            <ul>
              {form.eventos.map((e) => (
                <li key={e.id} className={`pr-ev pr-ev--${e.tipo}`}>
                  <select aria-label={t('Tipo')} value={e.tipo} onChange={(x) => editarEvento(e.id, { tipo: x.target.value as EventoForm['tipo'] })}>
                    <option value="ingreso">{t('Llega plata')}</option>
                    <option value="gasto">{t('Gasto grande')}</option>
                  </select>
                  <input type="date" aria-label={t('Fecha')} min={p.today} value={e.fecha} onChange={(x) => editarEvento(e.id, { fecha: x.target.value })} />
                  <input
                    className="lu-num"
                    inputMode="numeric"
                    aria-label={t('Monto')}
                    value={dinero(e.monto, p.moneda, t.idioma)}
                    onChange={(x) => editarEvento(e.id, { monto: deCampo(x.target.value) })}
                  />
                  <button
                    type="button"
                    className="pr-ev__x"
                    aria-label={t('Quitar')}
                    onClick={() => cambiar({ eventos: form.eventos.filter((x) => x.id !== e.id) })}
                  >
                    ×
                  </button>
                  {e.tipo === 'ingreso' && (
                    <label className="pr-ev__reinicia lu-small">
                      <input type="checkbox" checked={e.reinicia} onChange={(x) => editarEvento(e.id, { reinicia: x.target.checked })} />
                      {t('Ese día vuelven a gastar como hoy')}
                    </label>
                  )}
                </li>
              ))}
            </ul>
            <div className="pr-ev__add">
              <button type="button" className="lu-btn lu-btn--secondary lu-btn--sm" onClick={() => nuevoEvento('ingreso')}>
                + {t('Llega plata')}
              </button>
              <button type="button" className="lu-btn lu-btn--secondary lu-btn--sm" onClick={() => nuevoEvento('gasto')}>
                + {t('Gasto grande')}
              </button>
            </div>
          </div>
        </section>

        <PresupuestoMes {...p} />
      </aside>
    </div>
  );
}

function CampoPlata({
  id,
  label,
  ayuda,
  value,
  moneda,
  onChange,
  children,
}: {
  id: string;
  label: string;
  ayuda: string;
  value: number;
  moneda: Moneda;
  onChange: (n: number) => void;
  children?: React.ReactNode;
}) {
  const { idioma } = useT();
  return (
    <div className="lu-field lu-field--num">
      <label className="lu-label" htmlFor={id}>
        {label}
      </label>
      <input id={id} inputMode="numeric" value={dinero(value, moneda, idioma)} onChange={(e) => onChange(deCampo(e.target.value))} />
      <span className="lu-small lu-muted">{ayuda}</span>
      {children}
    </div>
  );
}

/** El presupuesto total del mes: verlo y, si administra, ponerlo o cambiarlo */
function PresupuestoMes({ accountId, month, spent, budget, categories, puedeEditar, moneda }: Props) {
  const t = useT();
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [monto, setMonto] = useState(budget ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const mes = monthName(month, t.idioma);

  async function guardar() {
    if (monto <= 0) return;
    setGuardando(true);
    setError(null);
    const supabase = createClient();
    const { data: existe, error: e1 } = await supabase
      .from('budgets')
      .select('id')
      .eq('account_id', accountId)
      .is('category_id', null)
      .eq('period', month)
      .maybeSingle();
    const { error: e2 } = e1
      ? { error: e1 }
      : existe
        ? await supabase.from('budgets').update({ amount_cop: monto, updated_at: new Date().toISOString() }).eq('id', existe.id)
        : await supabase.from('budgets').insert({ account_id: accountId, period: month, amount_cop: monto });
    setGuardando(false);
    if (e2) return setError(humanError(e2, t.idioma));
    setEditando(false);
    router.refresh();
  }

  return (
    <section className="pr-card" aria-labelledby="pr-mes">
      <div className="hd-sec">
        <h2 className="lu-title" id="pr-mes">
          {t('Presupuesto de {mes}', { mes: t.idioma === 'en' ? mes : mes.toLowerCase() })}
        </h2>
        {puedeEditar && !editando && (
          <button type="button" className="lu-btn lu-btn--ghost lu-btn--sm" onClick={() => setEditando(true)}>
            {budget ? t('Cambiar') : t('Ponerlo')}
          </button>
        )}
      </div>
      {editando ? (
        <div className="pr-edit">
          <div className="lu-field lu-field--num">
            <label className="lu-label" htmlFor="pr-presupuesto">
              {t('¿Cuánto quieren gastar este mes?')}
            </label>
            <input id="pr-presupuesto" inputMode="numeric" value={dinero(monto, moneda, t.idioma)} onChange={(e) => setMonto(deCampo(e.target.value))} />
          </div>
          <div className="pr-edit__acciones">
            <button type="button" className="lu-btn lu-btn--primary lu-btn--sm" disabled={guardando || monto <= 0} onClick={guardar}>
              {t('Guardar')}
            </button>
            <button type="button" className="lu-btn lu-btn--ghost lu-btn--sm" onClick={() => setEditando(false)}>
              {t('Cancelar')}
            </button>
          </div>
          {error && (
            <p className="lu-small pr-error" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : budget ? (
        <div className="hd-blist">
          <BudgetBar name={t('Total del mes')} spent={spent} budget={budget} category={false} />
          {categories.map((c) => (
            <BudgetBar key={c.id} name={c.name} spent={c.total} budget={c.budget as number} />
          ))}
        </div>
      ) : (
        <p className="lu-small lu-muted" style={{ margin: 0 }}>
          {puedeEditar
            ? t('Pongan cuánto quieren gastar este mes y Luks calcula hasta cuándo les alcanza.')
            : t('Quien administra la cuenta todavía no ha puesto el presupuesto del mes.')}
        </p>
      )}
    </section>
  );
}
