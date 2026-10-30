import Link from 'next/link';
import { Archivadas, FilaArchivable } from '@/components/archivo-cuenta';
import { GruposDetectados } from '@/components/grupos-detectados';
import { Guia } from '@/components/guia';
import { InvitacionesRecibidas } from '@/components/invitaciones-recibidas';
import { LogoLink } from '@/components/logo-link';
import { lucas } from '@/components/lucas-core';
import { Amount, Avatar, BillCard, LottieSlot, Sticker } from '@/components/lucas-ui';
import { MenuPrincipal } from '@/components/menu-principal';
import { RecomendarLuks } from '@/components/recomendar-luks';
import { Sombrerito } from '@/components/sombrerito';
import { eventMoment, formatRange, monthName, todayInBogota } from '@/lib/dates';
import type { T } from '@/lib/i18n';
import { rico } from '@/lib/i18n/rico';
import { getT } from '@/lib/i18n/server';
import { dinero, type Moneda } from '@/lib/moneda';
import { type AccountOverview, accountGlyph, accountTone, asTone, type GrupoDetectado, type InvitacionRecibida, plural } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';

export default async function AccountPickerPage() {
  const { supabase, userId } = await requireUser();
  const t = await getT();

  const [{ data: profile }, { data: overview, error }, { data: recibidas }, { data: membresias }, guias, { data: detectados }] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
    supabase.rpc('account_overview'),
    // Me agregaron a una cuenta desde otra (sin código): falta que acepte
    supabase.rpc('my_invites'),
    // Las que archivé (si la columna todavía no existe, no hay archivadas)
    supabase.from('account_members').select('account_id, archived_at').eq('user_id', userId),
    // Si ya vio la guía del inicio (si no se sabe, no sale sola)
    supabase.from('profiles').select('guias_vistas').eq('id', userId).maybeSingle(),
    // Grupos de Mister Luks sin cuenta donde está mi número verificado
    supabase.rpc('my_detected_groups'),
  ]);
  const guiaVista = guias.error || !guias.data ? true : ((guias.data.guias_vistas as string[] | null) ?? []).includes('inicio');
  const invitaciones = (recibidas ?? []) as InvitacionRecibida[];

  const enArchivo = new Set(((membresias ?? []) as { account_id: string; archived_at: string | null }[]).filter((m) => m.archived_at).map((m) => m.account_id));
  const conChepito = (overview ?? []) as AccountOverview[];
  // Chepito (cobro) no es una cuenta: va aparte, abajo
  const chepito = conChepito.find((a) => a.type === 'cobro');
  const todas = conChepito.filter((a) => a.type !== 'cobro');
  // Archivada solo si está cerrada (si la reabrieran, vuelve a salir)
  const archivadas = todas.filter((a) => a.status === 'closed' && enArchivo.has(a.id));
  const accounts = todas.filter((a) => !archivadas.includes(a));
  const fullName = profile?.full_name?.trim() || '';
  const firstName = fullName.split(/\s+/)[0] || '';
  const pending = accounts.reduce((n, a) => n + a.pending_count, 0);
  const lead = pickLead(accounts);
  const cobros = await cobrosDeChepito(supabase, chepito);
  const others = accounts.filter((a) => a !== lead);

  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <LogoLink />
        <span className="ap-me">
          <Guia nombre="inicio" usuario={userId} auto={!guiaVista} />
          <MenuPrincipal nombre={fullName} guia />
        </span>
      </header>
      <div className="ap">
        <div className="ap-main">
          <div className="ap-intro">
            <h1 className="lu-display">{firstName ? t('Hola, {nombre}', { nombre: firstName }) : t('Hola')}</h1>
            <p className="lu-small lu-muted" style={{ margin: 0 }}>
              {/* Los cobros de Chepito se cuentan aparte de las cuentas */}
              {cobros.activos.length > 0
                ? accounts.length === 0
                  ? t('Tienes {cobros} y todavía ninguna cuenta.', { cobros: plural(cobros.activos.length, t('cobro activo'), t('cobros activos')) })
                  : pending > 0
                    ? t('Tienes {cuentas} y {cobros}; {gastos} esperan revisión.', {
                        cuentas: plural(accounts.length, t('cuenta'), t('cuentas')),
                        cobros: plural(cobros.activos.length, t('cobro activo'), t('cobros activos')),
                        gastos: plural(pending, t('gasto'), t('gastos')),
                      })
                    : t('Tienes {cuentas} y {cobros}, y todo está revisado.', {
                        cuentas: plural(accounts.length, t('cuenta'), t('cuentas')),
                        cobros: plural(cobros.activos.length, t('cobro activo'), t('cobros activos')),
                      })
                : accounts.length === 0
                  ? t('Todavía no tienes cuentas. Crea una o entra con el código que te pasaron.')
                  : pending > 0
                    ? t('Tienes {cuentas} y {gastos} esperando revisión.', {
                        cuentas: plural(accounts.length, t('cuenta'), t('cuentas')),
                        gastos: plural(pending, t('gasto'), t('gastos')),
                      })
                    : t('Tienes {cuentas} y todo está revisado.', { cuentas: plural(accounts.length, t('cuenta'), t('cuentas')) })}
            </p>
          </div>

          <InvitacionesRecibidas invitaciones={invitaciones} />
          <GruposDetectados grupos={(detectados ?? []) as GrupoDetectado[]} />

          {error && (
            <p className="lu-error" role="alert">
              {t('No pudimos traer tus cuentas. Recarga la página en un momento.')}
            </p>
          )}

          {lead ? (
            <LeadAccount a={lead} t={t} />
          ) : (
            !error && (
              <div className="ap-empty" data-guia={others.length === 0 ? 'cuentas' : undefined}>
                <LottieSlot name="bienvenida" width={96} height={96} />
                <p className="lu-small lu-muted" style={{ margin: 0 }}>
                  {t('Una cuenta es donde caen los gastos del grupo: la casa de todos los meses o ese paseo que están planeando.')}
                </p>
              </div>
            )
          )}

          {others.length > 0 && (
            <div className="ap-list lu-stagger" data-guia={lead ? undefined : 'cuentas'}>
              <div className="lu-label">{t('Otras cuentas')}</div>
              {others.map((a, i) =>
                a.status === 'closed' ? (
                  <FilaArchivable
                    key={a.id}
                    accountId={a.id}
                    accountName={a.name}
                    archivada={false}
                    puedeBorrar={a.role === 'owner' || a.role === 'admin'}
                    orden={i}
                  >
                    <AccountRow a={a} t={t} />
                  </FilaArchivable>
                ) : (
                  <AccountRow key={a.id} a={a} i={i} t={t} />
                ),
              )}
            </div>
          )}

          {archivadas.length > 0 && (
            <Archivadas cantidad={archivadas.length}>
              {archivadas.map((a) => (
                <FilaArchivable key={a.id} accountId={a.id} accountName={a.name} archivada puedeBorrar={a.role === 'owner' || a.role === 'admin'}>
                  <AccountRow a={a} t={t} />
                </FilaArchivable>
              ))}
            </Archivadas>
          )}

          {/* Chepito no es una cuenta: sus cobros van aparte, abajo */}
          <section className="ap-list ap-cobros" aria-labelledby="ap-cobros-t">
            <div className="ap-cobros__head">
              <span className="ap-cobros__hat" aria-hidden="true">
                <Sombrerito size={22} />
              </span>
              <span id="ap-cobros-t" className="lu-label">
                {t('Cobros')}
              </span>
              <Link href="/chepito" className="lu-btn lu-btn--ghost lu-btn--sm ap-cobros__nuevo">
                {t('Nuevo cobro')}
              </Link>
            </div>
            {cobros.activos.length === 0 ? (
              <Link href="/chepito" className="ap-row ap-chepito">
                <LottieSlot name="chepito" width={44} height={44} label={t('Chepito, el cobrador de Mister Luks')} />
                <span className="ap-row__txt">
                  <span className="ap-row__n">Chepito</span>
                  <span className="ap-row__s">{t('¿Alguien te debe plata? Chepito se la cobra por ti')}</span>
                </span>
              </Link>
            ) : (
              cobros.activos.map((c) => (
                <Link key={c.id} href="/chepito" className="ap-row">
                  <Avatar name={c.nombre} size="sm" registered={false} />
                  <span className="ap-row__txt">
                    <span className="ap-row__n">{c.nombre}</span>
                    <span className="ap-row__s">
                      {c.concepto} · {c.avisos === 0 ? t('Le escribo en horario de cobranza') : t('Le escribí {n} de 4 veces', { n: c.avisos })}
                    </span>
                  </span>
                  <b className="lu-num">{dinero(c.monto, cobros.moneda, t.idioma)}</b>
                </Link>
              ))
            )}
            {cobros.terminados > 0 && (
              <Link href="/chepito" className="lu-small ap-cobros__fin">
                {t('{cobros} ya terminaron: archívalos o bórralos →', { cobros: plural(cobros.terminados, t('cobro'), t('cobros')) })}
              </Link>
            )}
          </section>
        </div>

        <aside className="ap-side">
          <Link href="/cuentas/nueva" className="lu-btn lu-btn--primary" data-guia="crear">
            {t('Crear cuenta')}
          </Link>
          <Link href="/unirse" className="lu-btn lu-btn--secondary" data-guia="unirse">
            {t('Unirme con un código')}
          </Link>
          <div className="ap-tip">
            <span className="lu-title">{t('¿Cómo funciona?')}</span>
            <ol>
              <li>{rico(t('Crea una cuenta de {hogar} o de {evento}.'), { hogar: <b>{t('hogar')}</b>, evento: <b>{t('evento')}</b> })}</li>
              <li>{t('Agrega el número de Luks a su grupo de WhatsApp.')}</li>
              <li>{t('Manden fotos, PDFs o mensajes. Luks los vuelve gastos.')}</li>
              <li>{t('¿Solo tú? Arma un grupo de WhatsApp contigo y Luks, y mándate tus facturas.')}</li>
            </ol>
          </div>
          <RecomendarLuks />
        </aside>
      </div>
    </div>
  );
}

/** Los cobros de Chepito que siguen cobrando (como cobro_abierto) y cuántos terminaron sin archivar */
async function cobrosDeChepito(supabase: Awaited<ReturnType<typeof requireUser>>['supabase'], chepito: AccountOverview | undefined) {
  const vacio = { activos: [], terminados: 0, moneda: 'COP' as Moneda };
  if (!chepito) return vacio;
  const [{ data, error }, { data: cuenta }] = await Promise.all([
    supabase
      .from('cobros')
      .select('id, monto, concepto, avisos, pagado_at, no_debe_at, detenido_at, archivado_at, deudor:people!cobros_deudor_person_id_fkey(display_name)')
      .eq('account_id', chepito.id)
      .order('created_at', { ascending: false }),
    supabase.from('accounts').select('currency').eq('id', chepito.id).maybeSingle(),
  ]);
  if (error || !data) return vacio;
  const filas = data as unknown as {
    id: string;
    monto: number;
    concepto: string;
    avisos: number;
    pagado_at: string | null;
    no_debe_at: string | null;
    detenido_at: string | null;
    archivado_at: string | null;
    deudor: { display_name: string } | null;
  }[];
  const abierto = (c: (typeof filas)[number]) => !c.pagado_at && !c.no_debe_at && !c.detenido_at && c.avisos < 4;
  return {
    activos: filas.filter(abierto).map((c) => ({ id: c.id, nombre: c.deudor?.display_name ?? '—', monto: c.monto, concepto: c.concepto, avisos: c.avisos })),
    terminados: filas.filter((c) => !abierto(c) && !c.archivado_at).length,
    moneda: (cuenta?.currency as Moneda | undefined) ?? 'COP',
  };
}

/** La cuenta protagonista: la activa con más por revisar; a igualdad, los eventos primero. */
function pickLead(accounts: AccountOverview[]) {
  const active = accounts.filter((a) => a.status === 'active');
  return [...active].sort((a, b) => b.pending_count - a.pending_count || Number(b.type === 'evento') - Number(a.type === 'evento'))[0];
}

function periodLabel(a: AccountOverview, t: T) {
  if (a.type === 'hogar') return monthName(todayInBogota(), t.idioma);
  return formatRange(a.starts_on, a.ends_on, t.idioma) ?? t('Sin fechas');
}

function budgetNote(a: AccountOverview, t: T) {
  if (!a.budget_cop) return null;
  return t('{n} % del presupuesto', { n: Math.round((a.total_cop / a.budget_cop) * 100) });
}

function LeadAccount({ a, t }: { a: AccountOverview; t: T }) {
  const evento = a.type === 'evento';
  const share = a.people_count > 0 ? a.total_cop / a.people_count : 0;
  const hoy = todayInBogota();
  const moment = evento ? eventMoment(a.starts_on, a.ends_on, hoy, t.idioma) : null;
  const ended = !!a.ends_on && a.ends_on < hoy;

  return (
    <Link href={`/c/${a.id}/resumen`} className="ap-lead" aria-label={t('Abrir {nombre}', { nombre: a.name })} data-guia="cuentas">
      <BillCard
        label={`${t(evento ? 'Evento' : 'Hogar')} · ${periodLabel(a, t)}`}
        amount={a.total_cop}
        tone={evento ? 'morado' : 'verde'}
        denom={evento ? t('{n} PERSONAS', { n: a.people_count }) : t('LUCAS')}
        aside={
          a.pending_count > 0 ? (
            <Sticker tone="revisar" rotate={6}>
              {t('{n} por revisar', { n: a.pending_count })}
            </Sticker>
          ) : undefined
        }
      >
        <span className="ap-lead__n">{a.name}</span>
        <span className="lu-avatars">
          {a.people.slice(0, 8).map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: dos personas pueden llamarse igual
            <Avatar key={`${p.name}-${i}`} name={p.name} tone={asTone(p.tone, p.name)} size="sm" />
          ))}
        </span>
        <span>
          {evento ? (
            <>
              {moment}
              {a.status === 'settling' ? ` · ${t('liquidándose')}` : ended ? ` · ${t('falta liquidar')}` : ''} ·{' '}
              {rico(t('{monto} por cabeza'), { monto: <b>{lucas(share, t.idioma)}</b> })}
            </>
          ) : (
            (budgetNote(a, t) ?? plural(a.people_count, t('persona'), t('personas')))
          )}
        </span>
      </BillCard>
    </Link>
  );
}

function AccountRow({ a, i, t }: { a: AccountOverview; i?: number; t: T }) {
  const closed = a.status === 'closed';
  const note = a.type === 'hogar' ? (budgetNote(a, t) ?? (a.pending_count ? null : t('Al día'))) : null;
  return (
    <Link href={`/c/${a.id}/resumen`} className={`ap-row${closed ? ' is-closed' : ''}`} style={i == null ? undefined : ({ '--i': i } as React.CSSProperties)}>
      <span className="ap-glyph" style={{ background: `var(--tono-${accountTone(a.name)})` }} aria-hidden="true">
        {accountGlyph(a.name)}
      </span>
      <span className="ap-row__txt">
        <span className="ap-row__n">{a.name}</span>
        <span className="ap-row__s">
          {t(a.type === 'evento' ? 'Evento' : 'Hogar')} · {periodLabel(a, t)} · {note ?? plural(a.people_count, t('persona'), t('personas'))}
        </span>
      </span>
      <span className="ap-row__r">
        <Amount value={a.total_cop} />
        {a.pending_count > 0 ? (
          <span className="ap-pend">{t('{n} por revisar', { n: a.pending_count })}</span>
        ) : closed ? (
          <Sticker tone="cerrado" size="sm" rotate={-5} />
        ) : (
          <span className="lu-avatars">
            {a.people.slice(0, 3).map((p, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: dos personas pueden llamarse igual
              <Avatar key={`${p.name}-${i}`} name={p.name} tone={asTone(p.tone, p.name)} size="xs" registered={p.registered} />
            ))}
          </span>
        )}
      </span>
    </Link>
  );
}
