'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/components/idioma';
import { Avatar, Button, CODE_RE, CodeInput, Divider, Field, formatCode, LottieSlot, Person } from '@/components/lucas-ui';
import { formatRange } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import type { T } from '@/lib/i18n';
import { accountGlyph, asTone, type InvitationPreview, plural } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

const NUEVA = 'nueva';

export function JoinFlow({ initialCode, myName }: { initialCode: string; myName: string }) {
  const router = useRouter();
  const t = useT();
  const [supabase] = useState(() => createClient());

  // El código puede llegar por el link (/e/PASEO-7K2Q → ?codigo=PASEO-7K2Q)
  const [code, setCode] = useState(() => formatCode(initialCode));
  const [selected, setSelected] = useState<string>(NUEVA);
  const [displayName, setDisplayName] = useState(myName);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const complete = CODE_RE.test(code);
  const preview = useQuery({
    queryKey: ['invitation-preview', code],
    enabled: complete,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('preview_invitation', { p_code: code });
      if (error) throw error;
      return data as InvitationPreview;
    },
  });

  const found = complete ? preview.data : undefined;
  const codeError = complete && preview.isError ? humanError(preview.error) : null;
  const people = found?.unclaimed_people ?? [];
  const chosen = people.find((p) => p.id === selected);

  const join = async () => {
    if (!found) return;
    if (!chosen && !displayName.trim()) {
      setJoinError(t('Escribe tu nombre para entrar como persona nueva'));
      return;
    }
    setJoining(true);
    setJoinError(null);
    const { data, error } = await supabase.rpc('join_with_code', {
      p_code: code,
      p_person_id: chosen ? chosen.id : null,
      p_display_name: chosen ? null : displayName.trim(),
    });
    if (error) {
      setJoining(false);
      setJoinError(humanError(error));
      return;
    }
    router.push(`/c/${data as string}/resumen`);
    router.refresh();
  };

  return (
    <div className="jn">
      <section className="jn-code">
        <h1 className="lu-display">{t('Entra a una cuenta')}</h1>
        <p className="lu-small lu-muted" style={{ margin: '6px 0 var(--space-6)' }}>
          {t('Pídele el código a quien creó la cuenta, o cópialo del grupo. También sirve pegar el link completo.')}
        </p>
        <CodeInput
          value={code}
          onChange={(v) => {
            setCode(v);
            setSelected(NUEVA);
            setJoinError(null);
          }}
          error={codeError}
          hint={found ? t('¡La encontramos!') : t('Buscando la cuenta…')}
        />

        {!found && !codeError && (
          <div className="jn-wait">
            <LottieSlot name="vacio" width={72} height={72} />
            <span className="lu-small lu-muted">{complete ? t('Buscando la cuenta…') : t('Cuando el código esté completo te mostramos la cuenta.')}</span>
          </div>
        )}

        {found && (
          <div className="jn-acct">
            <span className="jn-glyph" aria-hidden="true">
              {accountGlyph(found.account_name)}
            </span>
            <span style={{ display: 'grid', minWidth: 0 }}>
              <b>{found.account_name}</b>
              <span className="lu-small lu-muted">
                {found.account_type === 'evento'
                  ? `${t('Evento')}${found.starts_on ? ` · ${formatRange(found.starts_on, found.ends_on, t.idioma)}` : ''}`
                  : t('Hogar')}{' '}
                · {t('la creó {nombre}', { nombre: found.owner_name })}
              </span>
            </span>
            <span className="lu-avatars" style={{ marginLeft: 'auto' }}>
              {people.slice(0, 4).map((p) => (
                <Avatar key={p.id} name={p.display_name} tone={asTone(p.tone, p.display_name)} size="xs" registered={false} />
              ))}
            </span>
          </div>
        )}

        {codeError && (
          <div className="jn-help">
            <Divider label={t('¿No sirve?')} />
            <p className="lu-small lu-muted" style={{ margin: 0 }}>
              {t('Pídele a quien administra la cuenta un código nuevo: lo saca en la pestaña Personas.')}
            </p>
          </div>
        )}
      </section>

      {found?.already_member && (
        <section className="jn-claim">
          <h2 className="lu-title">{t('Ya estás en esta cuenta')}</h2>
          <p className="lu-small lu-muted" style={{ margin: '4px 0 var(--space-4)' }}>
            {t('No tienes que volver a entrar con el código.')}
          </p>
          <Link href={`/c/${found.account_id}/resumen`} className="lu-btn lu-btn--primary">
            {t('Ir a {cuenta}', { cuenta: found.account_name })}
          </Link>
        </section>
      )}

      {found && !found.already_member && (
        <section className="jn-claim" aria-labelledby="jn-q">
          {people.length > 0 ? (
            <>
              <h2 id="jn-q" className="lu-title">
                {t('¿Eres alguna de estas personas?')}
              </h2>
              <p className="lu-small lu-muted" style={{ margin: '4px 0 var(--space-4)' }}>
                {t('Ya aparecen en los gastos pero no tienen cuenta. Si eres una, esos gastos quedan a tu nombre.')}
              </p>
              <div className="jn-opts" role="radiogroup" aria-labelledby="jn-q">
                {people.map((p) => (
                  <label key={p.id} className={`jn-opt${selected === p.id ? ' is-on' : ''}`}>
                    <input type="radio" name="quien" checked={selected === p.id} onChange={() => setSelected(p.id)} />
                    <Person name={p.display_name} tone={asTone(p.tone, p.display_name)} sub={claimSub(p, t)} />
                  </label>
                ))}
                <label className={`jn-opt${selected === NUEVA ? ' is-on' : ''}`}>
                  <input type="radio" name="quien" checked={selected === NUEVA} onChange={() => setSelected(NUEVA)} />
                  <span style={{ display: 'grid' }}>
                    <b>{t('No, soy otra persona')}</b>
                    <span className="lu-small lu-muted">{t('Entro como participante nuevo')}</span>
                  </span>
                </label>
              </div>
            </>
          ) : (
            <>
              <h2 id="jn-q" className="lu-title">
                {t('¿Cómo te dicen en el grupo?')}
              </h2>
              <p className="lu-small lu-muted" style={{ margin: '4px 0 0' }}>
                {t('Así te van a ver en los gastos de {cuenta} ({personas} hasta ahora).', {
                  cuenta: found.account_name,
                  personas: plural(found.people_count, t('persona'), t('personas')),
                })}
              </p>
            </>
          )}

          {!chosen && (
            <div className="jn-name">
              <Field label={t('Tu nombre')} id="nombre-nuevo" value={displayName} onChange={setDisplayName} />
            </div>
          )}

          {joinError && (
            <p className="lu-error" role="alert" style={{ marginTop: 'var(--space-4)' }}>
              {joinError}
            </p>
          )}

          <div className="jn-go">
            <Button onClick={join} disabled={joining}>
              {joining ? t('Entrando…') : chosen ? t('Entrar como {nombre}', { nombre: chosen.display_name }) : t('Entrar')}
            </Button>
            <span className="lu-small lu-muted">
              {found.role === 'admin'
                ? t('Entras como admin. Si te equivocas de nombre, quien administra la cuenta lo corrige.')
                : t('Entras como miembro. Si te equivocas de nombre, quien administra la cuenta lo corrige.')}
            </span>
          </div>
        </section>
      )}
    </div>
  );
}

function claimSub(p: InvitationPreview['unclaimed_people'][number], t: T) {
  const numero = p.wa_last4 ? `WhatsApp ••• ${p.wa_last4}` : t('Sin número');
  return p.paid_count ? `${numero} · ${t('pagó {gastos}', { gastos: plural(p.paid_count, t('gasto'), t('gastos')) })}` : numero;
}
