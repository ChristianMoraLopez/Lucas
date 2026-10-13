import Link from 'next/link';
import { ConectarGrupo } from '@/components/conectar-grupo';
import { LogoLink } from '@/components/logo-link';
import { LottieSlot } from '@/components/lucas-ui';
import { MenuPrincipal } from '@/components/menu-principal';
import { getT } from '@/lib/i18n/server';
import { chatHref, MISTER_LUKS } from '@/lib/mister-luks';
import type { GrupoVista } from '@/lib/types';
import { requireUser } from '@/utils/supabase/server';

/**
 * El link que manda Mister Luks en el saludo de un grupo sin cuenta
 * (mrluks.com/g/CÓDIGO): con la sesión iniciada, quien lo abre crea la cuenta
 * del grupo o lo conecta a una suya. Sin sesión, el proxy lo lleva a entrar
 * (o a crear su usuario) y lo trae de vuelta. Del grupo solo se ven los
 * nombres y los últimos 4 números.
 */
export default async function GrupoPage({ params }: PageProps<'/g/[token]'>) {
  const { token } = await params;
  const { supabase, userId } = await requireUser(`/g/${token}`);
  const t = await getT();
  const [{ data, error }, { data: perfil }] = await Promise.all([
    supabase.rpc('preview_group', { p_token: token }),
    supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
  ]);
  if (error) throw error;
  const vista = data as GrupoVista;
  const miNombre = perfil?.full_name?.trim().split(/\s+/)[0] ?? '';

  let cuerpo: React.ReactNode;
  if (vista.status === 'ok') {
    cuerpo = <ConectarGrupo vista={vista} token={token} miNombre={miNombre} />;
  } else if (vista.status === 'used' && vista.linked) {
    const l = vista.linked;
    cuerpo = (
      <main className="vf">
        <LottieSlot name="whatsapp-conectado" width={140} height={140} />
        <h1 className="lu-display">{t('Este grupo ya tiene cuenta')}</h1>
        <p className="vf-num">{l.account_name}</p>
        {l.member && l.account_id ? (
          <Link href={`/c/${l.account_id}/resumen`} className="lu-btn lu-btn--primary">
            {t('Ir a la cuenta')}
          </Link>
        ) : (
          <>
            <p className="lu-small lu-muted vf-txt">
              {t('Para entrar, escribe «luks soy yo» en el grupo y abre el link que te manda Mister Luks. Así quedas como tu persona del grupo.')}
            </p>
            <a className="lu-btn lu-btn--primary" href={chatHref(MISTER_LUKS.telefono, 'luks soy yo')} target="_blank" rel="noopener noreferrer">
              {t('Escribirle «luks soy yo»')}
            </a>
          </>
        )}
      </main>
    );
  } else {
    cuerpo = (
      <main className="vf">
        <LottieSlot name={vista.status === 'invalid' ? 'no-encontrado' : 'error'} width={140} height={140} />
        <h1 className="lu-display">{vista.status === 'invalid' ? t('Este link no sirve') : t('Este link ya venció')}</h1>
        <p className="lu-small lu-muted vf-txt">
          {vista.status === 'invalid'
            ? t('Puede que se haya cortado al copiarlo. Escriban «ayuda» en el grupo y Mister Luks manda uno nuevo.')
            : t('Dura dos semanas. Escriban «ayuda» en el grupo y Mister Luks manda uno nuevo.')}
        </p>
        <Link href="/" className="lu-btn lu-btn--secondary">
          {t('Ir a mis cuentas')}
        </Link>
      </main>
    );
  }

  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <LogoLink />
        <span className="ap-me">
          <MenuPrincipal />
        </span>
      </header>
      {cuerpo}
    </div>
  );
}
