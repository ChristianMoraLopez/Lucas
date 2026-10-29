'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useState, useTransition } from 'react';
import { FinDeCuenta } from '@/components/archivo-cuenta';
import { lanzarChispas } from '@/components/chispas';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useT } from '@/components/idioma';
import { ItemsDeUno } from '@/components/items-de-uno';
import { Amount, Avatar, BillCard, Button, CategoryTag, ICONS, LottieSlot, Sticker } from '@/components/lucas-ui';
import { useDinero } from '@/components/moneda';
import { Segmento } from '@/components/segmento';
import { copiar, copiarLuego } from '@/lib/clipboard';
import { formatDay, formatRange, monthName } from '@/lib/dates';
import { porPersona } from '@/lib/deudas';
import { humanError } from '@/lib/errors';
import type { T } from '@/lib/i18n';
import { rico } from '@/lib/i18n/rico';
import { whatsappUrl } from '@/lib/invite';
import { type Moneda, unidades } from '@/lib/moneda';
import { notifyAccountChanged, useAccountChanges } from '@/lib/realtime';
import { reciboDe } from '@/lib/recibo';
import { minTransfers } from '@/lib/settlement';
import { calcularTransferencias, cobroMessage, cruzaDeudas, detalleCobro, displayShare, grupoMessage, sharedLink } from '@/lib/share';
import { type AvisosDeCobro, asTone, type Pago, plural, type SettlementOverview, type SettlementPerson, type SettlementTransfer } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';
import { PorPersona } from './por-persona';

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
  puedeBorrar = false,
  archivada = false,
  avisos = null,
}: {
  d: SettlementOverview;
  /** El link público de la cuenta (/r/TOKEN), si ya lo crearon */
  shareToken: string | null;
  /** WhatsApp de cada persona (person_id → 573001234567), para cobrarle directo */
  phones: Record<string, string>;
  origin: string;
  /** La administra (titular o admin): puede borrarla del todo */
  puedeBorrar?: boolean;
  /** Ya la archivó (solo para ella) */
  archivada?: boolean;
  /** Los avisos de cobro de Mister Luks (null si la base todavía no los tiene) */
  avisos?: AvisosDeCobro | null;
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

  // Cómo le pagan a cada quien que lo puso en su perfil (migración 570): en los cobros y en las tarjetas
  const [pagos, setPagos] = useState<Record<string, Pago>>({});
  useEffect(() => {
    let vivo = true;
    supabase.rpc('como_les_pagan', { p_account_id: d.account.id }).then(({ data, error }) => {
      // Sin la 570 en la base: sin datos de pago, como antes
      if (vivo && !error && data) setPagos(data as Record<string, Pago>);
    });
    return () => {
      vivo = false;
    };
  }, [supabase, d.account.id]);

  const refresh = () => startRefresh(() => router.refresh());
  // Otra persona marca una transferencia, liquidan o llega un gasto: se vuelve a pedir
  useAccountChanges(accountId, refresh, ['expenses', 'settlements', 'settlement_transfers', 'settlement_payments']);

  // Antes de liquidar: así quedarían (cada quien a quien pagó por él, o cruzando las deudas)
  const calculo = useMemo(() => {
    try {
      return { ok: true as const, transfers: calcularTransferencias(d) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message, transfers: [] };
    }
  }, [d]);
  const cruza = cruzaDeudas(d);
  // Para comparar: cuántas serían cruzando las deudas
  const minimas = useMemo(() => {
    try {
      return minTransfers(d.people.map((p) => ({ id: p.id, name: p.name, balance: p.balance }))).length;
    } catch {
      return null;
    }
  }, [d.people]);
  const cambiarModo = (directo: boolean) => correr('modo', () => supabase.rpc('set_settle_mode', { p_account_id: accountId, p_direct: directo }));

  const transfers: SettlementTransfer[] = s
    ? s.transfers
    : calculo.transfers.map((x, i) => ({ id: `previa-${i}`, from: x.from, to: x.to, amount: x.amount, paid_at: null, paid_by: null }));
  // Una tarjeta por persona: a quién le paga, cuánto y por qué
  const tarjetas = porPersona({ people: d.people, expenses: d.expenses, transfers, payments: d.payments, cruza, yo: d.my_person_id });
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
        detalle: detalleCobro({ expenses: d.expenses, debtorId: x.from, creditorId: x.to, transfers, nombre, t, moneda: $.moneda }),
        pago: pagos[x.to] ?? null,
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
  // Los botones de cada transferencia, en la tarjeta de quien paga
  const acciones = (x: SettlementTransfer, i: number) =>
    !s ? (
      puedeCobrar(x) && botonCobrar(x)
    ) : (
      <>
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
      </>
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
        {!s && total > 0 && d.direct !== undefined && (
          <div className="st-modo">
            {d.is_admin && !cerrada ? (
              <Segmento
                opciones={[
                  { value: 'directo', label: t('A quien pagó') },
                  { value: 'cruzar', label: t('Cruzar deudas') },
                ]}
                value={cruza ? 'cruzar' : 'directo'}
                onChange={(v) => v !== (cruza ? 'cruzar' : 'directo') && cambiarModo(v === 'directo')}
                label={t('Cómo se paga')}
              />
            ) : null}
            <p className="lu-small lu-muted" style={{ margin: 0 }}>
              {cruza
                ? t('Se cruzan las deudas para hacer menos transferencias: puede que le pagues a alguien que no pagó lo tuyo.')
                : t('Cada quien le paga a cada persona lo que esa persona pagó por él.')}
              {!cruza && minimas !== null && minimas < transfers.length
                ? ` ${t('Cruzando deudas serían {n} en vez de {m}.', { n: minimas, m: transfers.length })}`
                : ''}
            </p>
          </div>
        )}
        {tarjetas.length > 0 && (transfers.length > 0 || (d.payments?.length ?? 0) > 0) ? (
          <PorPersona tarjetas={tarjetas} people={people} yo={d.my_person_id} cruza={cruza} liquidada={Boolean(s)} acciones={acciones} pagos={pagos} />
        ) : (
          total > 0 && (
            <div className="st-cero">
              <LottieSlot name="todo-revisado" width={72} height={72} />
              <span className="lu-small">{t('Nadie le debe a nadie: cada quien ya puso exactamente lo suyo.')}</span>
            </div>
          )
        )}
        {(d.payments?.length ?? 0) > 0 && (
          <section className="st-pagos" aria-labelledby="st-pagos-t">
            <h2 id="st-pagos-t" className="lu-label" style={{ margin: 0 }}>
              {t('Lo que ya se pagó')}
            </h2>
            <ul className="st-pagos__l">
              {d.payments?.map((x) => (
                <li key={x.id} className="st-pagos__p">
                  <span>
                    {t('{de} le pagó a {para}', { de: nombre(x.from), para: nombre(x.to) })}
                    <span className="lu-muted"> · {formatDay(new Date(x.paid_at), undefined, t.idioma)}</span>
                  </span>
                  <b className="lu-num">{formatCOP(x.amount)}</b>
                </li>
              ))}
            </ul>
            <p className="lu-small lu-muted" style={{ margin: 0 }}>
              {t('Ya cuenta en los saldos: las transferencias de arriba solo piden lo que falta.')}
            </p>
          </section>
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
            <Persona key={p.id} i={i} p={p} yo={p.id === d.my_person_id} gastos={d.expenses} nombre={nombre} />
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
          puedeLiquidar={bloqueos === 0 && total > 0 && calculo.ok}
          queSe={queSe}
          busy={busy}
          onAccion={setConfirmar}
          fin={cerrada ? <FinDeCuenta accountId={accountId} accountName={d.account.name} archivada={archivada} puedeBorrar={puedeBorrar} /> : null}
        />
        {error && (
          <p className="lu-small st-error" role="alert">
            {error}
          </p>
        )}

        {avisos && !cerrada && (
          <AvisosCobro
            avisos={avisos}
            personas={d.people.length}
            isAdmin={d.is_admin}
            busy={busy === 'avisos'}
            onCambiar={(on) => correr('avisos', () => supabase.rpc('set_auto_cobros', { p_account_id: accountId, p_on: on }))}
          />
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
            {cruza
              ? t('Al que puso de más le devuelven, el que puso de menos completa, y se cruzan las deudas para hacer el menor número de transferencias.')
              : t('Cada quien le paga a cada persona lo que esa persona pagó por él; si dos se deben entre ellos, solo va la diferencia.')}
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
          ? t('Los gastos del paseo quedan congelados. Si llega uno nuevo, el paseo se reabre solo.')
          : t('Los gastos de {que} quedan congelados; los otros meses siguen igual.', { que: queSe })}{' '}
        {t('Si falta algo, se puede reabrir: lo que ya pagaron queda anotado.')}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmar === 'reabrir'}
        onOpenChange={(o) => !o && setConfirmar(null)}
        title={t('¿Reabrir la liquidación?')}
        confirmLabel={t('Reabrir')}
        busy={busy === 'reabrir'}
        onConfirm={reabrir}
      >
        {t(
          'Se borran las transferencias que falta pagar (las pagadas quedan anotadas) y los gastos se pueden volver a corregir. Después pueden liquidar de nuevo.',
        )}
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

/** Una persona: lo que pagó, lo que le tocaba y su saldo; al tocarla, qué pagó y qué le tocó (ítem por ítem). */
function Persona({
  p,
  i,
  yo,
  gastos,
  nombre,
}: {
  p: SettlementPerson;
  i: number;
  yo: boolean;
  gastos: SettlementOverview['expenses'];
  nombre: (id: string | null) => string;
}) {
  const t = useT();
  const formatCOP = useDinero().fmt;
  const pago = gastos.filter((e) => e.payer_person_id === p.id);
  const toco = gastos.flatMap((e) => {
    const r = reciboDe(e, p.id);
    return r ? [{ e, r }] : [];
  });
  const tag = (e: SettlementOverview['expenses'][number]) =>
    e.category ? (
      <CategoryTag name={e.category} showName={false} size="sm" letter={e.category_letter ?? undefined} tone={asTone(e.category_tone)} />
    ) : (
      <span className="st-p__sin" aria-hidden="true" />
    );
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
              {(p.sent ?? 0) > 0 && ` · ${t('ya transfirió {monto}', { monto: formatCOP(p.sent ?? 0) })}`}
              {(p.received ?? 0) > 0 && ` · ${t('ya recibió {monto}', { monto: formatCOP(p.received ?? 0) })}`}
            </span>
          </span>
          <span className="st-p__bal">
            <Amount value={p.balance} sign tone={p.balance >= 0 ? 'pos' : 'neg'} />
            <span className="lu-muted">{p.balance === 0 ? t('a paz y salvo') : p.balance > 0 ? t('le deben') : t('debe')}</span>
          </span>
        </summary>
        <div className="st-p__det">
          <h3 className="lu-label st-p__h">{t('Pagó')}</h3>
          {pago.length ? (
            <ul className="st-p__gastos">
              {pago.map((e) => (
                <li key={e.id} className="st-p__g">
                  {tag(e)}
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
          <h3 className="lu-label st-p__h">{t('Le tocó')}</h3>
          {toco.length ? (
            <ul className="st-p__gastos">
              {toco.map(({ e, r }) => (
                <li key={e.id} className="st-p__g">
                  {tag(e)}
                  <span className="st-p__m">
                    {e.merchant}
                    <span className="lu-muted">
                      {' · '}
                      {formatDay(e.expense_date, undefined, t.idioma)}
                      {e.payer_person_id && e.payer_person_id !== p.id ? ` · ${t('lo pagó {nombre}', { nombre: nombre(e.payer_person_id) })}` : ''}
                    </span>
                  </span>
                  <Amount value={r.parte} size="sm" />
                  <ItemsDeUno recibo={r} label={t('Lo que pidió {nombre} en {comercio}', { nombre: p.name, comercio: e.merchant })} fmt={formatCOP} t={t} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="lu-small lu-muted st-p__nada">{t('No le tocó nada.')}</p>
          )}
        </div>
      </details>
    </li>
  );
}

/**
 * Avisos de cobro: al liquidar, Mister Luks le escribe a cada quien que debe
 * (por privado si ya le escribió; si no, en el grupo) y se lo recuerda.
 */
function AvisosCobro({
  avisos,
  personas,
  isAdmin,
  busy,
  onCambiar,
}: {
  avisos: AvisosDeCobro;
  personas: number;
  isAdmin: boolean;
  busy: boolean;
  onCambiar: (on: boolean) => void;
}) {
  const t = useT();
  const privado = avisos.por_privado.length;
  const nadie = !avisos.grupo && privado === 0;
  return (
    <section className="st-avisos" aria-labelledby="st-avisos-t">
      <label className="wa-switch st-avisos__sw">
        <input
          type="checkbox"
          role="switch"
          aria-checked={avisos.on}
          className="lu-switch"
          checked={avisos.on}
          disabled={!isAdmin || busy}
          onChange={(e) => onCambiar(e.target.checked)}
        />
        <span id="st-avisos-t" className="lu-title" style={{ fontSize: 16 }}>
          {t('Avisar a quien debe')}
        </span>
      </label>
      <p className="lu-small" style={{ margin: 0 }}>
        {t(
          'Al liquidar, Mister Luks le escribe a cada uno cuánto debe, a quién y por qué (ítem por ítem), y se lo recuerda cada 3 días hasta que pague (máximo 3 veces). Cuando pagan, le responden «ya pagué» y queda marcado.',
        )}
      </p>
      <p className="lu-small lu-muted" style={{ margin: 0 }}>
        {nadie
          ? t('Para avisar, Mister Luks tiene que estar en el grupo de la cuenta (o que le escriban por privado).')
          : privado === 0
            ? t('Nadie le ha escrito por privado a Mister Luks todavía: les avisa en el grupo. Por privado solo le escribe a quien le escribió primero.')
            : t('Por privado a {n} de {total} (los que ya le escribieron a Mister Luks); a los demás, en el grupo.', { n: privado, total: personas })}
      </p>
      {!isAdmin && (
        <p className="lu-small lu-muted" style={{ margin: 0 }}>
          {t('Solo quien administra la cuenta los prende o los apaga.')}
        </p>
      )}
    </section>
  );
}

/** Lo que sigue: liquidar, cuánto falta, cerrar el paseo o reabrir. */
function Cierre({
  d,
  evento,
  cerrada,
  todoPagado,
  faltan,
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
            ? t('Al liquidar {que} sus gastos quedan congelados. Si después llega un gasto nuevo, el paseo se reabre solo y lo que ya pagaron queda anotado.', {
                que: queSe,
              })
            : t('Al liquidar {que} sus gastos quedan congelados. Si falta algo, se puede reabrir: lo que ya pagaron queda anotado.', { que: queSe })}
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
                ? t('Ya pueden cerrar el paseo (después no entran más gastos) o dejarlo así: si llega otro gasto, se reabre solo.')
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
      {d.is_admin && (
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
