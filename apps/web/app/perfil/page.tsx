import { LogoLink } from '@/components/logo-link';
import { MenuPrincipal } from '@/components/menu-principal';
import type { MyProfile } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';
import { ProfileScreen } from './profile-screen';

export default async function PerfilPage() {
  const { supabase, userId } = await requireUser('/perfil');
  const [{ data, error }, { data: membresias }] = await Promise.all([
    supabase.rpc('my_profile'),
    // Las que archivó ya pasaron: no se muestran (si la columna todavía no existe, no hay archivadas)
    supabase.from('account_members').select('account_id, archived_at').eq('user_id', userId),
  ]);
  if (error) throw error;
  const archivadas = ((membresias ?? []) as { account_id: string; archived_at: string | null }[]).filter((m) => m.archived_at).map((m) => m.account_id);

  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <LogoLink />
        <span className="ap-me">
          <MenuPrincipal nombre={(data as MyProfile | null)?.full_name ?? ''} />
        </span>
      </header>
      <ProfileScreen p={data as MyProfile} archivadas={archivadas} />
    </div>
  );
}
