import Link from 'next/link';
import { LogoLink } from '@/components/logo-link';
import { LottieSlot } from '@/components/lucas-ui';
import { MenuPrincipal } from '@/components/menu-principal';
import { getT } from '@/lib/i18n/server';

export default async function NoEncontrado() {
  const t = await getT();
  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <LogoLink />
        <span className="ap-me">
          <MenuPrincipal sesion={false} />
        </span>
      </header>
      <main className="nf">
        <LottieSlot name="no-encontrado" width={180} height={180} label={t('No encontrado')} />
        <h1 className="lu-display">{t('Esto no está por aquí')}</h1>
        <p className="lu-small lu-muted" style={{ margin: 0, maxWidth: '42ch' }}>
          {t('Puede que el enlace esté mal escrito, que el gasto ya no exista o que no seas de esa cuenta.')}
        </p>
        <Link href="/" className="lu-btn lu-btn--primary">
          {t('Ir a mis cuentas')}
        </Link>
      </main>
    </div>
  );
}
