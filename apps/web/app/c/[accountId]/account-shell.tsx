'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Guia } from '@/components/guia';
import { LogoLink } from '@/components/logo-link';
import { AppShell, ICONS } from '@/components/lucas-ui';
import { useAccountChanges } from '@/lib/realtime';
import { type AccountType, accountGlyph, accountTone, type EstadoWhatsapp, estadoWhatsapp, type WhatsappOverview } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

// Las pestañas de TABS_EVENTO / TABS_HOGAR del kit; el hogar también liquida (mes a mes)
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
    { id: 'liquidar', label: 'Liquidar' },
    { id: 'presupuestos', label: 'Presupuesto' },
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

/** El grupo de WhatsApp de la cuenta: el mismo dato que usa la pantalla de conectar (se comparte la caché) */
function useWhatsapp(accountId: string, initial: WhatsappOverview | null) {
  const [supabase] = useState(() => createClient());
  const query = useQuery({
    queryKey: ['whatsapp', accountId],
    initialData: initial ?? undefined,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('whatsapp_overview', { p_account_id: accountId });
      if (error) throw error;
      return data as WhatsappOverview;
    },
  });
  return estadoWhatsapp(query.data);
}

const DOT: Record<EstadoWhatsapp, 'ok' | 'warn' | 'off'> = { leyendo: 'ok', caido: 'warn', 'sin-grupo': 'off' };

/**
 * WhatsApp es el motor de Luks: el botón está siempre arriba. Verde con punto
 * si Luks está leyendo el grupo; con punto rojo si se cayó; y si la cuenta
 * todavía no tiene grupo, «Conectar WhatsApp» resaltado.
 */
function WhatsappPill({ accountId, wa, here }: { accountId: string; wa: ReturnType<typeof estadoWhatsapp>; here: boolean }) {
  const label =
    wa.estado === 'leyendo'
      ? `WhatsApp: Luks está leyendo «${wa.grupo ?? 'el grupo'}»`
      : wa.estado === 'caido'
        ? 'WhatsApp: Luks no está leyendo el grupo ahora'
        : 'Conectar el grupo de WhatsApp';
  return (
    <Link
      href={`/c/${accountId}/whatsapp`}
      className={`lu-wa-pill lu-wa-pill--${wa.estado}`}
      aria-label={label}
      aria-current={here ? 'page' : undefined}
      data-guia="whatsapp"
    >
      {ICONS.whatsapp}
      <span className="lu-wa-pill__txt">
        {wa.estado === 'sin-grupo' ? (
          <>
            Conectar<span className="lu-wa-pill__mas"> WhatsApp</span>
          </>
        ) : (
          'WhatsApp'
        )}
      </span>
      {wa.estado !== 'sin-grupo' && <span className="lu-wa-pill__dot" aria-hidden="true" />}
    </Link>
  );
}

export function AccountShell({
  account,
  pending,
  whatsapp,
  guiaVista = true,
  children,
}: {
  account: { id: string; name: string; type: AccountType };
  pending: number;
  /** Ya vio la guía de las cuentas (si no, sale sola) */
  guiaVista?: boolean;
  /** whatsapp_overview del servidor (para no parpadear al abrir) */
  whatsapp: WhatsappOverview | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const active = pathname.split('/').filter(Boolean)[2] ?? 'resumen';
  const count = usePendingCount(account.id, pending);
  const wa = useWhatsapp(account.id, whatsapp);
  // En escritorio, WhatsApp también va en el menú lateral, justo después de Resumen
  const base = TABS[account.type].map((t) => (t.id === 'revisar' ? { ...t, count } : t));
  const tabs = [base[0], { id: 'whatsapp', label: 'WhatsApp', railOnly: true, dot: DOT[wa.estado] }, ...base.slice(1)];

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
      barExtra={
        <>
          <Guia nombre="cuenta" auto={!guiaVista} />
          <WhatsappPill accountId={account.id} wa={wa} here={active === 'whatsapp'} />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
