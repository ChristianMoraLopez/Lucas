'use client';

import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import { useAccountChanges } from '@/lib/realtime';

/** Vuelve a pedir la página del servidor cuando llega o cambia un gasto de la cuenta. */
export function LiveRefresh({ accountId }: { accountId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useAccountChanges(accountId, () => {
    // Varios cambios seguidos (gasto + división + mensaje) → un solo refresco
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 400);
  });
  return null;
}
