import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LogoLink } from '@/components/logo-link';
import { type AccountOverview, accountGlyph, accountTone } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';

/** Atajo de la PWA («Subir un recibo»): con una sola cuenta activa va directo; si hay varias, pregunta a cuál. */
export default async function SubirAtajoPage() {
  const { supabase } = await requireUser('/subir');
  const { data } = await supabase.rpc('account_overview');
  const activas = ((data ?? []) as AccountOverview[]).filter((a) => a.status === 'active');
  if (activas.length === 1) redirect(`/c/${activas[0].id}/subir`);

  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <LogoLink />
      </header>
      <div className="nc">
        <div className="ap-intro">
          <h1 className="lu-display">¿A qué cuenta?</h1>
          <p className="lu-small lu-muted" style={{ margin: 0 }}>
            {activas.length ? 'Elige dónde va el gasto.' : 'Todavía no tienes cuentas activas. Crea una o entra con un código.'}
          </p>
        </div>
        <div className="ap-list">
          {activas.map((a) => (
            <Link key={a.id} href={`/c/${a.id}/subir`} className="ap-row">
              <span className="ap-glyph" style={{ background: `var(--tono-${accountTone(a.name)})` }} aria-hidden="true">
                {accountGlyph(a.name)}
              </span>
              <span className="ap-row__txt">
                <span className="ap-row__n">{a.name}</span>
                <span className="ap-row__s">{a.type === 'evento' ? 'Evento' : 'Hogar'}</span>
              </span>
            </Link>
          ))}
          {!activas.length && (
            <Link href="/cuentas/nueva" className="lu-btn lu-btn--primary">
              Crear cuenta
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
