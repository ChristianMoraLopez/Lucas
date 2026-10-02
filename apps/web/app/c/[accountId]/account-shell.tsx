'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { LogoLink } from '@/components/logo-link';
import { AppShell } from '@/components/lucas-ui';
import { useAccountChanges } from '@/lib/realtime';
import { type AccountType, accountGlyph, accountTone } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

// Mismas pestañas que TABS_EVENTO / TABS_HOGAR del kit
const TABS: Record<AccountType, { id: string; label: string }[]> = {
  evento: [
    { id: 'resumen', label: 'Resumen' },
    { id: 'revisar', label: 'Revisar' },
    { id: 'gastos', label: 'Gastos' },
    { id: 'liquidar', label: 'Liquidar' },
    { id: 'personas', label: 'Personas' },
  ],
  hogar: [
    { id: 'resumen', label: 'Resumen' },
    { id: 'revisar', label: 'Revisar' },
    { id: 'gastos', label: 'Gastos' },
    { id: 'presupuestos', label: 'Presupuestos' },
    { id: 'personas', label: 'Personas' },
  ],
};

/**
 * Cuántos gastos faltan por revisar, en vivo. El layout lo trae del servidor
 * una sola vez (Next no vuelve a pintar el layout al navegar), así que aquí se
 * vuelve a contar cada vez que cambia un gasto de la cuenta: por Realtime, por
 * un aviso de esta pestaña (notifyAccountChanged) o al volver a la app.
 */
function usePendingCount(accountId: string, initial: number) {
  const [supabase] = useState(() => createClient());
  const queryClient = useQueryClient();
  const key = ['pendientes', accountId];
  const query = useQuery({
    queryKey: key,
    initialData: initial,
    staleTime: 15_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('expenses')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('status', 'pending_review');
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Varios cambios seguidos (gasto + división + mensaje) → un solo conteo
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useAccountChanges(accountId, () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => queryClient.invalidateQueries({ queryKey: key }), 250);
  });
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  });

  // Si el servidor trae un número más nuevo (router.refresh), ese manda
  useEffect(() => {
    queryClient.setQueryData(['pendientes', accountId], initial);
  }, [initial, accountId, queryClient]);

  return query.data;
}

export function AccountShell({
  account,
  pending,
  children,
}: {
  account: { id: string; name: string; type: AccountType };
  pending: number;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const active = pathname.split('/').filter(Boolean)[2] ?? 'resumen';
  const count = usePendingCount(account.id, pending);
  const tabs = TABS[account.type].map((t) => (t.id === 'revisar' ? { ...t, count } : t));

  return (
    <AppShell
      account={account.name}
      accountTone={accountTone(account.name)}
      accountGlyph={accountGlyph(account.name)}
      tabs={tabs}
      active={active}
      onTab={(id) => router.push(`/c/${account.id}/${id}`)}
      onAccount={() => router.push('/')}
      brand={<LogoLink />}
    >
      {children}
    </AppShell>
  );
}
