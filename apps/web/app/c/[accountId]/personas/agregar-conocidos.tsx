'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Chip } from '@/components/lucas-ui';
import { humanError } from '@/lib/errors';
import { whatsappUrl } from '@/lib/invite';
import { notifyAccountChanged } from '@/lib/realtime';
import { MARCA_URL } from '@/lib/share';
import { asTone, type Conocido } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

/** «Laura», «Laura y Pipe», «Laura, Pipe y Ana» */
const juntar = (ns: string[]) => (ns.length <= 1 ? (ns[0] ?? '') : `${ns.slice(0, -1).join(', ')} y ${ns.at(-1)}`);

/**
 * «De tus otras cuentas»: quien ya está contigo en otra cuenta de Luks (la
 * esposa en el hogar, los amigos del paseo) se agrega con un toque, sin
 * código. Queda de una vez como persona de esta cuenta y le llega en su home
 * para aceptar.
 */
export function AgregarConocidos({ accountId, accountName, onAdded }: { accountId: string; accountName: string; onAdded: () => void }) {
  const [supabase] = useState(() => createClient());
  const queryClient = useQueryClient();
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listos, setListos] = useState<string[]>([]);

  const conocidos = useQuery({
    queryKey: ['conocidos', accountId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('people_to_add', { p_account_id: accountId });
      if (error) throw error;
      return data as Conocido[];
    },
  });
  const lista = conocidos.data ?? [];
  if (!lista.length && !listos.length) return null;

  const nombre = (id: string) => lista.find((c) => c.user_id === id)?.name ?? 'Alguien';
  const elegir = (id: string) => setElegidos((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  const agregar = async () => {
    if (!elegidos.length || busy) return;
    setBusy(true);
    setError(null);
    const nombres = elegidos.map(nombre);
    const { error } = await supabase.rpc('invite_people', { p_account_id: accountId, p_user_ids: elegidos });
    setBusy(false);
    if (error) return setError(humanError(error));
    setListos(nombres);
    setElegidos([]);
    await queryClient.invalidateQueries({ queryKey: ['conocidos', accountId] });
    notifyAccountChanged(accountId);
    onAdded();
  };

  const aviso = `Te agregué a «${accountName}» en Luks 👋 Entra a ${MARCA_URL} y acepta: ahí vamos viendo los gastos y quién le paga a quién.`;

  return (
    <section className="mb-conocidos" aria-labelledby="mb-conocidos-t">
      <h2 id="mb-conocidos-t" className="lu-title" style={{ margin: 0 }}>
        De tus otras cuentas
      </h2>
      {lista.length > 0 && (
        <>
          <p className="lu-small lu-muted" style={{ margin: 0 }}>
            Ya usan Luks: agrégalos sin código. Les llega en Luks para aceptar, y desde ya cuentan en los gastos.
          </p>
          <div className="lu-chips">
            {lista.map((c) => (
              <Chip key={c.user_id} name={c.name} tone={asTone(c.tone, c.name)} pressed={elegidos.includes(c.user_id)} onToggle={() => elegir(c.user_id)}>
                <span className="mb-conocido">
                  {c.name}
                  <span className="mb-conocido__de">{c.accounts.join(' · ')}</span>
                </span>
              </Chip>
            ))}
          </div>
          <Button size="sm" onClick={agregar} disabled={busy || !elegidos.length}>
            {busy ? 'Agregando…' : elegidos.length ? `Agregar a ${juntar(elegidos.map(nombre))}` : 'Toca a quién agregar'}
          </Button>
        </>
      )}
      {error && (
        <p className="lu-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      {listos.length > 0 && (
        <p className="mb-sync lu-small" role="status">
          Listo: a {juntar(listos)} le llega en Luks para aceptar. Ya puedes dividir gastos con {listos.length === 1 ? 'esa persona' : 'esas personas'}.{' '}
          <a href={whatsappUrl(aviso)} target="_blank" rel="noreferrer">
            Avisar por WhatsApp
          </a>
        </p>
      )}
    </section>
  );
}
