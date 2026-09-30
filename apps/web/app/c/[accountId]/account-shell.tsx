'use client';

import { usePathname, useRouter } from 'next/navigation';
import { AppShell } from '@/components/lucas-ui';
import { type AccountType, accountGlyph, accountTone } from '@/lib/types';

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
  const tabs = TABS[account.type].map((t) => (t.id === 'revisar' ? { ...t, count: pending } : t));

  return (
    <AppShell
      account={account.name}
      accountTone={accountTone(account.name)}
      accountGlyph={accountGlyph(account.name)}
      tabs={tabs}
      active={active}
      onTab={(id) => router.push(`/c/${account.id}/${id}`)}
      onAccount={() => router.push('/')}
    >
      {children}
    </AppShell>
  );
}
