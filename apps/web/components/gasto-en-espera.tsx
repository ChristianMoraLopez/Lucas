'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/components/idioma';
import { Button, LottieSlot } from '@/components/lucas-ui';
import { useDinero } from '@/components/moneda';
import { humanError } from '@/lib/errors';
import { rico } from '@/lib/i18n/rico';
import { notifyAccountChanged, useAccountChanges } from '@/lib/realtime';
import { plural } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

/** gastos_en_espera_de (migración 490): lo que llegó por WhatsApp a un paseo liquidado */
interface EnEspera {
  cuenta: string;
  cerrada: boolean;
  /** «DaniChile 2»: la cuenta nueva, si la eligen */
  siguiente: string;
  gastos: { merchant: string; total: number; items: number; quien: string | null; created_at: string }[];
}

/**
 * Un gasto llegó por WhatsApp a un paseo ya liquidado y espera: lo mismo que
 * pregunta Mister Luks en el grupo, desde la app. «Reabrir y sumarlo» o
 * «Anotarlo en DaniChile 2»; Mister Luks lo cuenta en el grupo y después sale
 * la lista de quién pidió qué.
 */
export function GastoEnEspera({ accountId }: { accountId: string }) {
  const t = useT();
  const $ = useDinero();
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<'reabrir' | 'nueva' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = ['en-espera', accountId];
  const { data } = useQuery({
    queryKey: key,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('gastos_en_espera_de', { p_account_id: accountId });
      // Sin la 490 en la base, no hay nada que mostrar
      if (error) return null;
      return data as EnEspera | null;
    },
  });
  useAccountChanges(accountId, () => queryClient.invalidateQueries({ queryKey: key }));
  if (!data?.gastos?.length) return null;

  const decidir = async (modo: 'reabrir' | 'nueva') => {
    setBusy(modo);
    setError(null);
    const { data: r, error } = await supabase.rpc('decidir_liquidada', { p_account_id: accountId, p_modo: modo });
    setBusy(null);
    if (error) return setError(humanError(error));
    const destino = (r as { account_id?: string } | null)?.account_id;
    notifyAccountChanged(accountId);
    await queryClient.invalidateQueries();
    if (destino && destino !== accountId) router.push(`/c/${destino}/gastos`);
    else router.refresh();
  };

  const gastos = data.gastos.map((g, n) => (
    <span key={`${g.created_at}-${g.merchant}`}>
      {n > 0 && (n === data.gastos.length - 1 ? ` ${t('y')} ` : ', ')}
      <b>{g.merchant}</b> · {$.fmt(g.total)}
    </span>
  ));
  const quien = data.gastos.find((g) => g.quien)?.quien?.split(/\s+/)[0];
  const items = data.gastos.reduce((s, g) => s + g.items, 0);

  return (
    <section className="ap-invs" aria-label={t('Llegó un gasto nuevo por WhatsApp')} style={{ marginBottom: 16 }}>
      <article className="ap-inv">
        <span className="ap-inv__lottie" aria-hidden="true">
          <LottieSlot name="mister-luks" width={44} height={44} label="" />
        </span>
        <div className="ap-inv__txt">
          <p className="ap-inv__t">{rico(t('«{cuenta}» ya está liquidada y llegó por WhatsApp: {gastos}'), { cuenta: data.cuenta, gastos: <>{gastos}</> })}</p>
          <p className="lu-small lu-muted" style={{ margin: 0 }}>
            {[quien ? t('Lo mandó {quien}', { quien }) : null, items ? plural(items, t('ítem'), t('ítems')) : null].filter(Boolean).join(' · ')}
            {' · '}
            {t('¿Qué hago?')}
          </p>
        </div>
        <div className="ap-inv__acts">
          {!data.cerrada && (
            <Button size="sm" onClick={() => decidir('reabrir')} disabled={busy !== null}>
              {busy === 'reabrir' ? t('Un momento…') : t('Reabrir y sumarlo')}
            </Button>
          )}
          <Button size="sm" variant={data.cerrada ? 'primary' : 'ghost'} onClick={() => decidir('nueva')} disabled={busy !== null}>
            {busy === 'nueva' ? t('Un momento…') : t('Anotarlo en «{cuenta}»', { cuenta: data.siguiente })}
          </Button>
        </div>
      </article>
      {error && (
        <p className="lu-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </section>
  );
}
