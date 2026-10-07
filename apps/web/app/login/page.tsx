import { LogoLink } from '@/components/logo-link';
import { lucas, type Tone } from '@/components/lucas-core';
import { Avatar, BillCard, Sticker } from '@/components/lucas-ui';
import { MenuPrincipal } from '@/components/menu-principal';
import { MonedaProvider } from '@/components/moneda';
import { safeNext } from '@/lib/auth';
import { rico } from '@/lib/i18n/rico';
import { getRegion, getT } from '@/lib/i18n/server';
import type { Moneda } from '@/lib/moneda';
import { REGION } from '@/lib/region';
import { LoginForm } from './login-form';

// El proxy ya manda a / a quien tiene sesión; aquí solo se pinta el formulario.

const ERRORES: Record<string, string> = {
  enlace: 'Ese enlace ya no sirve: se usa una sola vez y vence en una hora. Pide otro.',
  cancelado: 'Cancelaste la entrada con Google. Puedes intentar otra vez o usar tu correo.',
};

// El paseo de muestra en la moneda de la región: total y lo de cada uno (8 personas)
const MUESTRA_TOTAL: Record<Moneda, number> = { COP: 4_816_000, CLP: 1_216_000, BOB: 864_000, USD: 124_800 };

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
  const [t, region] = await Promise.all([getT(), getRegion()]);
  const moneda = REGION[region].moneda;
  const total = MUESTRA_TOTAL[moneda];
  const error = typeof params.error === 'string' && ERRORES[params.error] ? t(ERRORES[params.error]) : null;
  const vieneDeInvitacion = next.startsWith('/e/') || next.startsWith('/unirse');
  const modo = params.modo === 'crear' || vieneDeInvitacion ? 'crear' : 'entrar';

  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <LogoLink />
        <span className="ap-me">
          <MenuPrincipal sesion={false} />
        </span>
      </header>
      <div className="lg">
        <section className="lg-main">
          <div className="ap-intro">
            <h1 className="lu-display">{vieneDeInvitacion ? t('Entra para unirte') : t('Entra a Luks')}</h1>
            <p className="lu-small lu-muted" style={{ margin: 0 }}>
              {vieneDeInvitacion
                ? t('Te invitaron a una cuenta. Entra o crea tu usuario y de una te mostramos cuál es.')
                : t('Las cuentas del hogar y de los paseos, sin pelear con el Excel.')}
            </p>
          </div>
          {params.eliminada === '1' && (
            <p className="lu-success" role="status" style={{ margin: 0 }}>
              {t('Tu cuenta quedó eliminada. Gracias por usar Luks.')}
            </p>
          )}
          <LoginForm next={next} initialError={error} initialMode={modo} />
        </section>

        <aside className="lg-side" aria-label={t('Así se ve una cuenta en Luks')}>
          <MonedaProvider moneda={moneda}>
            <BillCard
              label={t('Evento · 24 – 28 sep 2026')}
              amount={total}
              tone="morado"
              aside={
                <Sticker tone="revisar" rotate={6}>
                  {t('{n} por revisar', { n: 3 })}
                </Sticker>
              }
            >
              <span className="ap-lead__n">{t('Paseo Santa Marta')}</span>
              <span className="lu-avatars">
                {MUESTRA.map(([n, tone]) => (
                  <Avatar key={n} name={n} tone={tone} size="sm" />
                ))}
              </span>
              <span>{rico(t('Terminó ayer · falta liquidar · {monto} por cabeza'), { monto: <b>{lucas(total / 8, t.idioma, moneda)}</b> })}</span>
            </BillCard>
          </MonedaProvider>
          <ol className="lg-steps">
            <li>{t('Mandan la foto del recibo al grupo de WhatsApp.')}</li>
            <li>{t('Luks lo lee, lo clasifica y lo divide.')}</li>
            <li>{t('Al final, les dice quién le paga a quién.')}</li>
          </ol>
        </aside>
      </div>
    </div>
  );
}
