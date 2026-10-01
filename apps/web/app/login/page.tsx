import { lucas, type Tone } from '@/components/lucas-core';
import { Avatar, BillCard, Logo, Sticker } from '@/components/lucas-ui';
import { ThemeToggle } from '@/components/theme-toggle';
import { safeNext } from '@/lib/auth';
import { LoginForm } from './login-form';

// El proxy ya manda a / a quien tiene sesión; aquí solo se pinta el formulario.

const ERRORES: Record<string, string> = {
  enlace: 'Ese enlace ya no sirve: se usa una sola vez y vence en una hora. Pide otro.',
  cancelado: 'Cancelaste la entrada con Google. Puedes intentar otra vez o usar tu correo.',
};

// Las 8 del paseo de muestra, con los tonos de setTones en el kit
const MUESTRA: [string, Tone][] = [
  ['Valeria', 'morado'],
  ['Laura', 'verde'],
  ['Mafe', 'azul'],
  ['Caro', 'turquesa'],
  ['Juan Camilo', 'naranja'],
  ['Felipe', 'rosa'],
  ['Andrés', 'coral'],
  ['Santi', 'amarillo'],
];

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === 'string' ? params.next : null);
  const error = typeof params.error === 'string' ? (ERRORES[params.error] ?? null) : null;
  const vieneDeInvitacion = next.startsWith('/e/') || next.startsWith('/unirse');
  const modo = params.modo === 'crear' || vieneDeInvitacion ? 'crear' : 'entrar';

  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <Logo />
        <span className="ap-me">
          <ThemeToggle />
        </span>
      </header>
      <div className="lg">
        <section className="lg-main">
          <div className="ap-intro">
            <h1 className="lu-display">{vieneDeInvitacion ? 'Entra para unirte' : 'Entra a Luks'}</h1>
            <p className="lu-small lu-muted" style={{ margin: 0 }}>
              {vieneDeInvitacion
                ? 'Te invitaron a una cuenta. Entra o crea tu usuario y de una te mostramos cuál es.'
                : 'Las cuentas del hogar y de los paseos, sin pelear con el Excel.'}
            </p>
          </div>
          <LoginForm next={next} initialError={error} initialMode={modo} />
        </section>

        <aside className="lg-side" aria-label="Así se ve una cuenta en Luks">
          <BillCard
            label="Evento · 24 – 28 sep 2026"
            amount={4_816_000}
            tone="morado"
            aside={
              <Sticker tone="revisar" rotate={6}>
                3 por revisar
              </Sticker>
            }
          >
            <span className="ap-lead__n">Paseo Santa Marta</span>
            <span className="lu-avatars">
              {MUESTRA.map(([n, tone]) => (
                <Avatar key={n} name={n} tone={tone} size="sm" />
              ))}
            </span>
            <span>
              Terminó ayer · falta liquidar · <b>{lucas(602_000)}</b> por cabeza
            </span>
          </BillCard>
          <ol className="lg-steps">
            <li>Mandan la foto del recibo al grupo de WhatsApp.</li>
            <li>Luks lo lee, lo clasifica y lo divide.</li>
            <li>Al final, les dice quién le paga a quién.</li>
          </ol>
        </aside>
      </div>
    </div>
  );
}
