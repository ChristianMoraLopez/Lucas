'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useT } from '@/components/idioma';
import { Button, Field } from '@/components/lucas-ui';
import { useRegion } from '@/components/region';
import { humanError } from '@/lib/errors';
import { IDIOMAS, NOMBRE_IDIOMA } from '@/lib/i18n';
import { MONEDAS, NOMBRE_MONEDA } from '@/lib/moneda';
import { REGION } from '@/lib/region';
import { createClient } from '@/utils/supabase/client';

// Los mensajes de error pasan por t al mostrarse (FieldError)
const schema = z
  .object({
    name: z.string().trim().min(1, 'Ponle un nombre a la cuenta').max(60, 'Máximo 60 letras'),
    type: z.enum(['hogar', 'evento']),
    startsOn: z.string(),
    endsOn: z.string(),
    displayName: z.string().trim().min(1, 'Escribe cómo te dicen').max(40, 'Máximo 40 letras'),
    currency: z.enum(MONEDAS as [string, ...string[]]),
    language: z.enum(IDIOMAS as [string, ...string[]]),
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
  const t = useT();
  const region = useRegion();
  const [supabase] = useState(() => createClient());
  const [error, setError] = useState<string | null>(null);
  // Ya se creó y va para la cuenta: el botón sigue ocupado hasta que llegue
  const [yendo, setYendo] = useState(false);

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    // La moneda, la de la región elegida en el menú; el idioma de Luks en el grupo, el de la pantalla
    defaultValues: { name: '', type: 'evento', startsOn: '', endsOn: '', displayName: myName, currency: REGION[region].moneda, language: t.idioma },
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
    // Las cuentas nacen en pesos colombianos y en español: si se eligió otra cosa, se cambia de una
    if (v.currency !== 'COP' || v.language !== 'es') {
      const { error: ajustes } = await supabase.rpc('set_account_settings', {
        p_account_id: data as string,
        p_currency: v.currency,
        p_language: v.language,
      });
      if (ajustes) {
        setError(humanError(ajustes));
        return;
      }
    }
    // Primero el grupo de WhatsApp: es el motor de Luks (y trae a la gente del grupo)
    setYendo(true);
    router.push(`/c/${data as string}/whatsapp`);
    router.refresh();
  });

  return (
    <form onSubmit={submit} noValidate>
      <div className="lu-field">
        <span className="lu-label" id="tipo">
          {t('Tipo de cuenta')}
        </span>
        <div className="nc-types" role="radiogroup" aria-labelledby="tipo">
          {TYPES.map((x) => (
            <button
              key={x.id}
              type="button"
              role="radio"
              aria-checked={type === x.id}
              className={`nc-type nc-type--${x.id}${type === x.id ? ' is-on' : ''}`}
              onClick={() => setValue('type', x.id)}
            >
              <b>{t(x.title)}</b>
              <span>{t(x.text)}</span>
            </button>
          ))}
        </div>
      </div>

      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <Field
            label={type === 'evento' ? t('Nombre del evento (p. ej. Paseo Santa Marta)') : t('Nombre (p. ej. Casa)')}
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
              <Field label={t('Empieza')} id="inicio" num>
                <input id="inicio" type="date" value={field.value} onChange={field.onChange} />
              </Field>
            )}
          />
          <Controller
            control={control}
            name="endsOn"
            render={({ field }) => (
              <Field label={t('Termina')} id="fin" num>
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
        render={({ field }) => <Field label={t('¿Cómo te dicen en el grupo?')} id="tu-nombre" value={field.value} onChange={field.onChange} />}
      />
      <FieldError message={errors.displayName?.message} />

      <div className="nc-dates">
        <Controller
          control={control}
          name="currency"
          render={({ field }) => (
            <Field label={t('Moneda')} id="moneda">
              <select id="moneda" value={field.value} onChange={field.onChange}>
                {MONEDAS.map((m) => (
                  <option key={m} value={m}>
                    {t(NOMBRE_MONEDA[m])} ({m})
                  </option>
                ))}
              </select>
            </Field>
          )}
        />
        <Controller
          control={control}
          name="language"
          render={({ field }) => (
            <Field label={t('Luks responde en el grupo en')} id="idioma-cuenta">
              <select id="idioma-cuenta" value={field.value} onChange={field.onChange}>
                {IDIOMAS.map((i) => (
                  <option key={i} value={i}>
                    {NOMBRE_IDIOMA[i]}
                  </option>
                ))}
              </select>
            </Field>
          )}
        />
      </div>
      <span className="lu-small lu-muted nc-nota">{t('La moneda se puede cambiar hasta que llegue el primer gasto.')}</span>

      {error && (
        <p className="lu-error" role="alert">
          {error}
        </p>
      )}

      <div className="nc-go">
        <Button type="submit" disabled={isSubmitting || yendo}>
          {isSubmitting || yendo ? t('Creando…') : t('Crear cuenta')}
        </Button>
        <span className="lu-small lu-muted">{t('Después invitas al resto con un código.')}</span>
      </div>
    </form>
  );
}

function FieldError({ message }: { message?: string }) {
  const t = useT();
  if (!message) return null;
  return (
    <p className="lu-field-error" role="alert">
      {t(message)}
    </p>
  );
}
