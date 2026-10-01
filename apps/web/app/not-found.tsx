import Link from 'next/link';
import { Logo, LottieSlot } from '@/components/lucas-ui';

export default function NoEncontrado() {
  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <Link href="/" className="lu-logo-link" aria-label="Ir al inicio">
          <Logo />
        </Link>
      </header>
      <main className="nf">
        <LottieSlot name="no-encontrado" width={180} height={180} label="No encontrado" />
        <h1 className="lu-display">Esto no está por aquí</h1>
        <p className="lu-small lu-muted" style={{ margin: 0, maxWidth: '42ch' }}>
          Puede que el enlace esté mal escrito, que el gasto ya no exista o que no seas de esa cuenta.
        </p>
        <Link href="/" className="lu-btn lu-btn--primary">
          Ir a mis cuentas
        </Link>
      </main>
    </div>
  );
}
