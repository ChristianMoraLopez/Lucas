'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/lucas-ui';
import { createClient } from '@/utils/supabase/client';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <Button variant="ghost" size="sm" onClick={signOut} disabled={busy}>
      Salir
    </Button>
  );
}
