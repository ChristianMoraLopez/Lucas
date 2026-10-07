'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { lanzarChispas } from '@/components/chispas';
import { useT } from '@/components/idioma';
import { Button } from '@/components/lucas-ui';
import { formatRange } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { rico } from '@/lib/i18n/rico';
import { accountGlyph, accountTone, type InvitacionRecibida, plural } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

/**
 * «Christian te agregó a Fiesta viernes»: alguien que ya está conmigo en otra
 * cuenta me agregó a una suya. Aceptar entra sin código (con el nombre que me
 * pusieron); «Ahora no» la quita.
 */
export function InvitacionesRecibidas({ invitaciones }: { invitaciones: InvitacionRecibida[] }) {
  const t = useT();
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [quitadas, setQuitadas] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const visibles = invitaciones.filter((i) => !quitadas.includes(i.id));
  if (!visibles.length) return null;

  const aceptar = async (i: InvitacionRecibida, e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setBusy(i.id);
    setError(null);
    const { data, error } = await supabase.rpc('accept_invite', { p_invite_id: i.id });
    if (error) {
      setBusy(null);
      return setError(humanError(error));
    }
    // Entró: chispas, y el botón sigue ocupado hasta que llegue la cuenta
    lanzarChispas({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, currentTarget: null });
    router.push(`/c/${data as string}/resumen`);
    router.refresh();
  };
  const ahoraNo = async (i: InvitacionRecibida) => {
    setBusy(i.id);
    setError(null);
    const { error } = await supabase.rpc('decline_invite', { p_invite_id: i.id });
    setBusy(null);
    if (error) return setError(humanError(error));
    setQuitadas((q) => [...q, i.id]);
    router.refresh();
  };

  return (
    <section className="ap-invs lu-stagger" aria-label={t('Te agregaron a una cuenta')}>
      {visibles.map((i, n) => {
        const evento = i.account_type === 'evento';
        const fechas = evento ? formatRange(i.starts_on, i.ends_on, t.idioma) : null;
        return (
          <article key={i.id} className="ap-inv" style={{ '--i': n } as React.CSSProperties}>
            <span
              className="lu-cat__glyph ap-inv__glyph"
              style={{ '--c': `var(--tono-${accountTone(i.account_name)})`, '--cf': 'var(--tinta-fija)' } as React.CSSProperties}
              aria-hidden="true"
            >
              {accountGlyph(i.account_name)}
            </span>
            <div className="ap-inv__txt">
              <p className="ap-inv__t">{rico(t('{quien} te agregó a {cuenta}'), { quien: <b>{i.invited_by}</b>, cuenta: <b>{i.account_name}</b> })}</p>
              <p className="lu-small lu-muted" style={{ margin: 0 }}>
                {evento ? `${t('Evento')}${fechas ? ` · ${fechas}` : ''}` : t('Hogar')} · {plural(i.people_count, t('persona'), t('personas'))} ·{' '}
                {t('entras como {nombre}', { nombre: i.person_name })}
              </p>
            </div>
            <div className="ap-inv__acts">
              <Button size="sm" onClick={(e) => aceptar(i, e)} disabled={busy !== null}>
                {busy === i.id ? t('Un momento…') : t('Aceptar')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => ahoraNo(i)} disabled={busy !== null}>
                {t('Ahora no')}
              </Button>
            </div>
          </article>
        );
      })}
      {error && (
        <p className="lu-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </section>
  );
}
