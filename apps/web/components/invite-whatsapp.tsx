'use client';

import { useState } from 'react';
import { useT } from '@/components/idioma';
import { Button } from '@/components/lucas-ui';
import { humanError } from '@/lib/errors';
import { inviteLink, inviteMessage, isInviteActive, whatsappUrl } from '@/lib/invite';
import type { AccountType, Invitation } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

type Supabase = ReturnType<typeof createClient>;

/**
 * El código de invitación vigente (como miembro). Si la cuenta no tiene, crea
 * uno: 7 días para un evento, 30 para un hogar, sin límite de personas.
 */
async function codigoVigente(supabase: Supabase, accountId: string, accountType: AccountType) {
  const { data, error } = await supabase
    .from('invitations')
    .select('id, code, role, expires_at, max_uses, uses, revoked_at, created_at')
    .eq('account_id', accountId)
    .eq('role', 'member')
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const vigente = (data as Invitation[]).find((i) => isInviteActive(i));
  if (vigente) return vigente.code;

  const dias = accountType === 'evento' ? 7 : 30;
  const { data: code, error: e2 } = await supabase.rpc('create_invitation', {
    p_account_id: accountId,
    p_role: 'member',
    p_expires_at: new Date(Date.now() + dias * 86_400_000).toISOString(),
    p_max_uses: null,
  });
  if (e2) throw e2;
  return code as string;
}

/**
 * «Invitar por WhatsApp»: abre WhatsApp con el link de invitación listo para
 * mandarlo al grupo o a alguien. Solo para quien administra la cuenta.
 */
export function InviteWhatsapp({
  accountId,
  accountName,
  accountType,
  variant = 'primary',
}: {
  accountId: string;
  accountName: string;
  accountType: AccountType;
  variant?: 'primary' | 'secondary';
}) {
  const t = useT();
  const [supabase] = useState(() => createClient());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invitar = async () => {
    setBusy(true);
    setError(null);
    // La ventana se abre ya: si se abre después de esperar, el celular la bloquea
    const w = window.open('', '_blank');
    try {
      const code = await codigoVigente(supabase, accountId, accountType);
      const url = whatsappUrl(inviteMessage({ accountName, code, link: inviteLink(window.location.origin, code), t }));
      if (w) w.location.href = url;
      else window.location.href = url;
    } catch (e) {
      w?.close();
      setError(humanError(e as { message?: string }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="lu-invite">
      <Button size="sm" variant={variant} onClick={invitar} disabled={busy}>
        {busy ? t('Abriendo WhatsApp…') : t('Invitar por WhatsApp')}
      </Button>
      {error && (
        <span className="lu-field-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
