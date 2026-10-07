'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/components/idioma';
import { humanError } from '@/lib/errors';
import { IDIOMAS, type Idioma, NOMBRE_IDIOMA } from '@/lib/i18n';
import { MONEDAS, type Moneda, NOMBRE_MONEDA } from '@/lib/moneda';
import { createClient } from '@/utils/supabase/client';

/**
 * La moneda de la cuenta y el idioma en que Luks responde en el grupo (solo
 * quien administra). La moneda se elige antes del primer gasto: después los
 * montos ya guardados quedarían en otra moneda.
 */
export function MonedaIdioma({ accountId, moneda, idioma, conGastos }: { accountId: string; moneda: Moneda; idioma: Idioma; conGastos: boolean }) {
  const t = useT();
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async (cambio: { p_currency?: Moneda; p_language?: Idioma }) => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('set_account_settings', { p_account_id: accountId, ...cambio });
    setBusy(false);
    if (error) return setError(humanError(error));
    // La moneda la usa toda la cuenta (el layout): se vuelve a pintar
    router.refresh();
  };

  return (
    <section className="wa-card" aria-labelledby="wa-ajustes">
      <h2 className="lu-label" id="wa-ajustes" style={{ margin: 0 }}>
        {t('Moneda e idioma')}
      </h2>
      <div className="lu-field">
        <label className="lu-label" htmlFor="wa-moneda">
          {t('Moneda')}
        </label>
        <select
          id="wa-moneda"
          value={moneda}
          disabled={busy || conGastos}
          aria-describedby="wa-moneda-ayuda"
          onChange={(e) => guardar({ p_currency: e.target.value as Moneda })}
        >
          {MONEDAS.map((m) => (
            <option key={m} value={m}>
              {t(NOMBRE_MONEDA[m])} ({m})
            </option>
          ))}
        </select>
        <span className="lu-small lu-muted" id="wa-moneda-ayuda">
          {conGastos ? t('Ya hay gastos en esta cuenta, así que la moneda queda fija.') : t('La moneda se puede cambiar hasta que llegue el primer gasto.')}
        </span>
      </div>
      <div className="lu-field">
        <label className="lu-label" htmlFor="wa-idioma">
          {t('Luks responde en el grupo en')}
        </label>
        <select id="wa-idioma" value={idioma} disabled={busy} onChange={(e) => guardar({ p_language: e.target.value as Idioma })}>
          {IDIOMAS.map((i) => (
            <option key={i} value={i}>
              {NOMBRE_IDIOMA[i]}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p className="lu-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </section>
  );
}
