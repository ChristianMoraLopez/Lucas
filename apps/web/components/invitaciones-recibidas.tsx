'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/lucas-ui';
import { formatRange } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { accountGlyph, accountTone, type InvitacionRecibida, plural } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

/**
 * «Christian te agregó a Fiesta viernes»: alguien que ya está conmigo en otra
 * cuenta me agregó a una suya. Aceptar entra sin código (con el nombre que me
 * pusieron); «Ahora no» la quita.
 */
export function InvitacionesRecibidas({ invitaciones }: { invitaciones: InvitacionRecibida[] }) {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [quitadas, setQuitadas] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const visibles = invitaciones.filter((i) => !quitadas.includes(i.id));
  if (!visibles.length) return null;

  const aceptar = async (i: InvitacionRecibida) => {
    setBusy(i.id);
    setError(null);
    const { data, error } = await supabase.rpc('accept_invite', { p_invite_id: i.id });
    if (error) {
      setBusy(null);
      return setError(humanError(error));
    }
    // Sigue ocupado hasta que llegue la cuenta
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
    <section className="ap-invs" aria-label="Te agregaron a una cuenta">
      {visibles.map((i) => {
        const evento = i.account_type === 'evento';
        const fechas = evento ? formatRange(i.starts_on, i.ends_on) : null;
        return (
          <article key={i.id} className="ap-inv">
            <span
              className="lu-cat__glyph ap-inv__glyph"
              style={{ '--c': `var(--tono-${accountTone(i.account_name)})`, '--cf': 'var(--tinta-fija)' } as React.CSSProperties}
              aria-hidden="true"
            >
              {accountGlyph(i.account_name)}
            </span>
            <div className="ap-inv__txt">
              <p className="ap-inv__t">
                <b>{i.invited_by}</b> te agregó a <b>{i.account_name}</b>
              </p>
              <p className="lu-small lu-muted" style={{ margin: 0 }}>
                {evento ? `Evento${fechas ? ` · ${fechas}` : ''}` : 'Hogar'} · {plural(i.people_count, 'persona', 'personas')} · entras como {i.person_name}
              </p>
            </div>
            <div className="ap-inv__acts">
              <Button size="sm" onClick={() => aceptar(i)} disabled={busy !== null}>
                {busy === i.id ? 'Un momento…' : 'Aceptar'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => ahoraNo(i)} disabled={busy !== null}>
                Ahora no
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
