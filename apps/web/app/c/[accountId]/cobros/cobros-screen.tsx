'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { CampoTelefono } from '@/components/campo-telefono';
import { lanzarChispas } from '@/components/chispas';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useT } from '@/components/idioma';
import { Avatar, Button, Field } from '@/components/lucas-ui';
import { useMoneda } from '@/components/moneda';
import { humanError } from '@/lib/errors';
import { deCampo, dinero } from '@/lib/moneda';
import type { Pago, Role } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

/** Un cobro de Chepito (migración 710) */
interface Cobro {
  id: string;
  monto: number;
  concepto: string;
  telefono: string;
  avisos: number;
  avisado_at: string | null;
  pagado_at: string | null;
  pagado_por: 'acreedor' | 'deudor' | null;
  no_debe_at: string | null;
  detenido_at: string | null;
  detenido_por: 'acreedor' | 'no_me_escribas' | null;
  created_at: string;
  deudor: { display_name: string } | null;
}

/** Chispas en el centro del botón que envió el formulario (como en el perfil) */
function chispasEn(boton: Element | null) {
  if (!boton) return;
  const r = boton.getBoundingClientRect();
  lanzarChispas({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, currentTarget: null });
}

/** «573001234567» → «+57 300 123 4567» */
const telefonoBonito = (t: string) => (/^573\d{9}$/.test(t) ? `+57 ${t.slice(2, 5)} ${t.slice(5, 8)} ${t.slice(8)}` : `+${t}`);
const abierto = (c: Cobro) => !c.pagado_at && !c.no_debe_at && !c.detenido_at && c.avisos < 4;

/**
 * Chepito: a quién le cobra Mister Luks. Quien administra la cuenta dice quién
 * le debe, su WhatsApp, cuánto y por qué (todo obligatorio) y, si quiere, cómo
 * le pagan (queda en su perfil). Mister Luks le escribe en horario de cobranza
 * y se lo recuerda cada 2 días, como mucho 4 veces; aquí se ve cómo va cada uno.
 */
export function CobrosScreen({ accountId, myRole, closed, pago }: { accountId: string; myRole: Role; closed: boolean; pago: Pago }) {
  const t = useT();
  const [supabase] = useState(() => createClient());
  const queryClient = useQueryClient();
  const isAdmin = myRole !== 'member' && !closed;

  const cobros = useQuery({
    queryKey: ['cobros', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cobros')
        .select(
          'id, monto, concepto, telefono, avisos, avisado_at, pagado_at, pagado_por, no_debe_at, detenido_at, detenido_por, created_at, deudor:people!cobros_deudor_person_id_fkey(display_name)',
        )
        .eq('account_id', accountId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as Cobro[];
    },
  });
  const refrescar = () => queryClient.invalidateQueries({ queryKey: ['cobros', accountId] });
  const lista = cobros.data ?? [];

  return (
    <div className="ch">
      <header className="ch-head">
        <h1 className="lu-display">{t('Cobros')}</h1>
        <p className="lu-small lu-muted">
          {t(
            'Chepito: Mister Luks le escribe por WhatsApp a quien te debe, se presenta, le dice cuánto y por qué, y se lo recuerda cada 2 días (hasta 4 veces). Solo en horario de cobranza: lunes a viernes de 8 a. m. a 7 p. m. y sábados hasta las 3 p. m.',
          )}
        </p>
      </header>

      {isAdmin && <NuevoCobro accountId={accountId} pagoInicial={pago} onCreado={refrescar} />}

      <section className="ch-lista" aria-labelledby="ch-lista-t">
        <h2 id="ch-lista-t" className="lu-title">
          {t('A quién le cobras')}
        </h2>
        {cobros.isLoading ? (
          <p className="lu-small lu-muted">{t('Cargando…')}</p>
        ) : cobros.error ? (
          <p className="lu-error" role="alert">
            {humanError(cobros.error)}
          </p>
        ) : lista.length === 0 ? (
          <p className="lu-small lu-muted">{t('Todavía no le cobras a nadie. Cuando alguien te deba, ponlo arriba.')}</p>
        ) : (
          <ul className="ch-items">
            {lista.map((c) => (
              <CobroItem key={c.id} c={c} isAdmin={isAdmin} verTelefono={myRole !== 'member'} onCambio={refrescar} />
            ))}
          </ul>
        )}
      </section>

      <p className="lu-small lu-muted ch-nota">
        {t(
          'Si la persona le escribe a Mister Luks «no me escribas», no le vuelve a escribir. Si dice «ya pagué» o «no le debo», deja de cobrarle y te avisa por WhatsApp.',
        )}
      </p>
    </div>
  );
}

/** El formulario: los cuatro datos son obligatorios; cómo te pagan, opcional (se guarda en el perfil) */
function NuevoCobro({ accountId, pagoInicial, onCreado }: { accountId: string; pagoInicial: Pago; onCreado: () => void }) {
  const t = useT();
  const moneda = useMoneda();
  const id = useId();
  const [supabase] = useState(() => createClient());
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState<{ numero: string | null; escribio: boolean }>({ numero: null, escribio: false });
  const [monto, setMonto] = useState(0);
  const [concepto, setConcepto] = useState('');
  const inicial = { nequi: pagoInicial.nequi ?? '', daviplata: pagoInicial.daviplata ?? '', llave: pagoInicial.llave ?? '' };
  const [pago, setPago] = useState(inicial);
  const [vez, setVez] = useState(0);
  const [intento, setIntento] = useState(false);
  const [estado, setEstado] = useState<{ busy?: boolean; error?: string; ok?: string }>({});

  const faltas = {
    nombre: !nombre.trim() ? t('Escribe a quién le cobras') : null,
    telefono: !telefono.numero ? (telefono.escribio ? t('Revisa el número') : t('Escribe su WhatsApp')) : null,
    monto: monto <= 0 ? t('Escribe cuánto te debe') : null,
    concepto: concepto.trim().length < 2 ? t('Escribe por qué te debe') : null,
  };
  const cambioPago = (Object.keys(pago) as (keyof typeof pago)[]).some((k) => pago[k].trim() !== inicial[k]);

  const cobrar = async (e: FormEvent) => {
    e.preventDefault();
    setIntento(true);
    if (Object.values(faltas).some(Boolean)) return;
    const boton = (e.nativeEvent as SubmitEvent).submitter ?? null;
    setEstado({ busy: true });
    // Cómo le pagan va primero: así el primer aviso ya lo lleva
    if (cambioPago) {
      const { error } = await supabase.rpc('set_como_me_pagan', { p_llave: pago.llave, p_nequi: pago.nequi, p_daviplata: pago.daviplata });
      if (error) return setEstado({ error: humanError(error) });
    }
    const { error } = await supabase.rpc('crear_cobro', {
      p_account_id: accountId,
      p_nombre: nombre.trim(),
      p_telefono: telefono.numero,
      p_monto: monto,
      p_concepto: concepto.trim(),
    });
    if (error) return setEstado({ error: humanError(error) });
    chispasEn(boton);
    setEstado({ ok: t('Listo: Mister Luks le escribe a {nombre} en horario de cobranza.', { nombre: nombre.trim() }) });
    setNombre('');
    setMonto(0);
    setConcepto('');
    setIntento(false);
    // El campo del teléfono se vacía montándolo otra vez
    setVez((v) => v + 1);
    onCreado();
  };

  const error = (msg: string | null) =>
    intento && msg ? (
      <p className="lu-field-error" role="alert">
        {msg}
      </p>
    ) : null;

  return (
    <form className="ch-form lu-card" onSubmit={cobrar} noValidate aria-labelledby={`${id}-t`}>
      <h2 id={`${id}-t`} className="lu-title">
        {t('Nuevo cobro')}
      </h2>
      <Field label={t('¿Quién te debe?')} id={`${id}-nombre`} value={nombre} onChange={setNombre} />
      {error(faltas.nombre)}
      <div className="lu-field">
        <label className="lu-label" htmlFor={`${id}-tel`}>
          {t('Su WhatsApp')}
        </label>
        <CampoTelefono key={vez} id={`${id}-tel`} onNumero={(numero, escribio) => setTelefono({ numero, escribio })} />
      </div>
      {error(faltas.telefono)}
      <Field
        label={t('¿Cuánto te debe?')}
        id={`${id}-monto`}
        num
        inputMode="numeric"
        value={monto ? dinero(monto, moneda, t.idioma) : ''}
        onChange={(v) => setMonto(deCampo(v))}
      />
      {error(faltas.monto)}
      <Field label={t('¿Por qué te debe? (p. ej. la boleta del concierto)')} id={`${id}-por`} value={concepto} onChange={setConcepto} />
      {error(faltas.concepto)}

      <fieldset className="ch-pago">
        <legend className="lu-label">{t('¿Le mando cómo pagarte? (opcional, queda en tu perfil)')}</legend>
        {(
          [
            ['nequi', 'Nequi', '300 123 4567'],
            ['daviplata', 'Daviplata', '300 123 4567'],
            ['llave', t('Llave Bre-B'), t('Tu celular, correo, cédula o @alias')],
          ] as const
        ).map(([k, etiqueta, ayuda]) => (
          <label key={k} className="pf-pago__campo" htmlFor={`${id}-${k}`}>
            <span className="lu-label">{etiqueta}</span>
            <input
              id={`${id}-${k}`}
              className="pf-input"
              value={pago[k]}
              inputMode={k === 'llave' ? 'text' : 'numeric'}
              autoComplete="off"
              placeholder={ayuda}
              maxLength={k === 'llave' ? 60 : 16}
              onChange={(e) => setPago({ ...pago, [k]: e.target.value })}
            />
          </label>
        ))}
      </fieldset>

      <div className="pf-row">
        <Button type="submit" disabled={estado.busy}>
          {estado.busy ? t('Guardando…') : t('Cobrar')}
        </Button>
        {estado.error && (
          <p className="lu-error pf-msg" role="alert">
            {estado.error}
          </p>
        )}
        {estado.ok && (
          <p className="lu-success pf-msg" role="status">
            {estado.ok}
          </p>
        )}
      </div>
    </form>
  );
}

/** Un cobro: a quién, cuánto, por qué y cómo va; si sigue abierto, «ya me pagó» o «deja de cobrarle» */
function CobroItem({ c, isAdmin, verTelefono, onCambio }: { c: Cobro; isAdmin: boolean; verTelefono: boolean; onCambio: () => void }) {
  const t = useT();
  const moneda = useMoneda();
  const [supabase] = useState(() => createClient());
  const [parar, setParar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nombre = c.deudor?.display_name ?? '—';

  const estado = c.pagado_at
    ? { tono: 'ok', texto: c.pagado_por === 'deudor' ? t('Dijo que ya te pagó') : t('Pagado') }
    : c.no_debe_at
      ? { tono: 'warn', texto: t('Dice que no te debe') }
      : c.detenido_at
        ? { tono: 'off', texto: c.detenido_por === 'no_me_escribas' ? t('Pidió que no le escriban') : t('Dejaste de cobrarle') }
        : c.avisos >= 4
          ? { tono: 'warn', texto: t('Le escribí 4 veces y no ha pagado') }
          : c.avisos === 0
            ? { tono: 'on', texto: t('Le escribo en horario de cobranza') }
            : { tono: 'on', texto: t('Le escribí {n} de 4 veces', { n: c.avisos }) };

  const marcar = async (que: 'pagado' | 'detener') => {
    setError(null);
    const { error } = await supabase.rpc('marcar_cobro', { p_cobro_id: c.id, p_que: que });
    if (error) return setError(humanError(error));
    onCambio();
  };

  return (
    <li className="ch-item">
      <Avatar name={nombre} size="sm" registered={false} />
      <div className="ch-item__txt">
        <b>{nombre}</b>
        <span className="lu-small lu-muted">
          {c.concepto}
          {verTelefono ? ` · ${telefonoBonito(c.telefono)}` : ''}
        </span>
        <span className={`ch-estado ch-estado--${estado.tono}`}>{estado.texto}</span>
        {error && (
          <span className="lu-error" role="alert">
            {error}
          </span>
        )}
      </div>
      <div className="ch-item__fin">
        <b className="lu-num">{dinero(c.monto, moneda, t.idioma)}</b>
        {isAdmin && abierto(c) && (
          <div className="ch-item__acts">
            <Button size="sm" onClick={() => marcar('pagado')}>
              {t('Ya me pagó')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setParar(true)}>
              {t('Dejar de cobrar')}
            </Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={parar}
        onOpenChange={setParar}
        title={t('¿Dejar de cobrarle a {nombre}?', { nombre })}
        confirmLabel={t('Dejar de cobrar')}
        onConfirm={() => marcar('detener')}
      >
        <p>{t('Mister Luks no le vuelve a escribir por este cobro.')}</p>
      </ConfirmDialog>
    </li>
  );
}
