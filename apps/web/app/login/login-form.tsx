'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Divider, Field } from '@/components/lucas-ui';
import { callbackUrl } from '@/lib/auth';
import { humanError } from '@/lib/errors';
import { createClient } from '@/utils/supabase/client';

const schema = z.object({
  email: z.string().trim().min(1, 'Escribe tu correo').email('Ese correo no parece válido. Revísalo.'),
});
type Values = z.infer<typeof schema>;

export function LoginForm({ next, initialError }: { next: string; initialError: string | null }) {
  const [supabase] = useState(() => createClient());
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [googleBusy, setGoogleBusy] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  const sendMagicLink = handleSubmit(async ({ email }) => {
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl(window.location.origin, next) },
    });
    if (error) setError(humanError(error));
    else setSentTo(email);
  });

  const signInWithGoogle = async () => {
    setGoogleBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl(window.location.origin, next) },
    });
    if (error) {
      setGoogleBusy(false);
      setError(humanError(error));
    }
  };

  if (sentTo) {
    return (
      <div className="lg-form">
        <p className="lu-success" role="status">
          Listo: te mandamos un enlace a <b>{sentTo}</b>. Ábrelo y quedas adentro, aunque sea desde el celular.
        </p>
        <p className="lu-small lu-muted" style={{ margin: 0 }}>
          ¿No llega? Revisa en spam o en «Promociones». El enlace vence en una hora.
        </p>
        <Button variant="ghost" size="sm" onClick={() => setSentTo(null)}>
          Usar otro correo
        </Button>
      </div>
    );
  }

  return (
    <div className="lg-form">
      <form onSubmit={sendMagicLink} noValidate className="lg-form">
        <Controller
          control={control}
          name="email"
          render={({ field }) => <Field label="Tu correo" id="correo" value={field.value} onChange={field.onChange} inputMode="email" />}
        />
        {errors.email && (
          <p className="lu-field-error" role="alert">
            {errors.email.message}
          </p>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Enviando…' : 'Mandarme el enlace'}
        </Button>
      </form>

      {error && (
        <p className="lu-error" role="alert">
          {error}
        </p>
      )}

      <Divider label="o" />
      <Button variant="outline" onClick={signInWithGoogle} disabled={googleBusy}>
        {googleBusy ? 'Abriendo Google…' : 'Seguir con Google'}
      </Button>
    </div>
  );
}
