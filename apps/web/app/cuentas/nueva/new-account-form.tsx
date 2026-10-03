'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Field } from '@/components/lucas-ui';
import { humanError } from '@/lib/errors';
import { createClient } from '@/utils/supabase/client';

const schema = z
  .object({
    name: z.string().trim().min(1, 'Ponle un nombre a la cuenta').max(60, 'Máximo 60 letras'),
    type: z.enum(['hogar', 'evento']),
    startsOn: z.string(),
    endsOn: z.string(),
    displayName: z.string().trim().min(1, 'Escribe cómo te dicen').max(40, 'Máximo 40 letras'),
  })
  .refine((v) => v.type !== 'evento' || !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn, {
    path: ['endsOn'],
    message: 'La fecha de fin no puede ser antes de la de inicio',
  });
type Values = z.infer<typeof schema>;

const TYPES = [
  { id: 'hogar', title: 'Hogar', text: 'Los gastos de todos los meses: mercado, servicios, arriendo. Con presupuesto mensual.' },
  { id: 'evento', title: 'Evento', text: 'Un paseo, una vaca, un cumpleaños. Tiene inicio y fin, y al final se liquida.' },
] as const;

export function NewAccountForm({ myName }: { myName: string }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [error, setError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', type: 'evento', startsOn: '', endsOn: '', displayName: myName },
  });
  const type = watch('type');

  const submit = handleSubmit(async (v) => {
    setError(null);
    const { data, error } = await supabase.rpc('create_account', {
      p_name: v.name,
      p_type: v.type,
      p_starts_on: v.type === 'evento' && v.startsOn ? v.startsOn : null,
      p_ends_on: v.type === 'evento' && v.endsOn ? v.endsOn : null,
      p_display_name: v.displayName,
    });
    if (error) {
      setError(humanError(error));
      return;
    }
    // Primero el grupo de WhatsApp: es el motor de Luks (y trae a la gente del grupo)
    router.push(`/c/${data as string}/whatsapp`);
    router.refresh();
  });

  return (
    <form onSubmit={submit} noValidate>
      <div className="lu-field">
        <span className="lu-label" id="tipo">
          Tipo de cuenta
        </span>
        <div className="nc-types" role="radiogroup" aria-labelledby="tipo">
          {TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={type === t.id}
              className={`nc-type nc-type--${t.id}${type === t.id ? ' is-on' : ''}`}
              onClick={() => setValue('type', t.id)}
            >
              <b>{t.title}</b>
              <span>{t.text}</span>
            </button>
          ))}
        </div>
      </div>

      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <Field
            label={type === 'evento' ? 'Nombre del evento (p. ej. Paseo Santa Marta)' : 'Nombre (p. ej. Casa)'}
            id="nombre"
            value={field.value}
            onChange={field.onChange}
          />
        )}
      />
      <FieldError message={errors.name?.message} />

      {type === 'evento' && (
        <div className="nc-dates">
          <Controller
            control={control}
            name="startsOn"
            render={({ field }) => (
              <Field label="Empieza" id="inicio" num>
                <input id="inicio" type="date" value={field.value} onChange={field.onChange} />
              </Field>
            )}
          />
          <Controller
            control={control}
            name="endsOn"
            render={({ field }) => (
              <Field label="Termina" id="fin" num>
                <input id="fin" type="date" value={field.value} min={watch('startsOn') || undefined} onChange={field.onChange} />
              </Field>
            )}
          />
          <FieldError message={errors.endsOn?.message} />
        </div>
      )}

      <Controller
        control={control}
        name="displayName"
        render={({ field }) => <Field label="¿Cómo te dicen en el grupo?" id="tu-nombre" value={field.value} onChange={field.onChange} />}
      />
      <FieldError message={errors.displayName?.message} />

      {error && (
        <p className="lu-error" role="alert">
          {error}
        </p>
      )}

      <div className="nc-go">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Creando…' : 'Crear cuenta'}
        </Button>
        <span className="lu-small lu-muted">Después invitas al resto con un código.</span>
      </div>
    </form>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="lu-field-error" role="alert">
      {message}
    </p>
  );
}
