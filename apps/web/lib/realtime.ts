'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

/**
 * Escucha los cambios de gastos y mensajes de una cuenta (Supabase Realtime).
 * Realtime respeta RLS: solo llegan los cambios de cuentas donde uno es miembro.
 */
export function useAccountChanges(accountId: string, onChange: () => void) {
  const [supabase] = useState(() => createClient());
  const callback = useRef(onChange);
  callback.current = onChange;

  useEffect(() => {
    const filter = `account_id=eq.${accountId}`;
    const channel = supabase
      .channel(`cuenta-${accountId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter }, () => callback.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter }, () => callback.current())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, supabase]);
}
