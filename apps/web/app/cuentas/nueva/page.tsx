import { LogoLink } from '@/components/logo-link';
import { MenuPrincipal } from '@/components/menu-principal';
import { requireUser } from '@/utils/supabase/server';
import { NewAccountForm } from './new-account-form';

export default async function NewAccountPage() {
  const { supabase, userId } = await requireUser('/cuentas/nueva');
  const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle();
  const myName = profile?.full_name?.trim().split(/\s+/)[0] ?? '';

  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <LogoLink />
        <span className="ap-me">
          <MenuPrincipal />
        </span>
      </header>
      <div className="nc">
        <div className="ap-intro">
          <h1 className="lu-display">Crea una cuenta</h1>
          <p className="lu-small lu-muted" style={{ margin: 0 }}>
            Una cuenta es donde caen los gastos del grupo: la casa de todos los meses o ese paseo que están planeando.
          </p>
        </div>
        <NewAccountForm myName={myName} />
      </div>
    </div>
  );
}
