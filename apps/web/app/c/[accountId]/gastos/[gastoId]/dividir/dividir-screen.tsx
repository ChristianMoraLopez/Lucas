'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { lanzarChispas } from '@/components/chispas';
import { EvidenceViewer } from '@/components/evidence-viewer';
import { useT } from '@/components/idioma';
import { Avatar, Button, Chip, LottieSlot } from '@/components/lucas-ui';
import { useDinero } from '@/components/moneda';
import { Segmento } from '@/components/segmento';
import { dividirPorConsumo, leerPorcentaje, propinaDe, separable, separarUnidades, unidadesDe } from '@/lib/consumo';
import { formatWhen } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { notifyAccountChanged } from '@/lib/realtime';
import { type AccountPerson, asTone, type MessageKind, plural, type Role, separarNombres } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

interface Gasto {
  id: string;
  merchant: string;
  total_cop: number;
  payer_person_id: string | null;
  status: 'pending_review' | 'confirmed';
  split_method: 'equal' | 'percent' | 'exact' | 'items';
  evidence_path: string | null;
  created_at: string;
  source: 'whatsapp' | 'web' | 'import';
  messages: { kind: MessageKind; text_body: string | null; file_name: string | null; received_at: string; sender_person_id: string | null } | null;
  tip_percent: number | null;
  tip_cop: number;
  expense_splits: { person_id: string; amount_cop: number; fixed: boolean }[];
  expense_items: {
    id: string;
    name: string;
    quantity: number | null;
    total_cop: number;
    extra: boolean;
    created_at: string;
    expense_item_people: { person_id: string; units: number }[];
  }[];
}

/** Un ítem mientras se edita (key estable para React; id si ya estaba guardado) */
interface Item {
  key: string;
  id: string | null;
  name: string;
  quantity: number;
  total: number;
  people: string[];
  /** Cuántas consumió cada uno (si el ítem trae varias) */
  units: Record<string, number>;
  /** No estaba en la factura: suma al total */
  extra: boolean;
}

/** Propina aparte: los porcentajes de siempre u otro */
const PROPINAS = ['0', '5', '10', '15', 'otro'] as const;
type Propina = (typeof PROPINAS)[number];

let siguiente = 0;
const nuevaKey = () => `nuevo-${++siguiente}`;
const pesos = (v: string) => Number(v.replace(/\D/g, '')) || 0;
const sinUnidades = (units: Record<string, number>, id: string) => {
  const { [id]: _, ...resto } = units;
  return resto;
};

/**
 * Dividir un gasto por consumo: con la factura a la vista, quién estaba, quién
 * pidió qué y cuánto pone cada uno. Lo que no está en los ítems (propina,
 * servicio) se reparte según lo que consumió cada uno, y quien quiere poner
 * más (o menos) fija su monto: el resto se reparte entre los demás.
 */
export function DividirScreen({ accountId, expenseId, myRole, atras }: { accountId: string; expenseId: string; myRole: Role; atras: string }) {
  const t = useT();
  const [supabase] = useState(() => createClient());
  const data = useQuery({
    queryKey: ['dividir', expenseId],
    queryFn: async () => {
      const [exp, people] = await Promise.all([
        supabase
          .from('expenses')
          .select(
            'id, merchant, total_cop, tip_percent, tip_cop, payer_person_id, status, split_method, evidence_path, created_at, source, messages(kind, text_body, file_name, received_at, sender_person_id), expense_splits(person_id, amount_cop, fixed), expense_items(id, name, quantity, total_cop, extra, created_at, expense_item_people(person_id, units))',
          )
          .eq('id', expenseId)
          .eq('account_id', accountId)
          .order('created_at', { referencedTable: 'expense_items' })
          .maybeSingle(),
        supabase.from('people').select('id, display_name, tone, claimed_by').eq('account_id', accountId).order('created_at'),
      ]);
      const error = exp.error ?? people.error;
      if (error) throw error;
      return { gasto: exp.data as unknown as Gasto | null, people: people.data as AccountPerson[] };
    },
  });

  const volver = (
    <Link href={atras} className="lu-btn lu-btn--sm lu-btn--ghost">
      {t('← Volver al gasto')}
    </Link>
  );
  if (data.isPending || data.isError || !data.data.gasto) {
    return (
      <div className="rv">
        {volver}
        <p className={data.isError ? 'lu-error' : 'lu-small lu-muted'} role={data.isError ? 'alert' : undefined}>
          {data.isPending ? t('Cargando…') : data.isError ? humanError(data.error) : t('Ese gasto ya no existe: puede que lo hayan eliminado.')}
        </p>
      </div>
    );
  }
  const { gasto, people } = data.data;
  return (
    <Editor
      key={gasto.id}
      accountId={accountId}
      gasto={gasto}
      people={people}
      canEdit={myRole === 'owner' || myRole === 'admin'}
      atras={atras}
      volver={volver}
    />
  );
}

function Editor({
  accountId,
  gasto,
  people,
  canEdit,
  atras,
  volver,
}: {
  accountId: string;
  gasto: Gasto;
  people: AccountPerson[];
  canEdit: boolean;
  atras: string;
  volver: React.ReactNode;
}) {
  const t = useT();
  const cop = useDinero().fmt;
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const queryClient = useQueryClient();
  // Lo de la factura: el total sin la propina ni los extras que ya se le habían sumado
  const factura = gasto.total_cop - (gasto.tip_cop ?? 0) - gasto.expense_items.filter((i) => i.extra).reduce((s, i) => s + i.total_cop, 0);

  // Quiénes estaban: los de la división que tiene (y los de sus ítems); si no tiene, todos
  const [personas, setPersonas] = useState<string[]>(() => {
    const ids = new Set([
      ...gasto.expense_splits.map((s) => s.person_id),
      ...gasto.expense_items.flatMap((i) => i.expense_item_people.map((x) => x.person_id)),
    ]);
    return ids.size ? [...ids] : people.map((p) => p.id);
  });
  const [items, setItems] = useState<Item[]>(() =>
    gasto.expense_items.map((i) => ({
      key: i.id,
      id: i.id,
      name: i.name,
      quantity: Number(i.quantity) || 1,
      total: i.total_cop,
      people: i.expense_item_people.map((x) => x.person_id),
      units: Object.fromEntries(i.expense_item_people.filter((x) => Number(x.units) !== 1).map((x) => [x.person_id, Number(x.units)])),
      extra: Boolean(i.extra),
    })),
  );
  // La propina que se dejó aparte (no venía en la factura)
  const pctGuardado = gasto.tip_percent != null ? Number(gasto.tip_percent) : null;
  const [propina, setPropina] = useState<Propina>(() =>
    !pctGuardado ? '0' : (PROPINAS as readonly string[]).includes(String(pctGuardado)) ? (String(pctGuardado) as Propina) : 'otro',
  );
  const [otraPropina, setOtraPropina] = useState(() =>
    pctGuardado && propina === 'otro' ? String(pctGuardado).replace('.', t.idioma === 'en' ? '.' : ',') : '',
  );
  // Lo que alguien fijó a mano (solo si ya estaba dividido por consumo)
  const [fijos, setFijos] = useState<Record<string, number>>(() =>
    gasto.split_method === 'items' ? Object.fromEntries(gasto.expense_splits.filter((s) => s.fixed).map((s) => [s.person_id, s.amount_cop])) : {},
  );
  const [payer, setPayer] = useState(gasto.payer_person_id ?? '');
  const [nombres, setNombres] = useState('');
  const [agregando, setAgregando] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Marcar ítem por ítem, o persona por persona («toca a Ana y lo que pidió»)
  const [modo, setModo] = useState<'item' | 'persona'>('item');
  const [elegida, setElegida] = useState<string | null>(null);

  // En el orden de la cuenta, para que no salten al marcar
  const orden = people.map((p) => p.id).filter((id) => personas.includes(id));
  const persona = (id: string) => people.find((p) => p.id === id);
  const nombre = (id: string) => persona(id)?.display_name ?? t('Alguien');
  const extras = items.filter((i) => i.extra).reduce((s, i) => s + i.total, 0);
  const porcentaje = propina === 'otro' ? leerPorcentaje(otraPropina) : Number(propina);
  const tip = propinaDe(factura + extras, porcentaje);
  const total = factura + extras + tip;
  const d = dividirPorConsumo({
    total,
    personas: orden,
    items: items.map((i) => ({ total: i.total, people: i.people, units: i.units })),
    fijos: Object.fromEntries(Object.entries(fijos).filter(([p]) => orden.includes(p))),
  });
  const quien = elegida && orden.includes(elegida) ? elegida : (orden[0] ?? null);

  const conPersona = (id: string, esta: boolean) => {
    setPersonas((ps) => (esta ? [...ps.filter((p) => p !== id), id] : ps.filter((p) => p !== id)));
    if (!esta) {
      setItems((its) => its.map((i) => ({ ...i, people: i.people.filter((p) => p !== id), units: sinUnidades(i.units, id) })));
      setFijos(({ [id]: _, ...resto }) => resto);
    }
  };
  const cambiarItem = (key: string, cambio: Partial<Item>) => setItems((its) => its.map((i) => (i.key === key ? { ...i, ...cambio } : i)));
  const quienPidio = (it: Item, id: string | null) => {
    if (id === null) return cambiarItem(it.key, { people: [], units: {} }); // entre todos
    const tiene = it.people.includes(id);
    cambiarItem(it.key, tiene ? { people: it.people.filter((p) => p !== id), units: sinUnidades(it.units, id) } : { people: [...it.people, id] });
  };
  // «Limonada × 3»: la factura trae el valor del renglón (las tres juntas), así que la
  // cantidad no cambia el total; cambia lo de cada una («$5.700 c/u»)
  const cambiarCantidad = (it: Item, cantidad: number) => {
    const n = Math.min(99, Math.max(1, cantidad));
    cambiarItem(it.key, { quantity: n });
  };
  const cambiarUnidades = (it: Item, id: string, n: number) =>
    cambiarItem(it.key, { units: n <= 1 ? sinUnidades(it.units, id) : { ...it.units, [id]: Math.min(99, n) } });
  // «Hamburguesa × 3» → tres renglones de una; si ya había tres personas marcadas, una para cada una
  const separar = (it: Item) => {
    const partes = separarUnidades(it.total, it.quantity);
    const marcadas = it.people.filter((p) => orden.includes(p));
    setItems((its) =>
      its.flatMap((x) =>
        x.key !== it.key
          ? [x]
          : partes.map((total, k) => ({
              key: k === 0 ? x.key : nuevaKey(),
              id: k === 0 ? x.id : null,
              name: x.name,
              quantity: 1,
              total,
              people: marcadas.length === partes.length ? [marcadas[k]] : [],
              units: {},
              extra: x.extra,
            })),
      ),
    );
  };

  // Gente que no usa Luks (o que todavía no está en la cuenta): queda en la cuenta y entra en esta cuenta
  const agregar = async () => {
    const lista = separarNombres(nombres);
    if (!lista.length) return;
    setAgregando(true);
    setError(null);
    const { data, error } = await supabase.rpc('add_people', { p_account_id: accountId, p_names: lista, p_include_in_shared: false });
    setAgregando(false);
    if (error) return setError(humanError(error));
    const ids = (data as { person_ids: string[] }).person_ids;
    setPersonas((ps) => [...ps, ...ids.filter((id) => !ps.includes(id))]);
    setNombres('');
    await queryClient.invalidateQueries({ queryKey: ['dividir', gasto.id] });
    notifyAccountChanged(accountId);
  };

  const guardar = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!canEdit || busy) return;
    if (d.error) return setError(t(d.error));
    const sinNombre = items.find((i) => i.total > 0 && !i.name.trim());
    if (sinNombre) return setError(t('Ponle nombre a cada ítem que tiene precio'));
    if (!payer) return setError(t('Elige quién pagó la cuenta'));
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('split_by_consumption', {
      p_expense_id: gasto.id,
      p_payer_person_id: payer,
      p_items: items
        .filter((i) => i.name.trim())
        .map((i) => {
          const people = i.people.filter((p) => orden.includes(p));
          return {
            id: i.id,
            name: i.name.trim(),
            quantity: i.quantity,
            total_cop: i.total,
            people,
            units: Object.fromEntries(people.filter((p) => unidadesDe(i, p) !== 1).map((p) => [p, unidadesDe(i, p)])),
            extra: i.extra,
          };
        }),
      p_shares: orden.map((p) => ({ person_id: p, amount_cop: d.partes[p], fixed: fijos[p] != null })),
      p_tip_percent: tip > 0 ? porcentaje : null,
      p_tip_cop: tip,
    });
    if (error) {
      setBusy(false);
      return setError(humanError(error));
    }
    // Sigue en «Guardando…» hasta que llegue la pantalla del gasto
    lanzarChispas(e);
    notifyAccountChanged(accountId);
    // Lo guardado en caché ya no vale (el total cambia con la propina): que la pantalla del gasto no lo muestre ni un momento
    queryClient.removeQueries({ queryKey: ['gasto', gasto.id] });
    queryClient.removeQueries({ queryKey: ['revisar', accountId] });
    await queryClient.invalidateQueries({ queryKey: ['dividir', gasto.id] });
    router.push(atras);
    router.refresh();
  };

  const remitente = persona(gasto.messages?.sender_person_id ?? gasto.payer_person_id ?? '');
  // Los ítems de la factura contra lo que dice la factura (los extras van aparte)
  const sumaItems = d.items - extras;
  const faltan = factura - sumaItems;
  const sumaPartes = orden.reduce((s, p) => s + (d.partes[p] ?? 0), 0);
  const avatar = (id: string, size: 'xs' | 'sm' = 'xs') => <Avatar name={nombre(id)} tone={asTone(persona(id)?.tone, nombre(id))} size={size} />;

  return (
    <div className="rv">
      <div className="rv-top">{volver}</div>
      <header className="dv-head">
        <span className="lu-label">{t('Dividir por consumo')}</span>
        <h1 className="lu-display" style={{ margin: 0 }}>
          {gasto.merchant}
        </h1>
        <p className="lu-small lu-muted" style={{ margin: 0 }}>
          {t('Total de la factura')} <b className="lu-num">{cop(factura)}</b>
          {extras > 0 && (
            <>
              {' '}
              + {t('extras')} <b className="lu-num">{cop(extras)}</b>
            </>
          )}
          {tip > 0 && (
            <>
              {' '}
              + {t('propina')} <b className="lu-num">{cop(tip)}</b>
            </>
          )}
          {(extras > 0 || tip > 0) && (
            <>
              {' '}
              = <b className="lu-num">{cop(total)}</b>
            </>
          )}
          . {t('Marquen quién pidió qué: la propina se reparte según lo que consumió cada uno y quien quiera poner más, pone más.')}
        </p>
      </header>

      <div className="rv-split">
        <section className="rv-evi" aria-label={t('La factura')}>
          <EvidenceViewer
            kind={gasto.messages?.kind ?? null}
            path={gasto.evidence_path}
            text={gasto.messages?.text_body ?? null}
            fileName={gasto.messages?.file_name ?? null}
            sender={remitente?.display_name ?? t('Alguien')}
            senderTone={remitente ? asTone(remitente.tone, remitente.display_name) : undefined}
            when={formatWhen(gasto.messages?.received_at ?? gasto.created_at, t.idioma)}
            source={gasto.source}
          />
        </section>

        <fieldset className="dv" disabled={!canEdit || busy}>
          {/* 1. Quiénes estaban y quién pagó */}
          <section className="dv-step" aria-labelledby="dv-1">
            <h2 id="dv-1" className="dv-step__t">
              <span className="dv-n">1</span> {t('¿Quiénes estaban?')}
            </h2>
            <div className="lu-chips">
              {people.map((p) => (
                <Chip
                  key={p.id}
                  name={p.display_name}
                  tone={asTone(p.tone, p.display_name)}
                  pressed={personas.includes(p.id)}
                  onToggle={() => conPersona(p.id, !personas.includes(p.id))}
                />
              ))}
            </div>
            <div className="dv-add">
              <label className="lu-label" htmlFor="dv-nuevos">
                {t('¿Falta alguien? Aunque no use Luks')}
              </label>
              <div className="dv-add__row">
                <input
                  className="dv-input dv-add__input"
                  id="dv-nuevos"
                  value={nombres}
                  onChange={(e) => setNombres(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      agregar();
                    }
                  }}
                  placeholder={t('Pipe, Ana y la prima de Juan')}
                  autoComplete="off"
                />
                <Button size="sm" variant="secondary" onClick={agregar} disabled={agregando || !nombres.trim()}>
                  {agregando ? t('Agregando…') : t('Agregar')}
                </Button>
              </div>
            </div>
            <div className="lu-field dv-payer">
              <label className="lu-label" htmlFor="dv-pagador">
                {t('¿Quién pagó la cuenta?')}
              </label>
              <select id="dv-pagador" value={payer} onChange={(e) => setPayer(e.target.value)}>
                <option value="" disabled>
                  {t('Elige quién pagó')}
                </option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {/* 2. Quién pidió qué */}
          <section className="dv-step" aria-labelledby="dv-2">
            <h2 id="dv-2" className="dv-step__t">
              <span className="dv-n">2</span> {t('¿Quién pidió qué?')}
            </h2>
            {items.length === 0 ? (
              <div className="dv-vacio">
                <LottieSlot name="escaneo" width={64} height={64} label={t('Leer la factura')} />
                <p className="lu-small lu-muted" style={{ margin: 0 }}>
                  {t('Luks no leyó los ítems de esta factura. Agréguenlos mirando la foto; lo que no pongan se divide por igual.')}
                </p>
              </div>
            ) : (
              <Segmento
                opciones={[
                  { value: 'item', label: t('Ítem por ítem') },
                  { value: 'persona', label: t('Persona por persona') },
                ]}
                value={modo}
                onChange={setModo}
                label={t('Cómo marcar quién pidió qué')}
              />
            )}

            {modo === 'persona' && items.length > 0 ? (
              <div className="dv-modo">
                <div className="dv-item__who" role="radiogroup" aria-label={t('¿De quién marcas?')}>
                  {orden.map((id) => (
                    <button key={id} type="button" role="radio" aria-checked={id === quien} className="dv-quien dv-quien--elige" onClick={() => setElegida(id)}>
                      {avatar(id)}
                      {nombre(id)}
                    </button>
                  ))}
                </div>
                {quien && (
                  <>
                    <p className="lu-small" style={{ margin: 0 }}>
                      {t('Toca lo que pidió {nombre}. Lo que nadie marque se divide entre todos.', { nombre: nombre(quien) })}
                    </p>
                    <ul className="dv-picks lu-stagger">
                      {items.map((it, i) => {
                        const marcado = it.people.includes(quien);
                        const otros = it.people.filter((p) => p !== quien && orden.includes(p));
                        return (
                          <li key={it.key} className="dv-pick__li" style={{ '--i': i } as React.CSSProperties}>
                            <button type="button" className="dv-pick" aria-pressed={marcado} onClick={() => quienPidio(it, quien)}>
                              <span className="dv-pick__check" aria-hidden="true">
                                {marcado ? '✓' : ''}
                              </span>
                              <span className="dv-pick__n">
                                {it.name || t('Ítem {n}', { n: i + 1 })}
                                {it.quantity > 1 && <span className="dv-pick__cant"> × {it.quantity}</span>}
                              </span>
                              <b className="dv-pick__v lu-num">{cop(it.total)}</b>
                              <span className="dv-pick__quienes">
                                {it.people.length === 0 ? (
                                  <span className="lu-muted">{t('Entre todos')}</span>
                                ) : (
                                  [...(marcado ? [quien] : []), ...otros].map((p) => <span key={p}>{avatar(p)}</span>)
                                )}
                              </span>
                            </button>
                            {marcado && it.quantity > 1 && (
                              <Contador
                                label={t('¿Cuántas de {item} fueron de {nombre}?', { item: it.name || t('Ítem {n}', { n: i + 1 }), nombre: nombre(quien) })}
                                prefijo={t('¿Cuántas?')}
                                value={unidadesDe(it, quien)}
                                max={99}
                                onChange={(n) => cambiarUnidades(it, quien, n)}
                              />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    <p className="dv-cuadre" role="status">
                      {t('{nombre} consumió {monto} y le toca {parte} con la propina.', {
                        nombre: nombre(quien),
                        monto: cop(d.consumo[quien] ?? 0),
                        parte: cop(d.partes[quien] ?? 0),
                      })}
                    </p>
                  </>
                )}
              </div>
            ) : (
              <>
                <ul className="dv-items lu-stagger">
                  {items.map((it, i) => {
                    const n = it.people.filter((p) => orden.includes(p)).length || orden.length;
                    return (
                      <li key={it.key} className="dv-item" style={{ '--i': i } as React.CSSProperties}>
                        <div className="dv-item__top">
                          <input
                            className="dv-input dv-item__name"
                            aria-label={t('Ítem {n}', { n: i + 1 })}
                            value={it.name}
                            onChange={(e) => cambiarItem(it.key, { name: e.target.value })}
                            placeholder={t('Hamburguesa')}
                          />
                          <input
                            className="dv-input dv-item__price lu-num"
                            aria-label={t('Precio de {nombre}', { nombre: it.name || t('Ítem {n}', { n: i + 1 }) })}
                            inputMode="numeric"
                            value={cop(it.total)}
                            onChange={(e) => cambiarItem(it.key, { total: pesos(e.target.value) })}
                          />
                          <button
                            type="button"
                            className="dv-item__x"
                            aria-label={t('Quitar {nombre}', { nombre: it.name || t('el ítem') })}
                            onClick={() => setItems((its) => its.filter((x) => x.key !== it.key))}
                          >
                            ×
                          </button>
                        </div>
                        <div className="dv-item__cant">
                          <Contador
                            label={t('Cantidad de {nombre}', { nombre: it.name || t('Ítem {n}', { n: i + 1 }) })}
                            prefijo={t('Cantidad')}
                            value={it.quantity}
                            max={99}
                            onChange={(n) => cambiarCantidad(it, n)}
                          />
                          {it.quantity > 1 && it.total > 0 && (
                            <span className="lu-small lu-muted">{t('{monto} c/u', { monto: cop(it.total / it.quantity) })}</span>
                          )}
                          {it.extra && <span className="dv-extra">{t('Extra: suma al total')}</span>}
                          {separable(it.quantity) && (
                            <button type="button" className="st-undo" onClick={() => separar(it)}>
                              {t('Separar en {n}: una por persona', { n: it.quantity })}
                            </button>
                          )}
                        </div>
                        <div className="dv-item__who">
                          <button type="button" className="dv-todos" aria-pressed={it.people.length === 0} onClick={() => quienPidio(it, null)}>
                            {t('Todos')}
                          </button>
                          {orden.map((id) => (
                            <button
                              key={id}
                              type="button"
                              className="dv-quien"
                              aria-pressed={it.people.includes(id)}
                              onClick={() => quienPidio(it, id)}
                              title={nombre(id)}
                            >
                              {avatar(id)}
                              {nombre(id)}
                            </button>
                          ))}
                        </div>
                        {it.quantity > 1 && it.people.filter((p) => orden.includes(p)).length > 1 && (
                          <Unidades
                            item={it}
                            personas={it.people.filter((p) => orden.includes(p))}
                            nombre={nombre}
                            avatar={avatar}
                            onChange={(id, n) => cambiarUnidades(it, id, n)}
                          />
                        )}
                        {it.total > 0 && orden.length > 0 && (
                          <span className="dv-item__each lu-small lu-muted">
                            {it.people.length === 0
                              ? t('Entre todos · {monto} c/u', { monto: cop(it.total / n) })
                              : n === 1
                                ? t('Solo {nombre}', { nombre: nombre(it.people.find((p) => orden.includes(p)) ?? '') })
                                : Object.keys(it.units).some((p) => orden.includes(p))
                                  ? t('Según cuántas pidió cada uno')
                                  : t('{monto} c/u', { monto: cop(it.total / n) })}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="dv-add-items">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setItems((its) => [...its, { key: nuevaKey(), id: null, name: '', quantity: 1, total: 0, people: [], units: {}, extra: false }])
                    }
                  >
                    {t('+ Agregar ítem')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setItems((its) => [...its, { key: nuevaKey(), id: null, name: '', quantity: 1, total: 0, people: [], units: {}, extra: true }])
                    }
                  >
                    {t('+ Extra que no está en la factura')}
                  </Button>
                </div>
              </>
            )}
            {items.length > 0 && (
              <p className={`dv-cuadre${faltan < 0 ? ' is-mal' : ''}`} role="status">
                {faltan === 0
                  ? t('Los ítems suman {monto}: justo el total.', { monto: cop(sumaItems) })
                  : faltan > 0
                    ? t('Los ítems suman {monto}. Los {extra} que faltan (propina, servicio…) se reparten según lo que consumió cada uno.', {
                        monto: cop(sumaItems),
                        extra: cop(faltan),
                      })
                    : t('Los ítems suman {monto} más que la factura. Revisen los precios y las cantidades; si fue un descuento, se reparte igual.', {
                        monto: cop(-faltan),
                      })}
              </p>
            )}
          </section>

          {/* 3. La propina que se dejó aparte */}
          <section className="dv-step" aria-labelledby="dv-3">
            <h2 id="dv-3" className="dv-step__t">
              <span className="dv-n">3</span> {t('¿Dejaron propina aparte?')}
            </h2>
            <p className="lu-small lu-muted" style={{ margin: 0 }}>
              {t('Si la propina no venía en la cuenta (en Chile se deja aparte), súmenla: se reparte según lo que consumió cada uno.')}
            </p>
            <div className="dv-propina" role="radiogroup" aria-label={t('Propina aparte')}>
              {PROPINAS.map((p) => (
                <button key={p} type="button" role="radio" aria-checked={propina === p} className="dv-todos" onClick={() => setPropina(p)}>
                  {p === '0' ? t('No') : p === 'otro' ? t('Otro %') : `${p} %`}
                </button>
              ))}
              {propina === 'otro' && (
                <span className="dv-propina__otro">
                  <input
                    className="dv-input dv-propina__input lu-num"
                    inputMode="decimal"
                    aria-label={t('Porcentaje de propina')}
                    value={otraPropina}
                    onChange={(e) => setOtraPropina(e.target.value)}
                    placeholder="7,5"
                    autoComplete="off"
                  />
                  %
                </span>
              )}
            </div>
            {tip > 0 && (
              <p className="dv-cuadre" role="status">
                {t('Propina de {pct} %: {monto}. El total queda en {total}.', {
                  pct: String(porcentaje).replace('.', t.idioma === 'en' ? '.' : ','),
                  monto: cop(tip),
                  total: cop(total),
                })}
              </p>
            )}
          </section>

          {/* 4. Cuánto pone cada uno */}
          <section className="dv-step" aria-labelledby="dv-4">
            <h2 id="dv-4" className="dv-step__t">
              <span className="dv-n">4</span> {t('¿Cuánto pone cada uno?')}
            </h2>
            <p className="lu-small lu-muted" style={{ margin: 0 }}>
              {t('Si alguien quiere poner más (o menos), cambien su monto: el resto se reparte entre los demás.')}
            </p>
            <ul className="dv-who lu-stagger">
              {orden.map((id, i) => {
                const fijo = fijos[id] != null;
                const dif = Math.round((d.partes[id] ?? 0) - (d.justo[id] ?? 0));
                return (
                  <li key={id} className={`dv-p${fijo ? ' is-fijo' : ''}`} style={{ '--i': i } as React.CSSProperties}>
                    {avatar(id, 'sm')}
                    <span className="dv-p__who">
                      <b>{nombre(id)}</b>
                      <span className="lu-muted">
                        {fijo
                          ? Math.abs(dif) < 1
                            ? t('pone lo suyo')
                            : dif > 0
                              ? t('pone {monto} más de lo que consumió', { monto: cop(Math.abs(dif)) })
                              : t('pone {monto} menos de lo que consumió', { monto: cop(Math.abs(dif)) })
                          : d.items > 0
                            ? t('consumió {monto}', { monto: cop(d.consumo[id] ?? 0) })
                            : t('partes iguales')}
                      </span>
                    </span>
                    <span className="dv-p__amt">
                      <input
                        className="dv-input dv-p__input lu-num"
                        inputMode="numeric"
                        aria-label={t('Lo que pone {nombre}', { nombre: nombre(id) })}
                        value={cop(fijo ? fijos[id] : (d.partes[id] ?? 0))}
                        onChange={(e) => setFijos((f) => ({ ...f, [id]: pesos(e.target.value) }))}
                      />
                      {fijo && (
                        <button type="button" className="st-undo" onClick={() => setFijos(({ [id]: _, ...resto }) => resto)}>
                          {t('lo que le toca')}
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {d.error && (
            <p className="lu-error" role="alert">
              {t(d.error)}
            </p>
          )}
          {error && (
            <p className="lu-error" role="alert">
              {error}
            </p>
          )}

          {canEdit ? (
            <div className="rv-actions dv-actions">
              <span className="dv-total lu-small">
                {plural(orden.length, t('persona'), t('personas'))} · <b className="lu-num">{cop(sumaPartes)}</b> {t('de')} {cop(total)}
              </span>
              <Button onClick={guardar} disabled={busy || Boolean(d.error)}>
                {busy ? t('Guardando…') : t('Guardar división')}
              </Button>
            </div>
          ) : (
            <p className="rv-member lu-small">{t('Solo quienes administran la cuenta dividen los gastos. Si ves algo mal, avísales por el grupo.')}</p>
          )}
        </fieldset>
      </div>
    </div>
  );
}

/** − n + : la cantidad de un ítem o cuántas consumió alguien */
function Contador({ label, prefijo, value, max, onChange }: { label: string; prefijo: string; value: number; max: number; onChange: (n: number) => void }) {
  const t = useT();
  const entero = Number.isInteger(value);
  return (
    <span className="dv-cont" role="group" aria-label={label}>
      {prefijo && <span className="dv-cont__p lu-small lu-muted">{prefijo}</span>}
      <button
        type="button"
        className="dv-cont__b"
        aria-label={t('Una menos')}
        disabled={value <= 1}
        onClick={() => onChange(entero ? value - 1 : Math.floor(value))}
      >
        −
      </button>
      <output className="dv-cont__n lu-num" aria-live="polite">
        {value}
      </output>
      <button
        type="button"
        className="dv-cont__b"
        aria-label={t('Una más')}
        disabled={value >= max}
        onClick={() => onChange(entero ? value + 1 : Math.ceil(value))}
      >
        +
      </button>
    </span>
  );
}

/** «¿Cuántas cada uno?»: de 3 Coca-Colas, Ana 2 y Juan 1 */
function Unidades({
  item,
  personas,
  nombre,
  avatar,
  onChange,
}: {
  item: Item;
  personas: string[];
  nombre: (id: string) => string;
  avatar: (id: string) => React.ReactNode;
  onChange: (id: string, n: number) => void;
}) {
  const t = useT();
  const marcadas = personas.reduce((s, p) => s + unidadesDe(item, p), 0);
  const falta = item.quantity - marcadas;
  return (
    <div className="dv-unid">
      <span className="lu-small">
        {t('¿Cuántas cada uno?')}{' '}
        <span className={`lu-muted${falta < 0 ? ' dv-unid__mal' : ''}`}>
          {falta === 0
            ? t('las {n} repartidas', { n: item.quantity })
            : falta > 0
              ? t('van {m} de {n}', { m: marcadas, n: item.quantity })
              : t('marcaron {m} y son {n}', { m: marcadas, n: item.quantity })}
        </span>
      </span>
      <ul className="dv-unid__l">
        {personas.map((p) => (
          <li key={p} className="dv-unid__p">
            {avatar(p)}
            <span className="dv-unid__n">{nombre(p)}</span>
            <Contador
              label={t('¿Cuántas de {item} fueron de {nombre}?', { item: item.name || t('el ítem'), nombre: nombre(p) })}
              prefijo=""
              value={unidadesDe(item, p)}
              max={99}
              onChange={(n) => onChange(p, n)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
