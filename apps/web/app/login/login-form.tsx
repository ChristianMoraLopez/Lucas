'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Divider, Field } from '@/components/lucas-ui';
import { callbackUrl } from '@/lib/auth';
import { humanError } from '@/lib/errors';
import { createClient } from '@/utils/supabase/client';

type Modo = 'entrar' | 'crear' | 'olvide' | 'enlace';

const correo = z.string().trim().min(1, 'Escribe tu correo').email('Ese correo no parece válido. Revísalo.');
const clave = z.string().min(8, 'Mínimo 8 caracteres');
const schemas = {
  entrar: z.object({ email: correo, password: z.string().min(1, 'Escribe tu contraseña') }),
  crear: z.object({ name: z.string().trim().min(1, 'Escribe cómo te dicen').max(40, 'Máximo 40 letras'), email: correo, password: clave }),
  olvide: z.object({ email: correo }),
  enlace: z.object({ email: correo }),
};
type Valores = { name?: string; email: string; password?: string };

const TITULOS: Record<Modo, string> = {
  entrar: 'Entrar',
  crear: 'Crear cuenta',
  olvide: 'Recuperar contraseña',
  enlace: 'Entrar con un enlace',
};

export function LoginForm({ next, initialError, initialMode = 'entrar' }: { next: string; initialError: string | null; initialMode?: Modo }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [modo, setModo] = useState<Modo>(initialMode);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [googleBusy, setGoogleBusy] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Valores>({
    resolver: zodResolver(schemas[modo] as unknown as z.ZodType<Valores, Valores>),
    defaultValues: { name: '', email: '', password: '' },
  });

  const cambiar = (m: Modo) => {
    setModo(m);
    setError(null);
    setAviso(null);
    reset(undefined, { keepValues: true });
  };

  const entrarYa = () => {
    router.replace(next);
    router.refresh();
  };

  const enviar = handleSubmit(async ({ name, email, password }) => {
    setError(null);
    const vuelta = callbackUrl(window.location.origin, next);
    if (modo === 'entrar') {
      const { error } = await supabase.auth.signInWithPassword({ email, password: password as string });
      if (error) return setError(humanError(error));
      return entrarYa();
    }
    if (modo === 'crear') {
      const { data, error } = await supabase.auth.signUp({
        email,
        password: password as string,
        options: { data: { full_name: name }, emailRedirectTo: vuelta },
      });
      if (error) return setError(humanError(error));
      // Si el proyecto no pide confirmar el correo, ya hay sesión
      if (data.session) return entrarYa();
      if (data.user && data.user.identities?.length === 0) return setError('Ya hay una cuenta con ese correo. Entra o recupera tu contraseña.');
      return setAviso(`Te mandamos un correo a ${email} para confirmar tu cuenta. Ábrelo y quedas adentro.`);
    }
    if (modo === 'olvide') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl(window.location.origin, '/cuenta/clave') });
      if (error) return setError(humanError(error));
      return setAviso(`Si ${email} tiene cuenta en Lucas, te llega un enlace para poner una contraseña nueva.`);
    }
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: vuelta } });
    if (error) return setError(humanError(error));
    return setAviso(`Te mandamos un enlace a ${email}. Ábrelo y quedas adentro, aunque sea desde el celular.`);
  });

  const conGoogle = async () => {
    setGoogleBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callbackUrl(window.location.origin, next) } });
    if (error) {
      setGoogleBusy(false);
      setError(humanError(error));
    }
  };

  const principal = modo === 'entrar' || modo === 'crear';

  return (
    <div className="lg-form">
      {principal && (
        <div className="lg-tabs" role="tablist" aria-label="Entrar o crear cuenta">
          {(['entrar', 'crear'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={modo === m} className="lg-tab" onClick={() => cambiar(m)}>
              {TITULOS[m]}
            </button>
          ))}
        </div>
      )}
      {!principal && <h2 className="lu-title">{TITULOS[modo]}</h2>}

      {aviso ? (
        <>
          <p className="lu-success" role="status">
            {aviso}
          </p>
          <p className="lu-small lu-muted" style={{ margin: 0 }}>
            ¿No llega? Revisa en spam o en «Promociones».
          </p>
          <Button variant="ghost" size="sm" onClick={() => cambiar('entrar')}>
            Volver a entrar
          </Button>
        </>
      ) : (
        <form onSubmit={enviar} noValidate className="lg-form">
          {modo === 'crear' && (
            <>
              <Field label="¿Cómo te dicen?" id="nombre">
                <input id="nombre" autoComplete="given-name" {...register('name')} />
              </Field>
              {errors.name && <FieldError text={errors.name.message} />}
            </>
          )}

          <Field label="Correo" id="correo">
            <input id="correo" type="email" autoComplete="email" inputMode="email" {...register('email')} />
          </Field>
          {errors.email && <FieldError text={errors.email.message} />}

          {(modo === 'entrar' || modo === 'crear') && (
            <>
              <Field label="Contraseña" id="clave">
                <input id="clave" type="password" autoComplete={modo === 'crear' ? 'new-password' : 'current-password'} {...register('password')} />
              </Field>
              {errors.password && <FieldError text={errors.password.message} />}
              {modo === 'crear' && !errors.password && <span className="lu-small lu-muted">Mínimo 8 caracteres.</span>}
            </>
          )}

          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Un momento…' : modo === 'entrar' ? 'Entrar' : modo === 'crear' ? 'Crear mi cuenta' : 'Mandarme el enlace'}
          </Button>

          {modo === 'entrar' && (
            <Button variant="ghost" size="sm" onClick={() => cambiar('olvide')}>
              ¿Olvidaste tu contraseña?
            </Button>
          )}
          {!principal && (
            <Button variant="ghost" size="sm" onClick={() => cambiar('entrar')}>
              Volver
            </Button>
          )}
        </form>
      )}

      {error && (
        <p className="lu-error" role="alert">
          {error}
        </p>
      )}

      {principal && !aviso && (
        <>
          <Divider label="o" />
          <Button variant="outline" onClick={conGoogle} disabled={googleBusy}>
            {googleBusy ? 'Abriendo Google…' : 'Seguir con Google'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => cambiar('enlace')}>
            Prefiero un enlace al correo, sin contraseña
          </Button>
        </>
      )}
    </div>
  );
}

function FieldError({ text }: { text?: string }) {
  return (
    <p className="lu-field-error" role="alert">
      {text}
    </p>
  );
}
