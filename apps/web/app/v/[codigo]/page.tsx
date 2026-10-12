import { LogoLink } from '@/components/logo-link';
import { MenuPrincipal } from '@/components/menu-principal';
import type { VerificacionWhatsapp } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';
import { Verificar } from './verificar';

/**
 * El link que manda Mister Luks por privado cuando alguien le escribe «luks soy
 * yo» (mrluks.com/v/CÓDIGO): con la sesión iniciada, quien lo abre confirma que
 * ese WhatsApp es suyo. Sin sesión, el proxy lo lleva a entrar (o a crear su
 * usuario) y lo trae de vuelta. Solo se ven los últimos 4 números.
 */
export default async function VerificarPage({ params }: PageProps<'/v/[codigo]'>) {
  const { codigo } = await params;
  const { supabase } = await requireUser(`/v/${codigo}`);
  const [{ data, error }, { data: sesion }] = await Promise.all([
    supabase.rpc('preview_whatsapp_verification', { p_token: codigo }),
    supabase.auth.getClaims(),
  ]);
  if (error) throw error;
  const correo = typeof sesion?.claims?.email === 'string' ? sesion.claims.email : null;

  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <LogoLink />
        <span className="ap-me">
          <MenuPrincipal />
        </span>
      </header>
      <Verificar codigo={codigo} vista={data as VerificacionWhatsapp} correo={correo} />
    </div>
  );
}
