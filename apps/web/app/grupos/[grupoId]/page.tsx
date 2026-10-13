import Link from 'next/link';
import { ConectarGrupo } from '@/components/conectar-grupo';
import { LogoLink } from '@/components/logo-link';
import { LottieSlot } from '@/components/lucas-ui';
import { MenuPrincipal } from '@/components/menu-principal';
import { getT } from '@/lib/i18n/server';
import type { GrupoVista } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';

/**
 * Un grupo para crearle la cuenta (o conectarlo a una mía) desde la app: el
 * de «Nuevo grupo detectado» (mi número verificado está en un grupo de Mister
 * Luks) o uno de mi WhatsApp vinculado. La base revisa que sea así.
 */
export default async function GrupoMioPage({ params }: PageProps<'/grupos/[grupoId]'>) {
  const { grupoId } = await params;
  const { supabase, userId } = await requireUser(`/grupos/${grupoId}`);
  const t = await getT();
  const uuid = /^[0-9a-f-]{36}$/i.test(grupoId);
  const [{ data, error }, { data: perfil }] = await Promise.all([
    uuid ? supabase.rpc('preview_group', { p_group_id: grupoId }) : Promise.resolve({ data: { status: 'invalid' }, error: null }),
    supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
  ]);
  if (error) throw error;
  const vista = data as GrupoVista;
  const miNombre = perfil?.full_name?.trim().split(/\s+/)[0] ?? '';

  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <LogoLink />
        <span className="ap-me">
          <MenuPrincipal />
        </span>
      </header>
      {vista.status === 'ok' ? (
        <ConectarGrupo vista={vista} token={null} miNombre={miNombre} />
      ) : (
        <main className="vf">
          <LottieSlot name="no-encontrado" width={140} height={140} />
          <h1 className="lu-display">{t('No encontramos ese grupo')}</h1>
          <p className="lu-small lu-muted vf-txt">{t('Puede que ya no estés en él, o que tu WhatsApp ya no esté vinculado.')}</p>
          <Link href="/grupos" className="lu-btn lu-btn--secondary">
            {t('Ver tus grupos de WhatsApp')}
          </Link>
        </main>
      )}
    </div>
  );
}
