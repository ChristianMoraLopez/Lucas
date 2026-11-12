'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/components/idioma';
import { humanError } from '@/lib/errors';
import { createClient } from '@/utils/supabase/client';

/**
 * «Lo tuyo de aquí también cuenta en…»: cuando un gasto de esta cuenta queda
 * confirmado, lo que te tocó entra por revisar en tu otra cuenta (tu casa).
 * Cada quien elige la suya (migración 800).
 */
export function LoMioTambien({ accountId, destino, opciones }: { accountId: string; destino: string | null; opciones: { id: string; name: string }[] }) {
  const t = useT();
  const router = useRouter();
  const [valor, setValor] = useState(destino ?? '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!opciones.length) return null;

  const cambiar = async (nuevo: string) => {
    setValor(nuevo);
    setError(null);
    setGuardando(true);
    const { error } = await createClient().rpc('fijar_reflejo', { p_account_id: accountId, p_destino: nuevo || null });
    setGuardando(false);
    if (error) {
      setValor(destino ?? '');
      setError(humanError(error));
      return;
    }
    router.refresh();
  };

  return (
    <section className="lm" aria-labelledby="lm-t">
      <div>
        <b id="lm-t">{t('Lo tuyo de aquí también cuenta en…')}</b>
        <p className="lu-small lu-muted">
          {t('Cuando un gasto quede confirmado, lo que te tocó entra por revisar en esa cuenta, pagado por ti. Solo lo tuyo; los demás eligen lo suyo.')}
        </p>
      </div>
      <select aria-labelledby="lm-t" value={valor} onChange={(e) => cambiar(e.target.value)} disabled={guardando}>
        <option value="">{t('En ninguna otra')}</option>
        {opciones.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {error && (
        <p className="lu-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
