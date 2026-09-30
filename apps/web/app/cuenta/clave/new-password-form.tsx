'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Field } from '@/components/lucas-ui';
import { humanError } from '@/lib/errors';
import { createClient } from '@/utils/supabase/client';

const schema = z
  .object({ password: z.string().min(8, 'Mínimo 8 caracteres'), repeat: z.string() })
  .refine((v) => v.password === v.repeat, { path: ['repeat'], message: 'No coinciden' });

export function NewPasswordForm() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  const guardar = handleSubmit(async ({ password }) => {
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return setError(humanError(error));
    router.replace('/');
    router.refresh();
  });

  return (
    <form onSubmit={guardar} noValidate>
      <Field label="Contraseña nueva" id="clave-nueva">
        <input id="clave-nueva" type="password" autoComplete="new-password" {...register('password')} />
      </Field>
      {errors.password && (
        <p className="lu-field-error" role="alert">
          {errors.password.message}
        </p>
      )}
      <Field label="Repítela" id="clave-repite">
        <input id="clave-repite" type="password" autoComplete="new-password" {...register('repeat')} />
      </Field>
      {errors.repeat && (
        <p className="lu-field-error" role="alert">
          {errors.repeat.message}
        </p>
      )}
      {error && (
        <p className="lu-error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Guardando…' : 'Guardar contraseña'}
      </Button>
    </form>
  );
}
