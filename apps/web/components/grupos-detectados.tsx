'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/components/idioma';
import { Button, LottieSlot } from '@/components/lucas-ui';
import { ItemAnimado, ListaAnimada } from '@/components/movimiento';
import { humanError } from '@/lib/errors';
import { rico } from '@/lib/i18n/rico';
import { type GrupoDetectado, plural } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

/**
 * «Nuevo grupo detectado»: Mister Luks está en un grupo sin cuenta donde está
 * mi número verificado. «Crear la cuenta» lleva a armarla con la gente del
 * grupo ya puesta; «Ahora no» la quita (como las invitaciones recibidas).
 */
export function GruposDetectados({ grupos }: { grupos: GrupoDetectado[] }) {
  const t = useT();
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [quitados, setQuitados] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const visibles = grupos.filter((g) => !quitados.includes(g.group_id));
  if (!visibles.length) return null;

  const ahoraNo = async (g: GrupoDetectado) => {
    setBusy(g.group_id);
    setError(null);
    const { error } = await supabase.rpc('dismiss_detected_group', { p_group_id: g.group_id });
    setBusy(null);
    if (error) return setError(humanError(error));
    setQuitados((q) => [...q, g.group_id]);
    router.refresh();
  };

  return (
    <section className="ap-invs lu-stagger" aria-label={t('Nuevo grupo detectado')}>
      <ListaAnimada>
        {visibles.map((g, n) => (
          <ItemAnimado key={g.group_id} as="div">
            <article className="ap-inv" style={{ '--i': n } as React.CSSProperties}>
              <span className="ap-inv__lottie" aria-hidden="true">
                <LottieSlot name="mister-luks" width={44} height={44} label="" />
              </span>
              <div className="ap-inv__txt">
                <p className="ap-inv__t">{rico(t('Nuevo grupo detectado: {grupo}'), { grupo: <b>{g.name || t('Grupo sin nombre')}</b> })}</p>
                <p className="lu-small lu-muted" style={{ margin: 0 }}>
                  {t('Mister Luks está ahí')} · {plural(g.member_count, t('persona'), t('personas'))}
                  {g.names.length ? ` · ${g.names.join(', ')}` : ''}
                </p>
              </div>
              <div className="ap-inv__acts">
                <Link href={`/grupos/${g.group_id}`} className="lu-btn lu-btn--primary lu-btn--sm">
                  {t('Crear la cuenta')}
                </Link>
                <Button size="sm" variant="ghost" onClick={() => ahoraNo(g)} disabled={busy !== null}>
                  {busy === g.group_id ? t('Un momento…') : t('Ahora no')}
                </Button>
              </div>
            </article>
          </ItemAnimado>
        ))}
      </ListaAnimada>
      {error && (
        <p className="lu-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </section>
  );
}
