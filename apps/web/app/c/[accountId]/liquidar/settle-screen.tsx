'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useState, useTransition } from 'react';
import { FinDeCuenta } from '@/components/archivo-cuenta';
import { lanzarChispas } from '@/components/chispas';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useT } from '@/components/idioma';
import { Amount, Avatar, BillCard, Button, CategoryTag, ICONS, LottieSlot, Sticker } from '@/components/lucas-ui';
import { useDinero } from '@/components/moneda';
import { copiar, copiarLuego } from '@/lib/clipboard';
import { formatDay, formatRange, monthName } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import type { T } from '@/lib/i18n';
import { rico } from '@/lib/i18n/rico';
import { whatsappUrl } from '@/lib/invite';
import { type Moneda, unidades } from '@/lib/moneda';
import { notifyAccountChanged, useAccountChanges } from '@/lib/realtime';
import { minTransfers } from '@/lib/settlement';
import { cobroMessage, displayShare, grupoMessage, sharedLink } from '@/lib/share';
import { asTone, plural, type SettlementOverview, type SettlementPerson, type SettlementTransfer } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

type Accion = 'liquidar' | 'reabrir' | 'cerrar';

/** «2026-09-01» ± n meses → «2026-08-01» */
function otroMes(mes: string, n: number) {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

const mesLargo = (mes: string, t: T) => `${monthName(mes, t.idioma)} ${mes.slice(0, 4)}`;

/**
 * Liquidar (captura 5 del kit): cuánto puso cada uno, cuánto le tocaba y quién
 * le paga a quién para quedar a mano, con el mínimo de transferencias. Antes
 * de liquidar se ve cómo quedaría; al liquidar, las transferencias quedan
 * guardadas y cada una se marca cuando se paga. Un paseo se liquida completo;
 * un hogar, mes a mes.
 */
export function SettleScreen({
  d,
  shareToken,
  phones,
  origin,
  titular = false,
  archivada = false,
}: {
  d: SettlementOverview;
  /** El link público de la cuenta (/r/TOKEN), si ya lo crearon */
  shareToken: string | null;
  /** WhatsApp de cada persona (person_id → 573001234567), para cobrarle directo */
  phones: Record<string, string>;
  origin: string;
  /** Es la persona titular de la cuenta (solo ella la borra del todo) */
  titular?: boolean;
  /** Ya la archivó (solo para ella) */
  archivada?: boolean;
}) {
  const t = useT();
  const $ = useDinero();
  const formatCOP = $.fmt;
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [, startRefresh] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<Accion | null>(null);
  const [token, setToken] = useState(shareToken);
  useEffect(() => setToken(shareToken), [shareToken]);

  const accountId = d.account.id;
  const evento = d.account.type === 'evento';
  const cerrada = d.account.status === 'closed';
  const s = d.settlement;
  const people = new Map(d.people.map((p) => [p.id, p]));
  const nombre = (id: string | null) => (id && people.get(id)?.name) || t('Alguien');

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
    : calculo.transfers.map((x, i) => ({ id: `previa-${i}`, from: x.from, to: x.to, amount: x.amount, paid_at: null, paid_by: null }));
  const total = d.people.reduce((sum, p) => sum + p.paid, 0);
  const pagadas = transfers.filter((x) => x.paid_at).length;
  const pendiente = transfers.reduce((sum, x) => sum + (x.paid_at ? 0 : x.amount), 0);
  const todoPagado = Boolean(s) && pagadas === transfers.length;
  const partes = new Set(d.people.map((p) => p.share));
  const porCabeza = partes.size === 1 && total > 0 ? d.people[0].share : null;
  const bloqueos = d.pending_count + d.incomplete_count;
  const mesDe = (m: string) => (t.idioma === 'en' ? monthName(m, 'en') : monthName(m).toLowerCase());
  const queSe = evento ? t('el paseo') : mesDe(d.month as string);
  const puedeMarcar = (x: SettlementTransfer) => !cerrada && (d.is_admin || x.from === d.my_person_id || x.to === d.my_person_id);

  // Cobrar por WhatsApp: el admin, o a quien le deben. El mensaje lleva el link
  // donde esa persona ve lo suyo (sin instalar nada) y la publicidad de Luks.
  const puedeCobrar = (x: SettlementTransfer) => !cerrada && !x.paid_at && (d.is_admin || x.to === d.my_person_id);
  const mesDelLink = evento ? null : d.month;
  const cobro = (x: SettlementTransfer, tk: string | null) =>
    whatsappUrl(
      cobroMessage({
        debtor: nombre(x.from),
        creditor: nombre(x.to),
        amount: x.amount,
        accountName: d.account.name,
        link: tk ? sharedLink(origin, tk, { person: x.from, month: mesDelLink, idioma: t.idioma }) : null,
        creditorIsMe: x.to === d.my_person_id,
        t,
        moneda: $.moneda,
      }),
      phones[x.from],
    );
  /** El link público; si no existe y es admin, se crea (cobrar es compartir) */
  const asegurarLink = async () => {
    if (token || !d.is_admin) return token;
    const { data, error } = await supabase.rpc('create_share_link', { p_account_id: accountId });
    if (error) {
      setError(humanError(error));
      return null;
    }
    setToken(data as string);
    return data as string;
  };
  /** Abre WhatsApp con un mensaje que lleva el link; si el link no existe todavía, lo crea antes */
  const abrirConLink = async (e: React.MouseEvent<HTMLAnchorElement>, url: (tk: string | null) => string) => {
    if (token || !d.is_admin) return; // el enlace ya va listo
    e.preventDefault();
    // La ventana se abre ya (si se abre después de esperar, el celular la bloquea) y luego va a WhatsApp
    const w = window.open('', '_blank');
    const destino = url(await asegurarLink());
    if (w) w.location.href = destino;
    else window.location.href = destino;
  };
  const botonCobrar = (x: SettlementTransfer) => (
    <a
      className="lu-btn lu-btn--sm lu-btn--secondary"
      href={cobro(x, token)}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => abrirConLink(e, (tk) => cobro(x, tk))}
    >
      {x.to === d.my_person_id ? t('Cobrarle por WhatsApp') : t('Recordarle por WhatsApp')}
    </a>
  );

  // Para todo el grupo: cuánto fue y quién le paga a quién, en un solo mensaje
  const mensajeGrupo = (tk: string | null) =>
    grupoMessage({
      accountName: d.account.name,
      periodo: evento ? null : mesLargo(d.month as string, t),
      total,
      people: d.people.length,
      porCabeza,
      transfers,
      nombre,
      liquidada: Boolean(s),
      link: tk ? sharedLink(origin, tk, { month: mesDelLink, idioma: t.idioma }) : null,
      t,
      moneda: $.moneda,
    });

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
  const marcar = (x: SettlementTransfer, pagada: boolean) => correr(x.id, () => supabase.rpc('mark_transfer', { p_transfer_id: x.id, p_paid: pagada }));
  const reabrir = () => correr('reabrir', () => supabase.rpc('reopen_settlement', { p_settlement_id: (s as NonNullable<typeof s>).id }));
  const cerrar = () => correr('cerrar', () => supabase.rpc('close_account', { p_account_id: accountId }));

  let subtitulo: string;
  const nTransfers = plural(transfers.length, t('transferencia'), t('transferencias'));
  if (total === 0) subtitulo = evento ? t('Todavía no hay gastos para dividir.') : t('Todavía no hay gastos en {que}.', { que: queSe });
  else if (s && todoPagado) subtitulo = cerrada ? t('El paseo quedó saldado y archivado.') : t('Todas las transferencias están pagadas: quedaron a mano.');
  else if (s) subtitulo = t('Con {n} quedan todos a paz y salvo. Márquenlas cuando se hagan.', { n: nTransfers });
  else if (transfers.length)
    subtitulo = `${t('Así quedan a mano, con {n}.', { n: nTransfers })} ${d.is_admin ? t('Cuando estén de acuerdo, liquiden {que}.', { que: queSe }) : t('Quien administra la cuenta la liquida.')}`;
  else subtitulo = t('Cada quien puso lo que le tocaba: nadie le debe a nadie.');

  return (
    <div className="st">
      <header className="st-head">
        <span className="lu-label">
          {evento
            ? `${t('Evento')}${d.account.starts_on ? ` · ${formatRange(d.account.starts_on, d.account.ends_on, t.idioma)}` : ''}`
            : t('Hogar · mes a mes')}
        </span>
        <h1 className="lu-display">{rico(t('¿Quién le paga {a_quien}'), { a_quien: <span className="lu-mark">{t('a quién?')}</span> })}</h1>
        <p className="lu-small lu-muted" style={{ margin: 0 }}>
          {subtitulo}
        </p>
        {!evento && d.month && <MesNav accountId={accountId} mes={d.month} hoy={d.today} liquidados={d.settled_months ?? []} />}
      </header>

      {!s && bloqueos > 0 && (
        <div className="ed-alert" role="status">
          {d.pending_count > 0 && (
            <Sticker tone="revisar" rotate={-5}>
              {t('{n} por revisar', { n: d.pending_count })}
            </Sticker>
          )}
          <span className="lu-small" style={{ flex: 1, minWidth: 180 }}>
            {d.pending_count > 0
              ? d.pending_count === 1
                ? t('Falta revisar un gasto. Ya cuenta abajo, pero para liquidar tiene que estar revisado.')
                : t('Faltan {n} gastos por revisar. Ya cuentan abajo, pero para liquidar tienen que estar revisados.', { n: d.pending_count })
              : ''}
            {d.incomplete_count > 0
              ? ` ${
                  d.incomplete_count === 1
                    ? t('1 gasto no tiene quién pagó o la división completa, y no cuenta hasta corregirlo.')
                    : t('{n} gastos no tienen quién pagó o la división completa, y no cuentan hasta corregirlos.', { n: d.incomplete_count })
                }`
              : ''}
          </span>
          <Link href={`/c/${accountId}/${d.pending_count > 0 ? 'revisar' : 'gastos'}`} className="lu-btn lu-btn--sm lu-btn--primary">
            {d.pending_count > 0 ? t('Revisar') : t('Ver gastos')}
          </Link>
        </div>
      )}

      <div className="st-main">
        {s ? (
          <BillCard
            label={todoPagado ? t('Todo pagado') : t('Falta por pagar')}
            amount={pendiente}
            roll
            highlight={false}
            aside={<span className="lu-bill__denom">{t('{n} DE {total}', { n: pagadas, total: transfers.length })}</span>}
          >
            {transfers.length > 0 && (
              <div className="st-prog" aria-hidden="true">
                {transfers.map((x) => (
                  <i key={x.id} className={x.paid_at ? 'on' : ''} />
                ))}
              </div>
            )}
          </BillCard>
        ) : (
          <BillCard
            label={t('Para quedar a mano')}
            amount={transfers.reduce((sum, x) => sum + x.amount, 0)}
            roll
            denom={d.people.length === 1 ? t('1 PERSONA') : t('{n} PERSONAS', { n: d.people.length })}
          >
            <span>{rico(t('Gastaron {monto}'), { monto: <b>{formatCOP(total)}</b> })}</span>
            <span>{porCabeza ? t('{monto} a cada uno', { monto: formatCOP(porCabeza) }) : t('cada quien su parte')}</span>
          </BillCard>
        )}

        {total === 0 && (
          <div className="ap-empty">
            <LottieSlot name="vacio" width={72} height={72} />
            <span className="lu-small lu-muted">
              {evento
                ? t('Cuando lleguen gastos al paseo, aquí sale quién le paga a quién.')
                : t('Cuando lleguen gastos este mes, aquí sale quién le paga a quién.')}
            </span>
          </div>
        )}
        {transfers.length > 0 ? (
          <ol className="st-list lu-stagger" aria-label={s ? t('Transferencias') : t('Así quedarían las transferencias')}>
            {transfers.map((x, i) => {
              const de = people.get(x.from);
              const para = people.get(x.to);
              return (
                <li
                  key={x.id}
                  className={`st-t${x.paid_at ? ' is-paid' : ''}${s ? '' : ' is-previa'}${!s && puedeCobrar(x) ? ' has-act' : ''}`}
                  style={{ '--i': i } as React.CSSProperties}
                >
                  <div className="st-pair" aria-hidden="true">
                    <Avatar name={nombre(x.from)} tone={asTone(de?.tone, nombre(x.from))} registered={de?.registered} size="sm" />
                    <svg className="st-arrow" viewBox="0 0 40 16" aria-hidden="true">
                      <path d="M2 8h32M28 3l6 5-6 5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <Avatar name={nombre(x.to)} tone={asTone(para?.tone, nombre(x.to))} registered={para?.registered} size="sm" />
                  </div>
                  <div className="st-txt">
                    <span className="st-sent">{rico(t('{de} le paga a {para}'), { de: <b>{nombre(x.from)}</b>, para: <b>{nombre(x.to)}</b> })}</span>
                    <span className="st-lucas">{$.corto(x.amount)}</span>
                  </div>
                  <Amount value={x.amount} size="lg" className="st-amt" />
                  {!s && puedeCobrar(x) && <div className="st-act">{botonCobrar(x)}</div>}
                  {s && (
                    <div className="st-act">
                      {puedeCobrar(x) && botonCobrar(x)}
                      {x.paid_at ? (
                        <>
                          <Sticker tone="pagado" rotate={i % 2 ? 5 : -5} sub={formatDay(new Date(x.paid_at), undefined, t.idioma)} />
                          {puedeMarcar(x) && (
                            <button type="button" className="st-undo" onClick={() => marcar(x, false)} disabled={busy === x.id}>
                              {t('deshacer')}
                            </button>
                          )}
                        </>
                      ) : puedeMarcar(x) ? (
                        <Button
                          size="sm"
                          onClick={(e) => {
                            lanzarChispas(e);
                            marcar(x, true);
                          }}
                          disabled={busy === x.id}
                        >
                          {busy === x.id ? t('Guardando…') : t('Marcar pagada')}
                        </Button>
                      ) : (
                        <span className="lu-small lu-muted">{t('Sin pagar')}</span>
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
              <span className="lu-small">{t('Nadie le debe a nadie: cada quien ya puso exactamente lo suyo.')}</span>
            </div>
          )
        )}
        {!calculo.ok && !s && (
          <p className="lu-small" role="alert">
            {t('Los saldos no cuadran ({error}). Recarguen la página; si sigue, revisen los gastos.', { error: calculo.error })}
          </p>
        )}

        {total > 0 && (calculo.ok || s) && (
          <MandarAlGrupo
            mensaje={mensajeGrupo(token)}
            // Si falta el link y es admin, se crea al mandarlo: en la vista previa ya va
            vista={mensajeGrupo(token ?? (d.is_admin ? '…' : null))}
            conLink={Boolean(token) || d.is_admin}
            imagen={`/c/${accountId}/liquidar/imagen?${new URLSearchParams({
              ...(mesDelLink ? { mes: mesDelLink.slice(0, 7) } : {}),
              v: `${total}-${transfers.length}-${pagadas}`,
            })}`}
            onMandar={(e) => abrirConLink(e, (tk) => whatsappUrl(mensajeGrupo(tk)))}
            onCopiar={() => copiarLuego(asegurarLink().then(mensajeGrupo))}
          />
        )}
      </div>

      <section className="st-people" aria-labelledby="st-people-t">
        <h2 id="st-people-t" className="lu-title" style={{ margin: 0 }}>
          {t('¿Cuánto puso cada uno?')}
        </h2>
        <p className="lu-small lu-muted" style={{ margin: 0 }}>
          {porCabeza
            ? t('A cada uno le tocaba {monto}. Toca a alguien para ver qué pagó.', { monto: formatCOP(porCabeza) })
            : t('A cada quien le toca su parte de los gastos en que participó. Toca a alguien para ver qué pagó.')}
        </p>
        <ul className="st-pp lu-stagger">
          {d.people.map((p, i) => (
            <Persona key={p.id} i={i} p={p} yo={p.id === d.my_person_id} gastos={d.expenses.filter((e) => e.payer_person_id === p.id)} />
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
          fin={cerrada ? <FinDeCuenta accountId={accountId} accountName={d.account.name} archivada={archivada} titular={titular} /> : null}
        />
        {error && (
          <p className="lu-small st-error" role="alert">
            {error}
          </p>
        )}

        <Compartir
          accountId={accountId}
          isAdmin={d.is_admin}
          token={token}
          link={token ? sharedLink(origin, token, { month: mesDelLink, idioma: t.idioma }) : null}
          onToken={setToken}
          onError={(e) => setError(humanError(e))}
        />

        <section>
          <h2 className="lu-title" style={{ marginBottom: 12 }}>
            {t('Descargar')}
          </h2>
          <div className="st-exp">
            <button type="button" className="st-file" onClick={() => descargarCsv(d, transfers, t, $.moneda)}>
              <span className="st-file__ext" style={{ background: 'var(--tono-azul)' }}>
                CSV
              </span>
              {t('Para Excel')}
            </button>
          </div>
          <p className="lu-small lu-muted" style={{ margin: '10px 0 0' }}>
            {t('Con {gastos}, lo que puso cada uno y las transferencias.', { gastos: plural(d.expenses.length, t('gasto'), t('gastos')) })}
          </p>
        </section>

        <section className="st-why">
          <h2 className="lu-label" style={{ margin: '0 0 6px' }}>
            {t('¿Cómo se calculó?')}
          </h2>
          <p className="lu-small" style={{ margin: 0 }}>
            {porCabeza ? (
              <>{rico(t('A cada quien le tocaba {monto}.'), { monto: <b className="lu-num">{formatCOP(porCabeza)}</b> })} </>
            ) : (
              `${t('A cada quien le toca su parte de cada gasto en que participó.')} `
            )}
            {t('Al que puso de más le devuelven, el que puso de menos completa, y se cruzan las deudas para hacer el menor número de transferencias.')}
          </p>
        </section>
      </aside>

      <ConfirmDialog
        open={confirmar === 'liquidar'}
        onOpenChange={(o) => !o && setConfirmar(null)}
        title={t('¿Liquidar {que}?', { que: queSe })}
        confirmLabel={t('Liquidar {que}', { que: queSe })}
        danger={false}
        busy={busy === 'liquidar'}
        onConfirm={liquidar}
      >
        {t('Quedan {n} por hacer.', { n: nTransfers })}{' '}
        {evento
          ? t('Los gastos del paseo quedan congelados y no entran gastos nuevos.')
          : t('Los gastos de {que} quedan congelados; los otros meses siguen igual.', { que: queSe })}{' '}
        {t('Si falta algo, se puede reabrir mientras nadie haya pagado.')}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmar === 'reabrir'}
        onOpenChange={(o) => !o && setConfirmar(null)}
        title={t('¿Reabrir la liquidación?')}
        confirmLabel={t('Reabrir')}
        busy={busy === 'reabrir'}
        onConfirm={reabrir}
      >
        {evento
          ? t('Se borran las transferencias y los gastos se pueden volver a corregir; el paseo vuelve a recibir gastos. Después pueden liquidar de nuevo.')
          : t('Se borran las transferencias y los gastos se pueden volver a corregir. Después pueden liquidar de nuevo.')}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmar === 'cerrar'}
        onOpenChange={(o) => !o && setConfirmar(null)}
        title={t('¿Cerrar el paseo?')}
        confirmLabel={t('Cerrar paseo')}
        danger={false}
        busy={busy === 'cerrar'}
        onConfirm={cerrar}
      >
        {t('Queda archivado con su liquidación, en solo lectura. Ya no entran gastos ni personas.')}
      </ConfirmDialog>
    </div>
  );
}

/**
 * Al final de la lista: un solo mensaje para todo el grupo de WhatsApp con
 * cuánto fue y quién le paga a quién (aparte de los cobros de cada uno). Se ve
 * antes como les llega: la imagen del link y el texto con su formato.
 */
function MandarAlGrupo({
  mensaje,
  vista,
  conLink,
  imagen,
  onMandar,
  onCopiar,
}: {
  /** El mensaje como va ya (sin link, si todavía no existe) */
  mensaje: string;
  /** El mensaje como les llega */
  vista: string;
  /** Si el mensaje lleva (o va a llevar) el link de las cuentas */
  conLink: boolean;
  /** La imagen de las cuentas, la misma de la vista previa del link */
  imagen: string;
  onMandar: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  onCopiar: () => Promise<boolean>;
}) {
  const t = useT();
  const [copiado, setCopiado] = useState<'si' | 'no' | null>(null);
  return (
    <section className="st-grupo" aria-labelledby="st-grupo-t">
      <div className="st-grupo__txt">
        <span className="st-grupo__kicker">
          {ICONS.whatsapp}
          {t('Para todo el grupo')}
        </span>
        <h2 id="st-grupo-t" className="lu-title" style={{ margin: 0 }}>
          {t('Mándenle las cuentas a todos')}
        </h2>
        <p className="lu-small" style={{ margin: 0 }}>
          {conLink
            ? t('Un solo mensaje con cuánto fue y quién le paga a quién, y el link donde cada uno ve lo suyo. Escojan el grupo en WhatsApp y listo.')
            : t('Un solo mensaje con cuánto fue y quién le paga a quién. Escojan el grupo en WhatsApp y listo.')}
        </p>
        <div className="st-exp">
          <a
            className="lu-btn lu-btn--primary st-grupo__btn"
            href={whatsappUrl(mensaje)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              lanzarChispas(e);
              onMandar(e);
            }}
          >
            {ICONS.whatsapp}
            {t('Mandar al grupo')}
          </a>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              setCopiado((await onCopiar()) ? 'si' : 'no');
              setTimeout(() => setCopiado(null), 2200);
            }}
          >
            {copiado === 'si' ? t('¡Copiado!') : copiado === 'no' ? t('No se pudo copiar') : t('Copiar mensaje')}
          </Button>
        </div>
      </div>

      <figure className="st-grupo__chat">
        <figcaption className="lu-label">{t('Así les llega')}</figcaption>
        <div className="st-grupo__burbuja">
          {conLink && (
            // biome-ignore lint/performance/noImgElement: la imagen la genera una ruta propia (next/og); next/image no le suma nada
            <img className="st-grupo__img" src={imagen} alt={t('Imagen con el total y quién le paga a quién')} width={1200} height={630} loading="lazy" />
          )}
          <p className="st-grupo__msg">{formatoWhatsapp(vista)}</p>
        </div>
      </figure>
    </section>
  );
}

/** *negrilla*, _cursiva_, ~tachado~ y links, como los muestra WhatsApp */
function formatoWhatsapp(texto: string) {
  const partes: ReactNode[] = [];
  let desde = 0;
  for (const m of texto.matchAll(/https?:\/\/\S+|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~/g)) {
    const i = m.index ?? 0;
    if (i > desde) partes.push(texto.slice(desde, i));
    const trozo = m[0];
    const dentro = trozo.slice(1, -1);
    if (trozo.startsWith('http')) {
      partes.push(
        <span key={i} className="st-grupo__url">
          {trozo}
        </span>,
      );
    } else if (trozo[0] === '*') partes.push(<b key={i}>{dentro}</b>);
    else if (trozo[0] === '_') partes.push(<i key={i}>{dentro}</i>);
    else partes.push(<s key={i}>{dentro}</s>);
    desde = i + trozo.length;
  }
  if (desde < texto.length) partes.push(texto.slice(desde));
  return partes;
}

/**
 * Compartir las cuentas con quien no usa la app: un link (/r/TOKEN) donde cada
 * uno ve cuánto puso, cuánto le toca y a quién le paga. Lo crea un admin; con
 * «Cambiar el link» el anterior deja de servir.
 */
function Compartir({
  accountId,
  isAdmin,
  token,
  link,
  onToken,
  onError,
}: {
  accountId: string;
  isAdmin: boolean;
  token: string | null;
  link: string | null;
  onToken: (token: string | null) => void;
  onError: (e: { message?: string }) => void;
}) {
  const t = useT();
  const [supabase] = useState(() => createClient());
  const [busy, setBusy] = useState(false);
  const [copiado, setCopiado] = useState<'si' | 'no' | null>(null);
  const [quitar, setQuitar] = useState(false);

  const crear = async (renovar: boolean) => {
    setBusy(true);
    const { data, error } = await supabase.rpc('create_share_link', { p_account_id: accountId, p_renew: renovar });
    setBusy(false);
    if (error) return onError(error);
    onToken(data as string);
  };
  const dejar = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('delete_share_link', { p_account_id: accountId });
    setBusy(false);
    setQuitar(false);
    if (error) return onError(error);
    onToken(null);
  };

  return (
    <section className="st-share" aria-labelledby="st-share-t">
      <h2 id="st-share-t" className="lu-title" style={{ margin: 0 }}>
        {t('Compartir las cuentas')}
      </h2>
      {token && link ? (
        <>
          <p className="lu-small" style={{ margin: 0 }}>
            {t('Cada uno ve cuánto puso, cuánto le toca y a quién le paga, sin instalar nada. Al cobrarle a alguien, el mensaje le lleva directo a lo suyo.')}
          </p>
          <div className="st-share__link lu-num">{displayShare(link)}</div>
          <div className="st-exp">
            <Button
              size="sm"
              onClick={async () => {
                setCopiado((await copiar(link)) ? 'si' : 'no');
                setTimeout(() => setCopiado(null), 2200);
              }}
            >
              {copiado === 'si' ? t('¡Copiado!') : copiado === 'no' ? t('Cópialo a mano') : t('Copiar link')}
            </Button>
          </div>
          {isAdmin && (
            <div className="st-exp">
              <button type="button" className="st-undo" onClick={() => crear(true)} disabled={busy}>
                {t('Cambiar el link')}
              </button>
              <button type="button" className="st-undo" onClick={() => setQuitar(true)} disabled={busy}>
                {t('Dejar de compartir')}
              </button>
            </div>
          )}
          <ConfirmDialog
            open={quitar}
            onOpenChange={setQuitar}
            title={t('¿Dejar de compartir?')}
            confirmLabel={t('Dejar de compartir')}
            busy={busy}
            onConfirm={dejar}
          >
            {t('El link deja de funcionar para todos. Si después lo vuelven a crear, sale uno nuevo.')}
          </ConfirmDialog>
        </>
      ) : isAdmin ? (
        <>
          <p className="lu-small" style={{ margin: 0 }}>
            {t(
              'Un link para que cada uno vea cuánto puso, cuánto le toca y a quién le paga, aunque nunca haya abierto Luks. Lo ve cualquiera que tenga el link; no muestra fotos ni números.',
            )}
          </p>
          <Button size="sm" onClick={() => crear(false)} disabled={busy}>
            {busy ? t('Creando…') : t('Crear el link')}
          </Button>
        </>
      ) : (
        <p className="lu-small lu-muted" style={{ margin: 0 }}>
          {t('Quien administra la cuenta puede crear un link para que todos vean las cuentas, aunque no usen Luks.')}
        </p>
      )}
    </section>
  );
}

/** ‹ Agosto · Septiembre 2026 · Octubre › (hasta el mes en curso) */
function MesNav({ accountId, mes, hoy, liquidados }: { accountId: string; mes: string; hoy: string; liquidados: string[] }) {
  const t = useT();
  const antes = otroMes(mes, -1);
  const despues = otroMes(mes, 1);
  const hayDespues = despues <= `${hoy.slice(0, 7)}-01`;
  const ir = (m: string) => `/c/${accountId}/liquidar?mes=${m.slice(0, 7)}`;
  return (
    <nav className="st-mes" aria-label={t('Mes')}>
      <Link href={ir(antes)} className="st-mes__btn" aria-label={t('Mes anterior: {mes}', { mes: mesLargo(antes, t) })}>
        ‹
      </Link>
      <span className="st-mes__now">
        {mesLargo(mes, t)}
        {liquidados.includes(mes) && <span className="st-mes__ok">{t('liquidado')}</span>}
      </span>
      {hayDespues ? (
        <Link href={ir(despues)} className="st-mes__btn" aria-label={t('Mes siguiente: {mes}', { mes: mesLargo(despues, t) })}>
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
function Persona({ p, i, yo, gastos }: { p: SettlementPerson; i: number; yo: boolean; gastos: SettlementOverview['expenses'] }) {
  const t = useT();
  const formatCOP = useDinero().fmt;
  return (
    <li style={{ '--i': i } as React.CSSProperties}>
      <details className="st-p">
        <summary>
          <Avatar name={p.name} tone={asTone(p.tone, p.name)} size="sm" registered={p.registered} />
          <span className="st-p__who">
            <b>
              {p.name}
              {yo ? ` ${t('(tú)')}` : ''}
            </b>
            <span className="lu-muted st-p__sub">
              {t('pagó {monto}', { monto: formatCOP(p.paid) })} · {t('le tocaba {monto}', { monto: formatCOP(p.share) })}
            </span>
          </span>
          <span className="st-p__bal">
            <Amount value={p.balance} sign tone={p.balance >= 0 ? 'pos' : 'neg'} />
            <span className="lu-muted">{p.balance === 0 ? t('a paz y salvo') : p.balance > 0 ? t('le deben') : t('debe')}</span>
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
                  <span className="lu-muted"> · {formatDay(e.expense_date, undefined, t.idioma)}</span>
                </span>
                <Amount value={e.total_cop} size="sm" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="lu-small lu-muted st-p__nada">{t('No pagó ningún gasto.')}</p>
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
  fin,
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
  /** Cerrada: archivarla o borrarla del todo */
  fin?: ReactNode;
}) {
  const t = useT();
  const s = d.settlement;
  if (cerrada) {
    return (
      <section className="st-close is-ready">
        <div className="st-close__row">
          <LottieSlot name="cierre-evento" width={88} height={88} />
          <div>
            <h2 className="lu-title" style={{ margin: 0 }}>
              {evento ? t('Paseo cerrado') : t('Cuenta cerrada')}
            </h2>
            <p className="lu-small" style={{ margin: '4px 0 0' }}>
              {t('Queda guardado con su liquidación.')}
            </p>
          </div>
        </div>
        <Sticker tone="cerrado" size="lg" rotate={-5}>
          {t('Saldado')}
        </Sticker>
        {fin}
      </section>
    );
  }
  if (!s) {
    return (
      <section className="st-close">
        <LottieSlot name="transferencia" width={64} height={64} />
        <p className="lu-small" style={{ margin: 0 }}>
          <b>{t('¿Listos?')}</b>{' '}
          {evento
            ? t('Al liquidar {que} sus gastos quedan congelados y ya no entran gastos nuevos. Si falta algo, se puede reabrir mientras nadie haya pagado.', {
                que: queSe,
              })
            : t('Al liquidar {que} sus gastos quedan congelados. Si falta algo, se puede reabrir mientras nadie haya pagado.', { que: queSe })}
        </p>
        {d.is_admin ? (
          <Button onClick={() => onAccion('liquidar')} disabled={!puedeLiquidar || busy !== null}>
            {t('Liquidar {que}', { que: queSe })}
          </Button>
        ) : (
          <p className="lu-small lu-muted" style={{ margin: 0 }}>
            {t('Quien administra la cuenta es quien liquida.')}
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
              {t('¡Todo pagado!')}
            </h2>
            <p className="lu-small" style={{ margin: '4px 0 0' }}>
              {evento
                ? t('Ya pueden cerrar el paseo. Después no entran más gastos.')
                : t('{mes} quedó a paz y salvo.', { mes: monthName(d.month as string, t.idioma) })}
            </p>
          </div>
        </div>
        {evento && d.is_admin && (
          <Button onClick={() => onAccion('cerrar')} disabled={busy !== null}>
            {t('Cerrar paseo')}
          </Button>
        )}
      </section>
    );
  }
  return (
    <section className="st-close">
      <p className="lu-small" style={{ margin: 0 }}>
        <b>{faltan === 1 ? t('Falta 1 transferencia.') : t('Faltan {n} transferencias.', { n: faltan })}</b>{' '}
        {evento ? t('El paseo se cierra cuando todas estén pagadas.') : t('El mes queda saldado cuando todas estén pagadas.')}
      </p>
      {d.is_admin && pagadas === 0 && (
        <button type="button" className="st-undo" onClick={() => onAccion('reabrir')} disabled={busy !== null}>
          {t('Reabrir la liquidación')}
        </button>
      )}
    </section>
  );
}

/** CSV para Excel (separado por «;» y con BOM, como lo abre Excel en español). */
function descargarCsv(d: SettlementOverview, transfers: SettlementTransfer[], t: T, moneda: Moneda) {
  // En la moneda de verdad: en dólares, 1250 centavos → 12.5
  const plata = (n: number) => unidades(n, moneda);
  const nombre = (id: string | null) => d.people.find((p) => p.id === id)?.name ?? '';
  const celda = (v: string | number | null) => {
    const texto = String(v ?? '');
    return /[;,"\r\n]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
  };
  const filas: (string | number | null)[][] = [
    ['Luks', d.account.name, d.month ? mesLargo(d.month, t) : t('Todo el paseo')],
    [],
    [t('Persona'), t('Pagó'), t('Le tocaba'), t('Saldo')],
    ...d.people.map((p) => [p.name, plata(p.paid), plata(p.share), plata(p.balance)]),
    [],
    [t('Paga'), t('Recibe'), t('Monto'), t('Pagada')],
    ...transfers.map((x) => [nombre(x.from), nombre(x.to), plata(x.amount), x.paid_at ? x.paid_at.slice(0, 10) : t('no')]),
    [],
    [t('Fecha'), t('Comercio'), t('Categoría'), t('Total'), t('Quién pagó'), ...d.people.map((p) => t('Parte de {nombre}', { nombre: p.name }))],
    ...d.expenses.map((e) => [
      e.expense_date,
      e.merchant,
      e.category,
      plata(e.total_cop),
      nombre(e.payer_person_id),
      ...d.people.map((p) => plata(e.shares.find((x) => x.person_id === p.id)?.amount_cop ?? 0)),
    ]),
  ];
  // Excel en español abre «;»; en inglés, «,»
  const sep = t.idioma === 'en' ? ',' : ';';
  const csv = String.fromCharCode(0xfeff) + filas.map((f) => f.map(celda).join(sep)).join('\r\n');
  const archivo = `luks-${d.account.name}-${d.month ? d.month.slice(0, 7) : t('liquidacion')}`
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
