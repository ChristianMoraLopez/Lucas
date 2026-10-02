import { LogoLink } from '@/components/logo-link';
import { SignOutButton } from '@/components/sign-out-button';
import type { MyProfile } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';
import { ProfileScreen } from './profile-screen';

export default async function PerfilPage() {
  const { supabase } = await requireUser('/perfil');
  const { data, error } = await supabase.rpc('my_profile');
  if (error) throw error;

  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <LogoLink />
        <span className="ap-me">
          <SignOutButton />
        </span>
      </header>
      <ProfileScreen p={data as MyProfile} />
    </div>
  );
}
