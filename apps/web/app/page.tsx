import Link from 'next/link';
import { Archivadas, FilaArchivable } from '@/components/archivo-cuenta';
import { Guia } from '@/components/guia';
import { InvitacionesRecibidas } from '@/components/invitaciones-recibidas';
import { LogoLink } from '@/components/logo-link';
import { lucas } from '@/components/lucas-core';
import { Amount, Avatar, BillCard, LottieSlot, Sticker } from '@/components/lucas-ui';
import { RecomendarLuks } from '@/components/recomendar-luks';
import { SignOutButton } from '@/components/sign-out-button';
import { ThemeToggle } from '@/components/theme-toggle';
import { eventMoment, formatRange, monthName, todayInBogota } from '@/lib/dates';
import { type AccountOverview, accountGlyph, accountTone, asTone, type InvitacionRecibida, plural } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';

export default async function AccountPickerPage() {
  const { supabase, userId } = await requireUser();

  const [{ data: profile }, { data: overview, error }, { data: recibidas }, { data: membresias }, guias] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
    supabase.rpc('account_overview'),
    // Me agregaron a una cuenta desde otra (sin código): falta que acepte
    supabase.rpc('my_invites'),
    // Las que archivé (si la columna todavía no existe, no hay archivadas)
    supabase.from('account_members').select('account_id, archived_at').eq('user_id', userId),
    // Si ya vio la guía del inicio (si no se sabe, no sale sola)
    supabase.from('profiles').select('guias_vistas').eq('id', userId).maybeSingle(),
  ]);
  const guiaVista = guias.error || !guias.data ? true : ((guias.data.guias_vistas as string[] | null) ?? []).includes('inicio');
  const invitaciones = (recibidas ?? []) as InvitacionRecibida[];

  const enArchivo = new Set(((membresias ?? []) as { account_id: string; archived_at: string | null }[]).filter((m) => m.archived_at).map((m) => m.account_id));
  const todas = (overview ?? []) as AccountOverview[];
  // Archivada solo si está cerrada (si la reabrieran, vuelve a salir)
  const archivadas = todas.filter((a) => a.status === 'closed' && enArchivo.has(a.id));
  const accounts = todas.filter((a) => !archivadas.includes(a));
  const fullName = profile?.full_name?.trim() || '';
  const firstName = fullName.split(/\s+/)[0] || '';
  const pending = accounts.reduce((n, a) => n + a.pending_count, 0);
  const lead = pickLead(accounts);
  const others = accounts.filter((a) => a !== lead);

  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <LogoLink />
        <span className="ap-me">
          <Guia nombre="inicio" usuario={userId} auto={!guiaVista} />
          <ThemeToggle />
          <SignOutButton />
          <Link href="/perfil" className="ap-perfil" aria-label="Tu perfil">
            <Avatar name={fullName || 'Tú'} size="sm" />
          </Link>
        </span>
      </header>
      <div className="ap">
        <div className="ap-main">
          <div className="ap-intro">
            <h1 className="lu-display">{firstName ? `Hola, ${firstName}` : 'Hola'}</h1>
            <p className="lu-small lu-muted" style={{ margin: 0 }}>
              {accounts.length === 0
                ? 'Todavía no tienes cuentas. Crea una o entra con el código que te pasaron.'
                : pending > 0
                  ? `Tienes ${plural(accounts.length, 'cuenta', 'cuentas')} y ${plural(pending, 'gasto esperando', 'gastos esperando')} revisión.`
                  : `Tienes ${plural(accounts.length, 'cuenta', 'cuentas')} y todo está revisado.`}
            </p>
          </div>

          <InvitacionesRecibidas invitaciones={invitaciones} />

          {error && (
            <p className="lu-error" role="alert">
              No pudimos traer tus cuentas. Recarga la página en un momento.
            </p>
          )}

          {lead ? (
            <LeadAccount a={lead} />
          ) : (
            !error && (
              <div className="ap-empty" data-guia={others.length === 0 ? 'cuentas' : undefined}>
                <LottieSlot name="bienvenida" width={96} height={96} />
                <p className="lu-small lu-muted" style={{ margin: 0 }}>
                  Una cuenta es donde caen los gastos del grupo: la casa de todos los meses o ese paseo que están planeando.
                </p>
              </div>
            )
          )}

          {others.length > 0 && (
            <div className="ap-list lu-stagger" data-guia={lead ? undefined : 'cuentas'}>
              <div className="lu-label">Otras cuentas</div>
              {others.map((a, i) =>
                a.status === 'closed' ? (
                  <FilaArchivable key={a.id} accountId={a.id} accountName={a.name} archivada={false} titular={a.role === 'owner'} orden={i}>
                    <AccountRow a={a} />
                  </FilaArchivable>
                ) : (
                  <AccountRow key={a.id} a={a} i={i} />
                ),
              )}
            </div>
          )}

          {archivadas.length > 0 && (
            <Archivadas cantidad={archivadas.length}>
              {archivadas.map((a) => (
                <FilaArchivable key={a.id} accountId={a.id} accountName={a.name} archivada titular={a.role === 'owner'}>
                  <AccountRow a={a} />
                </FilaArchivable>
              ))}
            </Archivadas>
          )}
        </div>

        <aside className="ap-side">
          <Link href="/cuentas/nueva" className="lu-btn lu-btn--primary" data-guia="crear">
            Crear cuenta
          </Link>
          <Link href="/unirse" className="lu-btn lu-btn--secondary" data-guia="unirse">
            Unirme con un código
          </Link>
          <div className="ap-tip">
            <span className="lu-title">¿Cómo funciona?</span>
            <ol>
              <li>
                Crea una cuenta de <b>hogar</b> o de <b>evento</b>.
              </li>
              <li>Agrega el número de Luks a su grupo de WhatsApp.</li>
              <li>Manden fotos, PDFs o mensajes. Luks los vuelve gastos.</li>
              <li>¿Solo tú? Arma un grupo de WhatsApp contigo y Luks, y mándate tus facturas.</li>
            </ol>
          </div>
          <RecomendarLuks />
        </aside>
      </div>
    </div>
  );
}

/** La cuenta protagonista: la activa con más por revisar; a igualdad, los eventos primero. */
function pickLead(accounts: AccountOverview[]) {
  const active = accounts.filter((a) => a.status === 'active');
  return [...active].sort((a, b) => b.pending_count - a.pending_count || Number(b.type === 'evento') - Number(a.type === 'evento'))[0];
}

function periodLabel(a: AccountOverview) {
  if (a.type === 'hogar') return monthName(todayInBogota());
  return formatRange(a.starts_on, a.ends_on) ?? 'Sin fechas';
}

function budgetNote(a: AccountOverview) {
  if (!a.budget_cop) return null;
  return `${Math.round((a.total_cop / a.budget_cop) * 100)} % del presupuesto`;
}

function LeadAccount({ a }: { a: AccountOverview }) {
  const evento = a.type === 'evento';
  const share = a.people_count > 0 ? a.total_cop / a.people_count : 0;
  const moment = evento ? eventMoment(a.starts_on, a.ends_on) : null;
  const ended = moment?.startsWith('Terminó');

  return (
    <Link href={`/c/${a.id}/resumen`} className="ap-lead" aria-label={`Abrir ${a.name}`} data-guia="cuentas">
      <BillCard
        label={`${evento ? 'Evento' : 'Hogar'} · ${periodLabel(a)}`}
        amount={a.total_cop}
        tone={evento ? 'morado' : 'verde'}
        denom={evento ? `${a.people_count} PERSONAS` : 'LUCAS'}
        aside={
          a.pending_count > 0 ? (
            <Sticker tone="revisar" rotate={6}>
              {a.pending_count} por revisar
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
              {a.status === 'settling' ? ' · liquidándose' : ended ? ' · falta liquidar' : ''} · <b>{lucas(share)}</b> por cabeza
            </>
          ) : (
            (budgetNote(a) ?? `${plural(a.people_count, 'persona', 'personas')}`)
          )}
        </span>
      </BillCard>
    </Link>
  );
}

function AccountRow({ a, i }: { a: AccountOverview; i?: number }) {
  const closed = a.status === 'closed';
  const note = a.type === 'hogar' ? (budgetNote(a) ?? (a.pending_count ? null : 'Al día')) : null;
  return (
    <Link href={`/c/${a.id}/resumen`} className={`ap-row${closed ? ' is-closed' : ''}`} style={i == null ? undefined : ({ '--i': i } as React.CSSProperties)}>
      <span className="ap-glyph" style={{ background: `var(--tono-${accountTone(a.name)})` }} aria-hidden="true">
        {accountGlyph(a.name)}
      </span>
      <span className="ap-row__txt">
        <span className="ap-row__n">{a.name}</span>
        <span className="ap-row__s">
          {a.type === 'evento' ? 'Evento' : 'Hogar'} · {periodLabel(a)} · {note ?? plural(a.people_count, 'persona', 'personas')}
        </span>
      </span>
      <span className="ap-row__r">
        <Amount value={a.total_cop} />
        {a.pending_count > 0 ? (
          <span className="ap-pend">{a.pending_count} por revisar</span>
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
