'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

const EVENTO = 'luks:cuenta';

/**
 * Avisa en esta pestaña que algo de la cuenta cambió (se confirmó, corrigió o
 * borró un gasto): el número de Revisar y las listas se actualizan de una, sin
 * esperar a que Realtime traiga el cambio.
 */
export function notifyAccountChanged(accountId: string) {
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: accountId }));
}

/**
 * Escucha los cambios de gastos y mensajes de una cuenta (Supabase Realtime) y
 * los avisos de esta misma pestaña. Realtime respeta RLS: solo llegan los
 * cambios de cuentas donde uno es miembro.
 */
export function useAccountChanges(accountId: string, onChange: () => void) {
  const [supabase] = useState(() => createClient());
  const callback = useRef(onChange);
  callback.current = onChange;
  // Un canal por componente: dos con el mismo nombre se pisan
  const id = useId();

  useEffect(() => {
    const filter = `account_id=eq.${accountId}`;
    const channel = supabase
      .channel(`cuenta-${accountId}-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter }, () => callback.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter }, () => callback.current())
      .subscribe();
    const local = (e: Event) => {
      if ((e as CustomEvent<string>).detail === accountId) callback.current();
    };
    window.addEventListener(EVENTO, local);
    return () => {
      window.removeEventListener(EVENTO, local);
      supabase.removeChannel(channel);
    };
  }, [accountId, supabase, id]);
}
