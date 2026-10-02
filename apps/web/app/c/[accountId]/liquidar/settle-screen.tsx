'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { formatCOP, lucas } from '@/components/lucas-core';
import { Amount, Avatar, BillCard, Button, CategoryTag, LottieSlot, Sticker } from '@/components/lucas-ui';
import { formatDay, formatRange, monthName } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { notifyAccountChanged, useAccountChanges } from '@/lib/realtime';
import { minTransfers } from '@/lib/settlement';
import { asTone, plural, type SettlementOverview, type SettlementPerson, type SettlementTransfer } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

type Accion = 'liquidar' | 'reabrir' | 'cerrar';

/** «2026-09-01» ± n meses → «2026-08-01» */
function otroMes(mes: string, n: number) {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

const mesLargo = (mes: string) => `${monthName(mes)} ${mes.slice(0, 4)}`;

/**
 * Liquidar (captura 5 del kit): cuánto puso cada uno, cuánto le tocaba y quién
 * le paga a quién para quedar a mano, con el mínimo de transferencias. Antes
 * de liquidar se ve cómo quedaría; al liquidar, las transferencias quedan
 * guardadas y cada una se marca cuando se paga. Un paseo se liquida completo;
 * un hogar, mes a mes.
 */
export function SettleScreen({ d }: { d: SettlementOverview }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [, startRefresh] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<Accion | null>(null);

  const accountId = d.account.id;
  const evento = d.account.type === 'evento';
  const cerrada = d.account.status === 'closed';
  const s = d.settlement;
  const people = new Map(d.people.map((p) => [p.id, p]));
  const nombre = (id: string | null) => (id && people.get(id)?.name) || 'Alguien';

  const refresh = () => startRefresh(() => router.refresh());
  // Otra persona marca una transferencia, liquidan o llega un gasto: se vuelve a pedir
  useAccountChanges(accountId, refresh, ['expenses', 'settlements', 'settlement_transfers']);

  // Antes de liquidar: así quedarían (el mínimo de transferencias)
  const calculo = useMemo(() => {
    try {
      return { ok: true as const, transfers: minTransfers(d.people.map((p) => ({ id: p.id, name: p.name, balance: p.balance }))) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message, transfers: [] };
    }
  }, [d.people]);

  const transfers: SettlementTransfer[] = s
    ? s.transfers
    : calculo.transfers.map((t, i) => ({ id: `previa-${i}`, from: t.from, to: t.to, amount: t.amount, paid_at: null, paid_by: null }));
  const total = d.people.reduce((sum, p) => sum + p.paid, 0);
  const pagadas = transfers.filter((t) => t.paid_at).length;
  const pendiente = transfers.reduce((sum, t) => sum + (t.paid_at ? 0 : t.amount), 0);
  const todoPagado = Boolean(s) && pagadas === transfers.length;
  const partes = new Set(d.people.map((p) => p.share));
  const porCabeza = partes.size === 1 && total > 0 ? d.people[0].share : null;
  const bloqueos = d.pending_count + d.incomplete_count;
  const queSe = evento ? 'el paseo' : monthName(d.month as string).toLowerCase();
  const puedeMarcar = (t: SettlementTransfer) => !cerrada && (d.is_admin || t.from === d.my_person_id || t.to === d.my_person_id);

  const correr = async (clave: string, fn: () => PromiseLike<{ error: { message?: string } | null }>) => {
    setBusy(clave);
    setError(null);
    const { error } = await fn();
    setBusy(null);
    setConfirmar(null);
    if (error) return setError(humanError(error));
    notifyAccountChanged(accountId);
    refresh();
  };

  const liquidar = () =>
    correr('liquidar', () =>
      supabase.rpc('start_settlement', {
        p_account_id: accountId,
        p_month: d.month,
        p_transfers: calculo.transfers.map(({ from, to, amount }) => ({ from, to, amount })),
      }),
    );
  const marcar = (t: SettlementTransfer, pagada: boolean) => correr(t.id, () => supabase.rpc('mark_transfer', { p_transfer_id: t.id, p_paid: pagada }));
  const reabrir = () => correr('reabrir', () => supabase.rpc('reopen_settlement', { p_settlement_id: (s as NonNullable<typeof s>).id }));
  const cerrar = () => correr('cerrar', () => supabase.rpc('close_account', { p_account_id: accountId }));

  let subtitulo: string;
  if (total === 0) subtitulo = evento ? 'Todavía no hay gastos para dividir.' : `Todavía no hay gastos en ${queSe}.`;
  else if (s && todoPagado) subtitulo = cerrada ? 'El paseo quedó saldado y archivado.' : 'Todas las transferencias están pagadas: quedaron a mano.';
  else if (s) subtitulo = `Con ${plural(transfers.length, 'transferencia', 'transferencias')} quedan todos a paz y salvo. Márquenlas cuando se hagan.`;
  else if (transfers.length)
    subtitulo = `Así quedan a mano, con ${plural(transfers.length, 'transferencia', 'transferencias')}. ${d.is_admin ? `Cuando estén de acuerdo, liquiden ${queSe}.` : 'Quien administra la cuenta la liquida.'}`;
  else subtitulo = 'Cada quien puso lo que le tocaba: nadie le debe a nadie.';

  return (
    <div className="st">
      <header className="st-head">
        <span className="lu-label">
          {evento ? `Evento${d.account.starts_on ? ` · ${formatRange(d.account.starts_on, d.account.ends_on)}` : ''}` : 'Hogar · mes a mes'}
        </span>
        <h1 className="lu-display">
          ¿Quién le paga <span className="lu-mark">a quién?</span>
        </h1>
        <p className="lu-small lu-muted" style={{ margin: 0 }}>
          {subtitulo}
        </p>
        {!evento && d.month && <MesNav accountId={accountId} mes={d.month} hoy={d.today} liquidados={d.settled_months ?? []} />}
      </header>

      {!s && bloqueos > 0 && (
        <div className="ed-alert" role="status">
          {d.pending_count > 0 && (
            <Sticker tone="revisar" rotate={-5}>
              {d.pending_count} por revisar
            </Sticker>
          )}
          <span className="lu-small" style={{ flex: 1, minWidth: 180 }}>
            {d.pending_count > 0
              ? `${d.pending_count === 1 ? 'Falta revisar un gasto' : `Faltan ${d.pending_count} gastos por revisar`}. Ya cuentan abajo, pero para liquidar tienen que estar revisados.`
              : ''}
            {d.incomplete_count > 0
              ? ` ${plural(d.incomplete_count, 'gasto no tiene', 'gastos no tienen')} quién pagó o la división completa, y no ${d.incomplete_count === 1 ? 'cuenta' : 'cuentan'} hasta corregirlo.`
              : ''}
          </span>
          <Link href={`/c/${accountId}/${d.pending_count > 0 ? 'revisar' : 'gastos'}`} className="lu-btn lu-btn--sm lu-btn--primary">
            {d.pending_count > 0 ? 'Revisar' : 'Ver gastos'}
          </Link>
        </div>
      )}

      <div className="st-main">
        {s ? (
          <BillCard
            label={todoPagado ? 'Todo pagado' : 'Falta por pagar'}
            amount={pendiente}
            roll
            highlight={false}
            aside={
              <span className="lu-bill__denom">
                {pagadas} DE {transfers.length}
              </span>
            }
          >
            {transfers.length > 0 && (
              <div className="st-prog" aria-hidden="true">
                {transfers.map((t) => (
                  <i key={t.id} className={t.paid_at ? 'on' : ''} />
                ))}
              </div>
            )}
          </BillCard>
        ) : (
          <BillCard
            label="Para quedar a mano"
            amount={transfers.reduce((sum, t) => sum + t.amount, 0)}
            roll
            denom={`${d.people.length} ${d.people.length === 1 ? 'PERSONA' : 'PERSONAS'}`}
          >
            <span>
              Gastaron <b>{formatCOP(total)}</b>
            </span>
            <span>{porCabeza ? `${formatCOP(porCabeza)} a cada uno` : 'cada quien su parte'}</span>
          </BillCard>
        )}

        {transfers.length > 0 ? (
          <ol className="st-list" aria-label={s ? 'Transferencias' : 'Así quedarían las transferencias'}>
            {transfers.map((t, i) => {
              const de = people.get(t.from);
              const para = people.get(t.to);
              return (
                <li key={t.id} className={`st-t${t.paid_at ? ' is-paid' : ''}${s ? '' : ' is-previa'}`}>
                  <div className="st-pair" aria-hidden="true">
                    <Avatar name={nombre(t.from)} tone={asTone(de?.tone, nombre(t.from))} registered={de?.registered} size="sm" />
                    <svg className="st-arrow" viewBox="0 0 40 16" aria-hidden="true">
                      <path d="M2 8h32M28 3l6 5-6 5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <Avatar name={nombre(t.to)} tone={asTone(para?.tone, nombre(t.to))} registered={para?.registered} size="sm" />
                  </div>
                  <div className="st-txt">
                    <span className="st-sent">
                      <b>{nombre(t.from)}</b> le paga a <b>{nombre(t.to)}</b>
                    </span>
                    <span className="st-lucas">{lucas(t.amount)}</span>
                  </div>
                  <Amount value={t.amount} size="lg" className="st-amt" />
                  {s && (
                    <div className="st-act">
                      {t.paid_at ? (
                        <>
                          <Sticker tone="pagado" rotate={i % 2 ? 5 : -5} sub={formatDay(new Date(t.paid_at))} />
                          {puedeMarcar(t) && (
                            <button type="button" className="st-undo" onClick={() => marcar(t, false)} disabled={busy === t.id}>
                              deshacer
                            </button>
                          )}
                        </>
                      ) : puedeMarcar(t) ? (
                        <Button size="sm" onClick={() => marcar(t, true)} disabled={busy === t.id}>
                          {busy === t.id ? 'Guardando…' : 'Marcar pagada'}
                        </Button>
                      ) : (
                        <span className="lu-small lu-muted">Sin pagar</span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          total > 0 && (
            <div className="st-cero">
              <LottieSlot name="todo-revisado" width={72} height={72} />
              <span className="lu-small">Nadie le debe a nadie: cada quien ya puso exactamente lo suyo.</span>
            </div>
          )
        )}
        {!calculo.ok && !s && (
          <p className="lu-small" role="alert">
            Los saldos no cuadran ({calculo.error}). Recarguen la página; si sigue, revisen los gastos.
          </p>
        )}
      </div>

      <section className="st-people" aria-labelledby="st-people-t">
        <h2 id="st-people-t" className="lu-title" style={{ margin: 0 }}>
          ¿Cuánto puso cada uno?
        </h2>
        <p className="lu-small lu-muted" style={{ margin: 0 }}>
          {porCabeza
            ? `A cada uno le tocaba ${formatCOP(porCabeza)}. Toca a alguien para ver qué pagó.`
            : 'A cada quien le toca su parte de los gastos en que participó. Toca a alguien para ver qué pagó.'}
        </p>
        <ul className="st-pp">
          {d.people.map((p) => (
            <Persona key={p.id} p={p} yo={p.id === d.my_person_id} gastos={d.expenses.filter((e) => e.payer_person_id === p.id)} />
          ))}
        </ul>
      </section>

      <aside className="st-side">
        <Cierre
          d={d}
          evento={evento}
          cerrada={cerrada}
          todoPagado={todoPagado}
          faltan={transfers.length - pagadas}
          pagadas={pagadas}
          puedeLiquidar={bloqueos === 0 && total > 0 && calculo.ok}
          queSe={queSe}
          busy={busy}
          onAccion={setConfirmar}
        />
        {error && (
          <p className="lu-small st-error" role="alert">
            {error}
          </p>
        )}

        <section>
          <h2 className="lu-title" style={{ marginBottom: 12 }}>
            Descargar
          </h2>
          <div className="st-exp">
            <button type="button" className="st-file" onClick={() => descargarCsv(d, transfers)}>
              <span className="st-file__ext" style={{ background: 'var(--tono-azul)' }}>
                CSV
              </span>
              Para Excel
            </button>
          </div>
          <p className="lu-small lu-muted" style={{ margin: '10px 0 0' }}>
            Con {plural(d.expenses.length, 'gasto', 'gastos')}, lo que puso cada uno y las transferencias.
          </p>
        </section>

        <section className="st-why">
          <h2 className="lu-label" style={{ margin: '0 0 6px' }}>
            ¿Cómo se calculó?
          </h2>
          <p className="lu-small" style={{ margin: 0 }}>
            {porCabeza ? (
              <>
                A cada quien le tocaba <b className="lu-num">{formatCOP(porCabeza)}</b>.{' '}
              </>
            ) : (
              'A cada quien le toca su parte de cada gasto en que participó. '
            )}
            Al que puso de más le devuelven, el que puso de menos completa, y se cruzan las deudas para hacer el menor número de transferencias.
          </p>
        </section>
      </aside>

      <ConfirmDialog
        open={confirmar === 'liquidar'}
        onOpenChange={(o) => !o && setConfirmar(null)}
        title={`¿Liquidar ${queSe}?`}
        confirmLabel={`Liquidar ${queSe}`}
        danger={false}
        busy={busy === 'liquidar'}
        onConfirm={liquidar}
      >
        Quedan {plural(transfers.length, 'transferencia', 'transferencias')} por hacer.{' '}
        {evento
          ? 'Los gastos del paseo quedan congelados y no entran gastos nuevos.'
          : `Los gastos de ${queSe} quedan congelados; los otros meses siguen igual.`}{' '}
        Si falta algo, se puede reabrir mientras nadie haya pagado.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmar === 'reabrir'}
        onOpenChange={(o) => !o && setConfirmar(null)}
        title="¿Reabrir la liquidación?"
        confirmLabel="Reabrir"
        busy={busy === 'reabrir'}
        onConfirm={reabrir}
      >
        Se borran las transferencias y los gastos se pueden volver a corregir{evento ? '; el paseo vuelve a recibir gastos' : ''}. Después pueden liquidar de
        nuevo.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmar === 'cerrar'}
        onOpenChange={(o) => !o && setConfirmar(null)}
        title="¿Cerrar el paseo?"
        confirmLabel="Cerrar paseo"
        danger={false}
        busy={busy === 'cerrar'}
        onConfirm={cerrar}
      >
        Queda archivado con su liquidación, en solo lectura. Ya no entran gastos ni personas.
      </ConfirmDialog>
    </div>
  );
}

/** ‹ Agosto · Septiembre 2026 · Octubre › (hasta el mes en curso) */
function MesNav({ accountId, mes, hoy, liquidados }: { accountId: string; mes: string; hoy: string; liquidados: string[] }) {
  const antes = otroMes(mes, -1);
  const despues = otroMes(mes, 1);
  const hayDespues = despues <= `${hoy.slice(0, 7)}-01`;
  const ir = (m: string) => `/c/${accountId}/liquidar?mes=${m.slice(0, 7)}`;
  return (
    <nav className="st-mes" aria-label="Mes">
      <Link href={ir(antes)} className="st-mes__btn" aria-label={`Mes anterior: ${mesLargo(antes)}`}>
        ‹
      </Link>
      <span className="st-mes__now">
        {mesLargo(mes)}
        {liquidados.includes(mes) && <span className="st-mes__ok">liquidado</span>}
      </span>
      {hayDespues ? (
        <Link href={ir(despues)} className="st-mes__btn" aria-label={`Mes siguiente: ${mesLargo(despues)}`}>
          ›
        </Link>
      ) : (
        <span className="st-mes__btn is-off" aria-hidden="true">
          ›
        </span>
      )}
    </nav>
  );
}

/** Una persona: lo que pagó, lo que le tocaba y su saldo; al tocarla, qué pagó. */
function Persona({ p, yo, gastos }: { p: SettlementPerson; yo: boolean; gastos: SettlementOverview['expenses'] }) {
  return (
    <li>
      <details className="st-p">
        <summary>
          <Avatar name={p.name} tone={asTone(p.tone, p.name)} size="sm" registered={p.registered} />
          <span className="st-p__who">
            <b>
              {p.name}
              {yo ? ' (tú)' : ''}
            </b>
            <span className="lu-muted st-p__sub">
              pagó {formatCOP(p.paid)} · le tocaba {formatCOP(p.share)}
            </span>
          </span>
          <span className="st-p__bal">
            <Amount value={p.balance} sign tone={p.balance >= 0 ? 'pos' : 'neg'} />
            <span className="lu-muted">{p.balance === 0 ? 'a paz y salvo' : p.balance > 0 ? 'le deben' : 'debe'}</span>
          </span>
        </summary>
        {gastos.length ? (
          <ul className="st-p__gastos">
            {gastos.map((e) => (
              <li key={e.id} className="st-p__g">
                {e.category ? (
                  <CategoryTag name={e.category} showName={false} size="sm" letter={e.category_letter ?? undefined} tone={asTone(e.category_tone)} />
                ) : (
                  <span className="st-p__sin" aria-hidden="true" />
                )}
                <span className="st-p__m">
                  {e.merchant}
                  <span className="lu-muted"> · {formatDay(e.expense_date)}</span>
                </span>
                <Amount value={e.total_cop} size="sm" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="lu-small lu-muted st-p__nada">No pagó ningún gasto.</p>
        )}
      </details>
    </li>
  );
}

/** Lo que sigue: liquidar, cuánto falta, cerrar el paseo o reabrir. */
function Cierre({
  d,
  evento,
  cerrada,
  todoPagado,
  faltan,
  pagadas,
  puedeLiquidar,
  queSe,
  busy,
  onAccion,
}: {
  d: SettlementOverview;
  evento: boolean;
  cerrada: boolean;
  todoPagado: boolean;
  faltan: number;
  pagadas: number;
  puedeLiquidar: boolean;
  queSe: string;
  busy: string | null;
  onAccion: (a: Accion) => void;
}) {
  const s = d.settlement;
  if (cerrada) {
    return (
      <section className="st-close is-ready">
        <div className="st-close__row">
          <LottieSlot name="cierre-evento" width={88} height={88} />
          <div>
            <h2 className="lu-title" style={{ margin: 0 }}>
              {evento ? 'Paseo cerrado' : 'Cuenta cerrada'}
            </h2>
            <p className="lu-small" style={{ margin: '4px 0 0' }}>
              Queda archivado con su liquidación.
            </p>
          </div>
        </div>
        <Sticker tone="cerrado" size="lg" rotate={-5}>
          Saldado
        </Sticker>
      </section>
    );
  }
  if (!s) {
    return (
      <section className="st-close">
        <p className="lu-small" style={{ margin: 0 }}>
          <b>¿Listos?</b> Al liquidar {queSe} sus gastos quedan congelados
          {evento ? ' y ya no entran gastos nuevos' : ''}. Si falta algo, se puede reabrir mientras nadie haya pagado.
        </p>
        {d.is_admin ? (
          <Button onClick={() => onAccion('liquidar')} disabled={!puedeLiquidar || busy !== null}>
            Liquidar {queSe}
          </Button>
        ) : (
          <p className="lu-small lu-muted" style={{ margin: 0 }}>
            Quien administra la cuenta es quien liquida.
          </p>
        )}
      </section>
    );
  }
  if (todoPagado) {
    return (
      <section className="st-close is-ready">
        <div className="st-close__row">
          <LottieSlot name="cierre-evento" width={88} height={88} />
          <div>
            <h2 className="lu-title" style={{ margin: 0 }}>
              ¡Todo pagado!
            </h2>
            <p className="lu-small" style={{ margin: '4px 0 0' }}>
              {evento ? 'Ya pueden cerrar el paseo. Después no entran más gastos.' : `${monthName(d.month as string)} quedó a paz y salvo.`}
            </p>
          </div>
        </div>
        {evento && d.is_admin && (
          <Button onClick={() => onAccion('cerrar')} disabled={busy !== null}>
            Cerrar paseo
          </Button>
        )}
      </section>
    );
  }
  return (
    <section className="st-close">
      <p className="lu-small" style={{ margin: 0 }}>
        <b>{faltan === 1 ? 'Falta 1 transferencia.' : `Faltan ${faltan} transferencias.`}</b>{' '}
        {evento ? 'El paseo se cierra cuando todas estén pagadas.' : 'El mes queda saldado cuando todas estén pagadas.'}
      </p>
      {d.is_admin && pagadas === 0 && (
        <button type="button" className="st-undo" onClick={() => onAccion('reabrir')} disabled={busy !== null}>
          Reabrir la liquidación
        </button>
      )}
    </section>
  );
}

/** CSV para Excel (separado por «;» y con BOM, como lo abre Excel en español). */
function descargarCsv(d: SettlementOverview, transfers: SettlementTransfer[]) {
  const nombre = (id: string | null) => d.people.find((p) => p.id === id)?.name ?? '';
  const celda = (v: string | number | null) => {
    const t = String(v ?? '');
    return /[;"\r\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
  };
  const filas: (string | number | null)[][] = [
    ['Luks', d.account.name, d.month ? mesLargo(d.month) : 'Todo el paseo'],
    [],
    ['Persona', 'Pagó', 'Le tocaba', 'Saldo'],
    ...d.people.map((p) => [p.name, p.paid, p.share, p.balance]),
    [],
    ['Paga', 'Recibe', 'Monto', 'Pagada'],
    ...transfers.map((t) => [nombre(t.from), nombre(t.to), t.amount, t.paid_at ? t.paid_at.slice(0, 10) : 'no']),
    [],
    ['Fecha', 'Comercio', 'Categoría', 'Total', 'Pagó', ...d.people.map((p) => `Parte de ${p.name}`)],
    ...d.expenses.map((e) => [
      e.expense_date,
      e.merchant,
      e.category,
      e.total_cop,
      nombre(e.payer_person_id),
      ...d.people.map((p) => e.shares.find((x) => x.person_id === p.id)?.amount_cop ?? 0),
    ]),
  ];
  const csv = String.fromCharCode(0xfeff) + filas.map((f) => f.map(celda).join(';')).join('\r\n');
  const archivo = `luks-${d.account.name}-${d.month ? d.month.slice(0, 7) : 'liquidacion'}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .toLowerCase();
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${archivo}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
