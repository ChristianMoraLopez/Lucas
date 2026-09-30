import Link from 'next/link';
import { lucas } from '@/components/lucas-core';
import { Amount, Avatar, BillCard, Logo, LottieSlot, Sticker } from '@/components/lucas-ui';
import { SignOutButton } from '@/components/sign-out-button';
import { ThemeToggle } from '@/components/theme-toggle';
import { eventMoment, formatRange, monthName, todayInBogota } from '@/lib/dates';
import { type AccountOverview, accountGlyph, accountTone, asTone, plural } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';

export default async function AccountPickerPage() {
  const { supabase, userId } = await requireUser();

  const [{ data: profile }, { data: overview, error }] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
    supabase.rpc('account_overview'),
  ]);

  const accounts = (overview ?? []) as AccountOverview[];
  const fullName = profile?.full_name?.trim() || '';
  const firstName = fullName.split(/\s+/)[0] || '';
  const pending = accounts.reduce((n, a) => n + a.pending_count, 0);
  const lead = pickLead(accounts);
  const others = accounts.filter((a) => a !== lead);

  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <Logo />
        <span className="ap-me">
          <ThemeToggle />
          <SignOutButton />
          {fullName && <Avatar name={fullName} size="sm" />}
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

          {error && (
            <p className="lu-error" role="alert">
              No pudimos traer tus cuentas. Recarga la página en un momento.
            </p>
          )}

          {lead ? (
            <LeadAccount a={lead} />
          ) : (
            !error && (
              <div className="ap-empty">
                <LottieSlot name="vacio" width={96} height={96} />
                <p className="lu-small lu-muted" style={{ margin: 0 }}>
                  Una cuenta es donde caen los gastos del grupo: la casa de todos los meses o ese paseo que están planeando.
                </p>
              </div>
            )
          )}

          {others.length > 0 && (
            <div className="ap-list">
              <div className="lu-label">Otras cuentas</div>
              {others.map((a) => (
                <AccountRow key={a.id} a={a} />
              ))}
            </div>
          )}
        </div>

        <aside className="ap-side">
          <Link href="/cuentas/nueva" className="lu-btn lu-btn--primary">
            Crear cuenta
          </Link>
          <Link href="/unirse" className="lu-btn lu-btn--secondary">
            Unirme con un código
          </Link>
          <div className="ap-tip">
            <span className="lu-title">¿Cómo funciona?</span>
            <ol>
              <li>
                Crea una cuenta de <b>hogar</b> o de <b>evento</b>.
              </li>
              <li>Agrega el número de Lucas a su grupo de WhatsApp.</li>
              <li>Manden fotos, PDFs o mensajes. Lucas los vuelve gastos.</li>
            </ol>
          </div>
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
    <Link href={`/c/${a.id}/resumen`} className="ap-lead" aria-label={`Abrir ${a.name}`}>
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
              {ended ? ' · falta liquidar' : ''} · <b>{lucas(share)}</b> por cabeza
            </>
          ) : (
            (budgetNote(a) ?? `${plural(a.people_count, 'persona', 'personas')}`)
          )}
        </span>
      </BillCard>
    </Link>
  );
}

function AccountRow({ a }: { a: AccountOverview }) {
  const closed = a.status === 'closed';
  const note = a.type === 'hogar' ? (budgetNote(a) ?? (a.pending_count ? null : 'Al día')) : null;
  return (
    <Link href={`/c/${a.id}/resumen`} className={`ap-row${closed ? ' is-closed' : ''}`}>
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
