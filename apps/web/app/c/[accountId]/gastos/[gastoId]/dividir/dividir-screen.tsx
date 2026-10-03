'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { lanzarChispas } from '@/components/chispas';
import { EvidenceViewer } from '@/components/evidence-viewer';
import { formatCOP } from '@/components/lucas-core';
import { Avatar, Button, Chip, LottieSlot } from '@/components/lucas-ui';
import { dividirPorConsumo } from '@/lib/consumo';
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
  expense_splits: { person_id: string; amount_cop: number; fixed: boolean }[];
  expense_items: { id: string; name: string; quantity: number | null; total_cop: number; created_at: string; expense_item_people: { person_id: string }[] }[];
}

/** Un ítem mientras se edita (key estable para React; id si ya estaba guardado) */
interface Item {
  key: string;
  id: string | null;
  name: string;
  quantity: number;
  total: number;
  people: string[];
}

let siguiente = 0;
const nuevaKey = () => `nuevo-${++siguiente}`;
const pesos = (v: string) => Number(v.replace(/\D/g, '')) || 0;

/**
 * Dividir un gasto por consumo: con la factura a la vista, quién estaba, quién
 * pidió qué y cuánto pone cada uno. Lo que no está en los ítems (propina,
 * servicio) se reparte según lo que consumió cada uno, y quien quiere poner
 * más (o menos) fija su monto: el resto se reparte entre los demás.
 */
export function DividirScreen({ accountId, expenseId, myRole, atras }: { accountId: string; expenseId: string; myRole: Role; atras: string }) {
  const [supabase] = useState(() => createClient());
  const data = useQuery({
    queryKey: ['dividir', expenseId],
    queryFn: async () => {
      const [exp, people] = await Promise.all([
        supabase
          .from('expenses')
          .select(
            'id, merchant, total_cop, payer_person_id, status, split_method, evidence_path, created_at, source, messages(kind, text_body, file_name, received_at, sender_person_id), expense_splits(person_id, amount_cop, fixed), expense_items(id, name, quantity, total_cop, created_at, expense_item_people(person_id))',
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
      ← Volver al gasto
    </Link>
  );
  if (data.isPending || data.isError || !data.data.gasto) {
    return (
      <div className="rv">
        {volver}
        <p className={data.isError ? 'lu-error' : 'lu-small lu-muted'} role={data.isError ? 'alert' : undefined}>
          {data.isPending ? 'Cargando…' : data.isError ? humanError(data.error) : 'Ese gasto ya no existe: puede que lo hayan eliminado.'}
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
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const queryClient = useQueryClient();
  const total = gasto.total_cop;

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
    })),
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

  // En el orden de la cuenta, para que no salten al marcar
  const orden = people.map((p) => p.id).filter((id) => personas.includes(id));
  const persona = (id: string) => people.find((p) => p.id === id);
  const nombre = (id: string) => persona(id)?.display_name ?? 'Alguien';
  const d = dividirPorConsumo({
    total,
    personas: orden,
    items: items.map((i) => ({ total: i.total, people: i.people })),
    fijos: Object.fromEntries(Object.entries(fijos).filter(([p]) => orden.includes(p))),
  });

  const conPersona = (id: string, esta: boolean) => {
    setPersonas((ps) => (esta ? [...ps.filter((p) => p !== id), id] : ps.filter((p) => p !== id)));
    if (!esta) {
      setItems((its) => its.map((i) => ({ ...i, people: i.people.filter((p) => p !== id) })));
      setFijos(({ [id]: _, ...resto }) => resto);
    }
  };
  const cambiarItem = (key: string, cambio: Partial<Item>) => setItems((its) => its.map((i) => (i.key === key ? { ...i, ...cambio } : i)));
  const quienPidio = (it: Item, id: string | null) => {
    if (id === null) return cambiarItem(it.key, { people: [] }); // entre todos
    const tiene = it.people.includes(id);
    cambiarItem(it.key, { people: tiene ? it.people.filter((p) => p !== id) : [...it.people, id] });
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
    if (d.error) return setError(d.error);
    const sinNombre = items.find((i) => i.total > 0 && !i.name.trim());
    if (sinNombre) return setError('Ponle nombre a cada ítem que tiene precio');
    if (!payer) return setError('Elige quién pagó la cuenta');
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('split_by_items', {
      p_expense_id: gasto.id,
      p_payer_person_id: payer,
      p_items: items
        .filter((i) => i.name.trim())
        .map((i) => ({ id: i.id, name: i.name.trim(), quantity: i.quantity, total_cop: i.total, people: i.people.filter((p) => orden.includes(p)) })),
      p_shares: orden.map((p) => ({ person_id: p, amount_cop: d.partes[p], fixed: fijos[p] != null })),
    });
    if (error) {
      setBusy(false);
      return setError(humanError(error));
    }
    // Sigue en «Guardando…» hasta que llegue la pantalla del gasto
    lanzarChispas(e);
    notifyAccountChanged(accountId);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['gasto', gasto.id] }),
      queryClient.invalidateQueries({ queryKey: ['revisar', accountId] }),
      queryClient.invalidateQueries({ queryKey: ['dividir', gasto.id] }),
    ]);
    router.push(atras);
    router.refresh();
  };

  const remitente = persona(gasto.messages?.sender_person_id ?? gasto.payer_person_id ?? '');
  const sumaItems = d.items;
  const sumaPartes = orden.reduce((s, p) => s + (d.partes[p] ?? 0), 0);

  return (
    <div className="rv">
      <div className="rv-top">{volver}</div>
      <header className="dv-head">
        <span className="lu-label">Dividir por consumo</span>
        <h1 className="lu-display" style={{ margin: 0 }}>
          {gasto.merchant}
        </h1>
        <p className="lu-small lu-muted" style={{ margin: 0 }}>
          Total de la factura <b className="lu-num">{formatCOP(total)}</b>. Marquen quién pidió qué: la propina se reparte según lo que consumió cada uno y
          quien quiera poner más, pone más.
        </p>
      </header>

      <div className="rv-split">
        <section className="rv-evi" aria-label="La factura">
          <EvidenceViewer
            kind={gasto.messages?.kind ?? null}
            path={gasto.evidence_path}
            text={gasto.messages?.text_body ?? null}
            fileName={gasto.messages?.file_name ?? null}
            sender={remitente?.display_name ?? 'Alguien'}
            senderTone={remitente ? asTone(remitente.tone, remitente.display_name) : undefined}
            when={formatWhen(gasto.messages?.received_at ?? gasto.created_at)}
            source={gasto.source}
          />
        </section>

        <fieldset className="dv" disabled={!canEdit || busy}>
          {/* 1. Quiénes estaban y quién pagó */}
          <section className="dv-step" aria-labelledby="dv-1">
            <h2 id="dv-1" className="dv-step__t">
              <span className="dv-n">1</span> ¿Quiénes estaban?
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
                ¿Falta alguien? Aunque no use Luks
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
                  placeholder="Pipe, Ana y la prima de Juan"
                  autoComplete="off"
                />
                <Button size="sm" variant="secondary" onClick={agregar} disabled={agregando || !nombres.trim()}>
                  {agregando ? 'Agregando…' : 'Agregar'}
                </Button>
              </div>
            </div>
            <div className="lu-field dv-payer">
              <label className="lu-label" htmlFor="dv-pagador">
                ¿Quién pagó la cuenta?
              </label>
              <select id="dv-pagador" value={payer} onChange={(e) => setPayer(e.target.value)}>
                <option value="" disabled>
                  Elige quién pagó
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
              <span className="dv-n">2</span> ¿Quién pidió qué?
            </h2>
            {items.length === 0 && (
              <div className="dv-vacio">
                <LottieSlot name="escaneo" width={64} height={64} label="Leer la factura" />
                <p className="lu-small lu-muted" style={{ margin: 0 }}>
                  Luks no leyó los ítems de esta factura. Agréguenlos mirando la foto; lo que no pongan se divide por igual.
                </p>
              </div>
            )}
            <ul className="dv-items lu-stagger">
              {items.map((it, i) => {
                const n = it.people.filter((p) => orden.includes(p)).length || orden.length;
                return (
                  <li key={it.key} className="dv-item" style={{ '--i': i } as React.CSSProperties}>
                    <div className="dv-item__top">
                      <input
                        className="dv-input dv-item__name"
                        aria-label={`Ítem ${i + 1}`}
                        value={it.name}
                        onChange={(e) => cambiarItem(it.key, { name: e.target.value })}
                        placeholder="Hamburguesa"
                      />
                      <input
                        className="dv-input dv-item__price lu-num"
                        aria-label={`Precio de ${it.name || `ítem ${i + 1}`}`}
                        inputMode="numeric"
                        value={formatCOP(it.total)}
                        onChange={(e) => cambiarItem(it.key, { total: pesos(e.target.value) })}
                      />
                      <button
                        type="button"
                        className="dv-item__x"
                        aria-label={`Quitar ${it.name || 'el ítem'}`}
                        onClick={() => setItems((its) => its.filter((x) => x.key !== it.key))}
                      >
                        ×
                      </button>
                    </div>
                    <div className="dv-item__who">
                      <button type="button" className="dv-todos" aria-pressed={it.people.length === 0} onClick={() => quienPidio(it, null)}>
                        Todos
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
                          <Avatar name={nombre(id)} tone={asTone(persona(id)?.tone, nombre(id))} size="xs" />
                          {nombre(id)}
                        </button>
                      ))}
                    </div>
                    {it.total > 0 && orden.length > 0 && (
                      <span className="dv-item__each lu-small lu-muted">
                        {it.people.length === 0
                          ? `Entre todos · ${formatCOP(it.total / n)} c/u`
                          : n === 1
                            ? `Solo ${nombre(it.people.find((p) => orden.includes(p)) ?? '')}`
                            : `${formatCOP(it.total / n)} c/u`}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setItems((its) => [...its, { key: nuevaKey(), id: null, name: '', quantity: 1, total: 0, people: [] }])}
            >
              + Agregar ítem
            </Button>
            {items.length > 0 && (
              <p className={`dv-cuadre${d.extra < 0 ? ' is-mal' : ''}`} role="status">
                {d.extra === 0
                  ? `Los ítems suman ${formatCOP(sumaItems)}: justo el total.`
                  : d.extra > 0
                    ? `Los ítems suman ${formatCOP(sumaItems)}. Los ${formatCOP(d.extra)} que faltan (propina, servicio…) se reparten según lo que consumió cada uno.`
                    : `Los ítems suman ${formatCOP(-d.extra)} más que el total. Revisen los precios; si fue un descuento, se reparte igual.`}
              </p>
            )}
          </section>

          {/* 3. Cuánto pone cada uno */}
          <section className="dv-step" aria-labelledby="dv-3">
            <h2 id="dv-3" className="dv-step__t">
              <span className="dv-n">3</span> ¿Cuánto pone cada uno?
            </h2>
            <p className="lu-small lu-muted" style={{ margin: 0 }}>
              Si alguien quiere poner más (o menos), cambien su monto: el resto se reparte entre los demás.
            </p>
            <ul className="dv-who lu-stagger">
              {orden.map((id, i) => {
                const fijo = fijos[id] != null;
                const dif = Math.round((d.partes[id] ?? 0) - (d.justo[id] ?? 0));
                return (
                  <li key={id} className={`dv-p${fijo ? ' is-fijo' : ''}`} style={{ '--i': i } as React.CSSProperties}>
                    <Avatar name={nombre(id)} tone={asTone(persona(id)?.tone, nombre(id))} size="sm" />
                    <span className="dv-p__who">
                      <b>{nombre(id)}</b>
                      <span className="lu-muted">
                        {fijo
                          ? Math.abs(dif) < 1
                            ? 'pone lo suyo'
                            : `pone ${formatCOP(Math.abs(dif))} ${dif > 0 ? 'más' : 'menos'} de lo que consumió`
                          : sumaItems > 0
                            ? `consumió ${formatCOP(d.consumo[id] ?? 0)}`
                            : 'partes iguales'}
                      </span>
                    </span>
                    <span className="dv-p__amt">
                      <input
                        className="dv-input dv-p__input lu-num"
                        inputMode="numeric"
                        aria-label={`Lo que pone ${nombre(id)}`}
                        value={formatCOP(fijo ? fijos[id] : (d.partes[id] ?? 0))}
                        onChange={(e) => setFijos((f) => ({ ...f, [id]: pesos(e.target.value) }))}
                      />
                      {fijo && (
                        <button type="button" className="st-undo" onClick={() => setFijos(({ [id]: _, ...resto }) => resto)}>
                          lo que le toca
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
              {d.error}
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
                {plural(orden.length, 'persona', 'personas')} · <b className="lu-num">{formatCOP(sumaPartes)}</b> de {formatCOP(total)}
              </span>
              <Button onClick={guardar} disabled={busy || Boolean(d.error)}>
                {busy ? 'Guardando…' : 'Guardar división'}
              </Button>
            </div>
          ) : (
            <p className="rv-member lu-small">Solo quienes administran la cuenta dividen los gastos. Si ves algo mal, avísales por el grupo.</p>
          )}
        </fieldset>
      </div>
    </div>
  );
}
