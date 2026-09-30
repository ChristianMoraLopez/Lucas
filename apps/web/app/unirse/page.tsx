import Link from 'next/link';
import { Logo } from '@/components/lucas-ui';
import { requireUser } from '@/utils/supabase/server';
import { JoinFlow } from './join-flow';

export default async function JoinPage({ searchParams }: PageProps<'/unirse'>) {
  const { codigo } = await searchParams;
  const initialCode = typeof codigo === 'string' ? codigo : '';
  const { supabase, userId } = await requireUser(`/unirse${initialCode ? `?codigo=${encodeURIComponent(initialCode)}` : ''}`);

  const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle();
  const myName = profile?.full_name?.trim().split(/\s+/)[0] ?? '';

  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <Link href="/" aria-label="Volver a mis cuentas" className="lu-logo-link">
          <Logo />
        </Link>
      </header>
      <JoinFlow initialCode={initialCode} myName={myName} />
    </div>
  );
}
