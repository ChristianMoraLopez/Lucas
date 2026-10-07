'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useT } from '@/components/idioma';
import { InviteWhatsapp } from '@/components/invite-whatsapp';
import { Button, CodeInput, Divider, Field, ICONS, Person } from '@/components/lucas-ui';
import { formatDay, isRecent, todayInBogota } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import type { Idioma, T } from '@/lib/i18n';
import { displayLink, inviteHint, inviteLink, inviteMessage, isInviteActive, whatsappUrl } from '@/lib/invite';
import { notifyAccountChanged } from '@/lib/realtime';
import {
  type AccountType,
  asTone,
  type Invitation,
  type NameSource,
  type PersonRow,
  plural,
  ROLE_HELP,
  ROLE_LABEL,
  type Role,
  separarNombres,
  type WhatsappOverview,
} from '@/lib/types';
import { createClient } from '@/utils/supabase/client';
import { AgregarConocidos } from './agregar-conocidos';
import { CambiarNombre } from './cambiar-nombre';
import { QuitarPersona } from './quitar-persona';

type Confirm = { kind: 'leave' } | null;

const ROLE_ORDER: Record<Role, number> = { owner: 0, admin: 1, member: 2 };

/** timestamptz → día en Bogotá ('5 oct'; en inglés 'Oct 5') */
const dayOf = (iso: string, idioma: Idioma) => formatDay(todayInBogota(new Date(iso)), undefined, idioma);

export function MembersScreen({
  accountId,
  accountName,
  accountType,
  closed,
  myRole,
  origin,
}: {
  accountId: string;
  accountName: string;
  accountType: AccountType;
  closed: boolean;
  myRole: Role;
  origin: string;
}) {
  const [supabase] = useState(() => createClient());
  const queryClient = useQueryClient();
  const router = useRouter();
  const t = useT();
  const dia = (iso: string) => dayOf(iso, t.idioma);
  const isAdmin = myRole === 'owner' || myRole === 'admin';

  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [quitar, setQuitar] = useState<PersonRow | null>(null);
  const [oldCode, setOldCode] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);

  const people = useQuery({
    queryKey: ['people', accountId],
    queryFn: async () => {
      const [{ data, error }, fuentes] = await Promise.all([
        supabase.rpc('account_people', { p_account_id: accountId }),
        // De dónde salió cada nombre (si falla, la lista se ve igual)
        supabase.from('people').select('id, name_source').eq('account_id', accountId),
      ]);
      if (error) throw error;
      const origen = new Map((fuentes.data ?? []).map((r) => [r.id as string, r.name_source as NameSource]));
      return (data as PersonRow[]).map((p) => ({ ...p, name_source: p.person_id ? (origen.get(p.person_id) ?? null) : null }));
    },
  });

  const invitations = useQuery({
    queryKey: ['invitations', accountId],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invitations')
        .select('id, code, role, expires_at, max_uses, uses, revoked_at, created_at')
        .eq('account_id', accountId)
        .is('revoked_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as Invitation[]).filter((i) => isInviteActive(i));
    },
  });

  // A quién se agregó desde otra cuenta y todavía no acepta (solo admins)
  const pendientes = useQuery({
    queryKey: ['invitaciones-directas', accountId],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from('account_invites').select('id, person_id').eq('account_id', accountId);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r) => [r.person_id as string, r.id as string]));
    },
  });
  const cancelar = useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase.rpc('cancel_invite', { p_invite_id: inviteId });
      if (error) throw error;
    },
    onMutate: () => setError(null),
    onSuccess: () => refresh(),
    onError: (e) => setError(humanError(e as { message?: string })),
  });

  const rows = people.data ?? [];
  const members = rows
    .filter((p) => p.user_id)
    .sort((a, b) => ROLE_ORDER[a.role as Role] - ROLE_ORDER[b.role as Role] || b.paid_count - a.paid_count || a.display_name.localeCompare(b.display_name));
  const unclaimed = rows.filter((p) => !p.user_id).sort((a, b) => a.display_name.localeCompare(b.display_name));
  const unclaimedIds = unclaimed.map((p) => p.person_id).filter(Boolean) as string[];

  // Número completo de quien solo está en WhatsApp, para escribirle directo (solo admins)
  const phones = useQuery({
    queryKey: ['phones', accountId, unclaimedIds.join()],
    enabled: isAdmin && unclaimedIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('person_whatsapp_ids').select('person_id, wa_id').in('person_id', unclaimedIds);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r) => [r.person_id as string, r.wa_id as string]));
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['people', accountId] });
    queryClient.invalidateQueries({ queryKey: ['invitations', accountId] });
    queryClient.invalidateQueries({ queryKey: ['invitaciones-directas', accountId] });
    queryClient.invalidateQueries({ queryKey: ['conocidos', accountId] });
  };
  const onError = (e: unknown) => setError(humanError(e as { message?: string }));
  const renombrado = () => {
    setEditando(null);
    refresh();
    notifyAccountChanged(accountId);
  };

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: Role }) => {
      const { error } = await supabase.rpc('set_member_role', { p_account_id: accountId, p_user_id: userId, p_role: role });
      if (error) throw error;
    },
    onMutate: () => setError(null),
    onSuccess: refresh,
    onError,
  });

  const leave = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('leave_account', { p_account_id: accountId });
      if (error) throw error;
    },
    onMutate: () => setError(null),
    onSuccess: () => {
      setConfirm(null);
      router.push('/');
      router.refresh();
    },
    onError: (e) => {
      setConfirm(null);
      onError(e);
    },
  });

  // Sacar (deja de ver la cuenta) o eliminar y pasar sus gastos a otra persona
  const quitarMut = useMutation({
    mutationFn: async (q: { persona: PersonRow; a?: string; whatsapp?: boolean }) => {
      const { error } = q.a
        ? await supabase.rpc('delete_person', { p_person_id: q.persona.person_id, p_reassign_to: q.a, p_move_whatsapp: q.whatsapp ?? false })
        : await supabase.rpc('remove_member', { p_account_id: accountId, p_user_id: q.persona.user_id });
      if (error) throw error;
    },
    onMutate: () => setError(null),
    onSuccess: () => {
      setQuitar(null);
      refresh();
      notifyAccountChanged(accountId);
    },
    onError: (e) => {
      setQuitar(null);
      onError(e);
    },
  });

  const current = invitations.data?.[0] ?? null;
  const others = invitations.data?.slice(1) ?? [];
  const link = current ? inviteLink(origin, current.code) : null;
  const admins = members.filter((m) => m.role !== 'member').map((m) => m.display_name);

  // El grupo de WhatsApp conectado (la misma consulta que la barra de arriba)
  const whatsapp = useQuery({
    queryKey: ['whatsapp', accountId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('whatsapp_overview', { p_account_id: accountId });
      if (error) throw error;
      return data as WhatsappOverview;
    },
  });
  const grupo = whatsapp.data?.groups.find((g) => !g.left_at) ?? null;

  // Los que ya usan Luks y tienen la invitación por aceptar no son «solo WhatsApp»
  const porAceptar = unclaimed.filter((p) => p.person_id && pendientes.data?.[p.person_id]).length;
  const soloWhatsapp = unclaimed.length - porAceptar;
  const subtitle = people.isPending
    ? t('Cargando…')
    : unclaimed.length === 0
      ? t('{personas} en la cuenta · todas con usuario en Luks', { personas: plural(rows.length, t('persona'), t('personas')) })
      : [
          t('{n} en la cuenta · {m} con cuenta', { n: rows.length, m: members.length }),
          porAceptar ? t('{n} por aceptar', { n: porAceptar }) : null,
          soloWhatsapp ? t('{n} solo en WhatsApp', { n: soloWhatsapp }) : null,
        ]
          .filter(Boolean)
          .join(', ');

  return (
    <div className="mb">
      <header className="mb-head">
        <div className="mb-head__row">
          <h1 className="lu-display">{t('Personas')}</h1>
          <span className="mb-head__acts">
            {isAdmin && !closed && <InviteWhatsapp accountId={accountId} accountName={accountName} accountType={accountType} />}
            <Link href={`/c/${accountId}/whatsapp`} className="lu-btn lu-btn--sm lu-btn--secondary">
              {t('Conectar WhatsApp')}
            </Link>
          </span>
        </div>
        <span className="lu-small lu-muted">{subtitle}</span>
        {grupo && (
          <p className="mb-sync lu-small" role="note">
            {grupo.members != null
              ? t('Sincronizado con el grupo «{grupo}» ({integrantes}): quien entra al grupo aparece aquí solo.', {
                  grupo: grupo.name ?? 'WhatsApp',
                  integrantes: plural(grupo.members, t('integrante'), t('integrantes')),
                })
              : t('Sincronizado con el grupo «{grupo}»: quien entra al grupo aparece aquí solo.', { grupo: grupo.name ?? 'WhatsApp' })}
          </p>
        )}
      </header>

      <section className="mb-list" aria-label={t('Personas de la cuenta')}>
        {error && (
          <p className="lu-error" role="alert" style={{ marginTop: 0 }}>
            {error}
          </p>
        )}
        {people.isError && (
          <p className="lu-error" role="alert">
            {humanError(people.error)}
          </p>
        )}

        <ul>
          {members.map((p) => (
            <li key={p.user_id} className={editando && editando === p.person_id ? 'mb-editando' : undefined}>
              <Person
                name={p.display_name}
                tone={asTone(p.tone, p.display_name)}
                sub={memberSub(p, t, dia)}
                aside={p.is_me && p.person_id && editando !== p.person_id && <Lapiz label={t('Cambiar mi nombre')} onClick={() => setEditando(p.person_id)} />}
              />
              <RoleControl
                person={p}
                myRole={myRole}
                busy={setRole.isPending}
                onRole={(role) => setRole.mutate({ userId: p.user_id as string, role })}
                onRemove={closed ? undefined : () => setQuitar(p)}
              />
              {p.is_me && p.person_id && editando === p.person_id && (
                <CambiarNombre
                  personId={p.person_id}
                  actual={p.display_name}
                  sinNombre={false}
                  propio
                  onListo={renombrado}
                  onCerrar={() => setEditando(null)}
                />
              )}
            </li>
          ))}
        </ul>

        {unclaimed.length > 0 && (
          <>
            <Divider label={t('Todavía sin cuenta')} />
            <ul>
              {unclaimed.map((p) => {
                const invitacion = p.person_id ? pendientes.data?.[p.person_id] : undefined;
                const sinNombre = p.name_source === 'auto';
                const abierto = editando !== null && editando === p.person_id;
                return (
                  <li key={p.person_id} className={abierto ? 'mb-editando' : undefined}>
                    <Person
                      name={p.display_name}
                      tone={asTone(p.tone, p.display_name)}
                      registered={false}
                      sub={
                        invitacion
                          ? t('Ya usa Luks · le llegó la invitación, falta que acepte')
                          : p.wa_last4
                            ? `${sinNombre ? t('Sin nombre en WhatsApp') : p.name_source === 'whatsapp' ? t('Nombre de WhatsApp') : t('Solo en WhatsApp')} · ••• ${p.wa_last4}`
                            : t('Sin cuenta todavía')
                      }
                      aside={
                        isAdmin &&
                        p.person_id &&
                        !abierto &&
                        !sinNombre && <Lapiz label={t('Cambiar el nombre de {nombre}', { nombre: p.display_name })} onClick={() => setEditando(p.person_id)} />
                      }
                    />
                    {isAdmin && !abierto && (
                      <span className="mb-manage">
                        {p.person_id && sinNombre && (
                          <Button variant="secondary" size="sm" className="mb-poner" onClick={() => setEditando(p.person_id)}>
                            {ICONS.lapiz}
                            {t('Ponerle nombre')}
                          </Button>
                        )}
                        {isAdmin && !closed && (
                          <Button variant="ghost" size="sm" onClick={() => setQuitar(p)}>
                            {t('Quitar…')}
                          </Button>
                        )}
                        {isAdmin && invitacion && (
                          <Button variant="ghost" size="sm" onClick={() => cancelar.mutate(invitacion)} disabled={cancelar.isPending}>
                            {t('Cancelar invitación')}
                          </Button>
                        )}
                        {isAdmin && !invitacion && current && link && (
                          <a
                            className="lu-btn lu-btn--outline lu-btn--sm"
                            href={whatsappUrl(
                              inviteMessage({ accountName, code: current.code, link, name: p.display_name, t }),
                              p.person_id ? phones.data?.[p.person_id] : undefined,
                            )}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t('Invitar')}
                          </a>
                        )}
                      </span>
                    )}
                    {abierto && p.person_id && (
                      <CambiarNombre
                        personId={p.person_id}
                        actual={p.display_name}
                        sinNombre={sinNombre}
                        propio={false}
                        onListo={renombrado}
                        onCerrar={() => setEditando(null)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="lu-small lu-muted" style={{ margin: 'var(--space-3) 0 0' }}>
              {isAdmin
                ? t(
                    'Sus gastos ya cuentan. Se ven con su nombre de WhatsApp o el que les pongas; cuando entren con el código, eligen el suyo y quedan enlazados.',
                  )
                : t('Sus gastos ya cuentan. Se ven con su nombre de WhatsApp; cuando entren con el código, eligen el suyo y quedan enlazados.')}
            </p>
          </>
        )}

        {isAdmin && !closed && <AgregarConocidos accountId={accountId} accountName={accountName} onAdded={refresh} />}
        {isAdmin && !closed && <AddPerson accountId={accountId} onAdded={refresh} onError={onError} />}

        {myRole !== 'owner' && (
          <div className="mb-leave">
            <Button variant="ghost" size="sm" onClick={() => setConfirm({ kind: 'leave' })}>
              {t('Salir de esta cuenta')}
            </Button>
          </div>
        )}
      </section>

      <aside className="mb-inv">
        <h2 className="lu-title">{t('Invitar')}</h2>

        {closed ? (
          <p className="lu-small lu-muted" style={{ margin: 0 }}>
            {t('La cuenta está cerrada: ya no entra nadie más.')}
          </p>
        ) : isAdmin ? (
          <>
            {current && link ? (
              <>
                <CodeInput value={current.code} readOnly label={t('Código de invitación')} hint={inviteHint(current, dia, t)} id="inv" />
                {oldCode && <span className="mb-old">{t('{codigo} ya no sirve', { codigo: oldCode })}</span>}
                <div className="mb-link">{displayLink(link)}</div>
                <InviteButtons accountName={accountName} code={current.code} link={link} />
              </>
            ) : (
              <p className="lu-small lu-muted" style={{ margin: 0 }}>
                {invitations.isPending ? t('Cargando el código…') : t('No hay ningún código activo. Crea uno y compártelo en el grupo.')}
              </p>
            )}

            <NewCodeForm
              accountId={accountId}
              accountType={accountType}
              label={current ? t('Código nuevo') : t('Crear código')}
              replaces={current}
              onCreated={(replaced) => {
                if (replaced) setOldCode(replaced);
                refresh();
              }}
              onError={onError}
            />

            {others.length > 0 && (
              <div className="mb-invs">
                <span className="lu-label">{t('Otros códigos activos')}</span>
                {others.map((inv) => (
                  <RevokeRow key={inv.id} inv={inv} onDone={refresh} onError={onError} />
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="lu-small lu-muted" style={{ margin: 0 }}>
            {admins.length
              ? t('Los códigos los generan quienes administran la cuenta: {admins}. Pídeles uno para invitar a alguien.', {
                  admins: admins.join(t(' o ')),
                })
              : t('Los códigos los generan quienes administran la cuenta. Pídeles uno para invitar a alguien.')}
          </p>
        )}

        <dl className="mb-roles">
          {ROLE_HELP.map(([role, text]) => (
            <div key={role}>
              <dt>
                <span className={`lu-role lu-role--${role}`}>{t(ROLE_LABEL[role])}</span>
              </dt>
              <dd className="lu-small">{t(text)}</dd>
            </div>
          ))}
        </dl>
      </aside>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('¿Salir de esta cuenta?')}
        confirmLabel={t('Salir')}
        busy={leave.isPending}
        onConfirm={() => leave.mutate()}
      >
        {t('Dejas de ver «{cuenta}». Tus gastos siguen contando; si vuelves a entrar con un código, eliges tu nombre otra vez.', { cuenta: accountName })}
      </ConfirmDialog>

      {quitar && (
        <QuitarPersona
          key={quitar.person_id ?? quitar.user_id}
          persona={quitar}
          otras={rows.filter((r) => r.person_id && r.person_id !== quitar.person_id)}
          busy={quitarMut.isPending}
          onClose={() => setQuitar(null)}
          onSacar={() => quitarMut.mutate({ persona: quitar })}
          onEliminar={(a, whatsapp) => quitarMut.mutate({ persona: quitar, a, whatsapp })}
        />
      )}
    </div>
  );
}

/** El lápiz al lado del nombre: cambiarlo ahí mismo */
function Lapiz({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="mb-lapiz" onClick={onClick} aria-label={label} title={label}>
      {ICONS.lapiz}
    </button>
  );
}

function memberSub(p: PersonRow, t: T, dia: (iso: string) => string) {
  if (p.is_me) return p.role === 'owner' ? t('Tú · creaste la cuenta') : t('Tú');
  const parts = [p.paid_count ? plural(p.paid_count, t('gasto'), t('gastos')) : t('Sin gastos todavía')];
  if (p.corrections_count) parts.push(t('corrigió {n}', { n: p.corrections_count }));
  else if (p.joined_at && isRecent(p.joined_at, 14)) parts.push(t('entró el {dia}', { dia: dia(p.joined_at) }));
  return parts.join(' · ');
}

/**
 * Titular: fijo. Quien administra ve el selector de rol con lo que el RPC le
 * permite (un admin nombra admins pero no baja ni quita a otro admin) y el
 * botón «Quitar…» (sacar de la cuenta, o eliminar y pasar sus gastos).
 */
function RoleControl({
  person,
  myRole,
  busy,
  onRole,
  onRemove,
}: {
  person: PersonRow;
  myRole: Role;
  busy: boolean;
  onRole: (role: Role) => void;
  /** undefined: la cuenta está cerrada y ya no se quita a nadie */
  onRemove?: () => void;
}) {
  const t = useT();
  const role = person.role as Role;
  const canManage = !person.is_me && role !== 'owner' && (myRole === 'owner' || (myRole === 'admin' && role === 'member'));
  if (!canManage) return <span className={`lu-role lu-role--${role}`}>{t(ROLE_LABEL[role])}</span>;
  return (
    <span className="mb-manage">
      <select
        className="mb-role"
        aria-label={t('Rol de {nombre}', { nombre: person.display_name })}
        value={role}
        disabled={busy}
        onChange={(e) => onRole(e.target.value as Role)}
      >
        <option value="admin">{t('Admin')}</option>
        <option value="member">{t('Miembro')}</option>
      </select>
      {onRemove && (
        <Button variant="ghost" size="sm" onClick={onRemove} aria-label={t('Quitar a {nombre}', { nombre: person.display_name })}>
          {t('Quitar…')}
        </Button>
      )}
    </span>
  );
}

function InviteButtons({ accountName, code, link }: { accountName: string; code: string; link: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt(t('Copia el link'), link);
    }
  };
  return (
    <div className="mb-btns">
      <Button size="sm" onClick={copy}>
        {copied ? t('¡Copiado!') : t('Copiar link')}
      </Button>
      <a className="lu-btn lu-btn--secondary lu-btn--sm" href={whatsappUrl(inviteMessage({ accountName, code, link, t }))} target="_blank" rel="noreferrer">
        {t('Mandar al grupo')}
      </a>
    </div>
  );
}

const codeSchema = z.object({
  role: z.enum(['member', 'admin']),
  vence: z.enum(['7', '30', '0']),
  usos: z
    .string()
    .trim()
    .regex(/^\d*$/, 'Solo números')
    .refine((v) => v === '' || (Number(v) >= 1 && Number(v) <= 200), 'Entre 1 y 200, o vacío para no poner límite'),
});
type CodeValues = z.infer<typeof codeSchema>;

/** Crea un código con sus opciones. Si ya había uno, lo reemplaza (el viejo deja de servir). */
function NewCodeForm({
  accountId,
  accountType,
  label,
  replaces,
  onCreated,
  onError,
}: {
  accountId: string;
  accountType: AccountType;
  label: string;
  replaces: Invitation | null;
  onCreated: (replacedCode: string | null) => void;
  onError: (e: unknown) => void;
}) {
  const [supabase] = useState(() => createClient());
  const t = useT();
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CodeValues>({
    resolver: zodResolver(codeSchema),
    // Un paseo dura poco: el código vence en 7 días. En el hogar, 30.
    defaultValues: { role: 'member', vence: accountType === 'evento' ? '7' : '30', usos: '' },
  });

  const submit = handleSubmit(async ({ role, vence, usos }) => {
    const expires = vence === '0' ? null : new Date(Date.now() + Number(vence) * 86_400_000).toISOString();
    const { error } = await supabase.rpc('create_invitation', {
      p_account_id: accountId,
      p_role: role,
      p_expires_at: expires,
      p_max_uses: usos === '' ? null : Number(usos),
    });
    if (error) return onError(error);
    if (replaces) {
      const { error: revokeError } = await supabase.rpc('revoke_invitation', { p_invitation_id: replaces.id });
      if (revokeError) return onError(revokeError);
    }
    onCreated(replaces?.code ?? null);
  });

  return (
    <form className="mb-new" onSubmit={submit}>
      <details className="mb-opts">
        <summary>{t('Opciones del código')}</summary>
        <div className="mb-opts__grid">
          <Controller
            control={control}
            name="role"
            render={({ field }) => (
              <Field label={t('Entran como')} id="inv-rol">
                <select id="inv-rol" value={field.value} onChange={field.onChange}>
                  <option value="member">{t('Miembro')}</option>
                  <option value="admin">{t('Admin')}</option>
                </select>
              </Field>
            )}
          />
          <Controller
            control={control}
            name="vence"
            render={({ field }) => (
              <Field label={t('Vence')} id="inv-vence">
                <select id="inv-vence" value={field.value} onChange={field.onChange}>
                  <option value="7">{t('En 7 días')}</option>
                  <option value="30">{t('En 30 días')}</option>
                  <option value="0">{t('No vence')}</option>
                </select>
              </Field>
            )}
          />
          <Controller
            control={control}
            name="usos"
            render={({ field }) => (
              <Field label={t('Máximo de personas')} id="inv-usos" value={field.value} onChange={field.onChange} inputMode="numeric" num />
            )}
          />
        </div>
        {errors.usos && (
          <p className="lu-field-error" role="alert">
            {errors.usos.message && t(errors.usos.message)}
          </p>
        )}
      </details>
      <Button size="sm" variant={replaces ? 'ghost' : 'primary'} type="submit" disabled={isSubmitting}>
        {isSubmitting ? t('Creando…') : label}
      </Button>
    </form>
  );
}

function RevokeRow({ inv, onDone, onError }: { inv: Invitation; onDone: () => void; onError: (e: unknown) => void }) {
  const [supabase] = useState(() => createClient());
  const t = useT();
  const [busy, setBusy] = useState(false);
  const revoke = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('revoke_invitation', { p_invitation_id: inv.id });
    setBusy(false);
    if (error) onError(error);
    else onDone();
  };
  return (
    <div className="mb-inv-row">
      <span>
        <code>{inv.code}</code> <span className="lu-muted">· {inviteHint(inv, (iso) => dayOf(iso, t.idioma), t)}</span>
      </span>
      <Button size="sm" variant="ghost" onClick={revoke} disabled={busy}>
        {t('Anular')}
      </Button>
    </div>
  );
}

/**
 * Agregar a gente sin cuenta: varias de una vez («Mafe, Santi y Caro»). Si ya
 * había gastos divididos entre todos (recibos subidos antes de agregarlas), se
 * pueden volver a dividir incluyéndolas.
 */
function AddPerson({ accountId, onAdded, onError }: { accountId: string; onAdded: () => void; onError: (e: unknown) => void }) {
  const [supabase] = useState(() => createClient());
  const t = useT();
  const [open, setOpen] = useState(false);
  const [texto, setTexto] = useState('');
  const [incluir, setIncluir] = useState(true);
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const nombres = separarNombres(texto);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombres.length) return setAviso(t('Escribe al menos un nombre'));
    if (nombres.some((n) => n.length > 40)) return setAviso(t('Cada nombre puede tener máximo 40 letras'));
    setBusy(true);
    setAviso(null);
    const { data, error } = await supabase.rpc('add_people', { p_account_id: accountId, p_names: nombres, p_include_in_shared: incluir });
    setBusy(false);
    if (error) return onError(error);
    const r = data as { person_ids: string[]; resplit: number };
    setTexto('');
    setOpen(false);
    const mas = plural(r.person_ids.length, t('persona más'), t('personas más'));
    setAviso(
      r.resplit
        ? t('Listo: {personas} y {gastos} otra vez entre todos.', { personas: mas, gastos: plural(r.resplit, t('gasto dividido'), t('gastos divididos')) })
        : t('Listo: {personas}.', { personas: mas }),
    );
    notifyAccountChanged(accountId);
    onAdded();
  };

  if (!open) {
    return (
      <div className="mb-add">
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          {t('Agregar gente sin cuenta')}
        </Button>
        {aviso && (
          <p className="lu-small" role="status" style={{ margin: '6px 0 0' }}>
            {aviso}
          </p>
        )}
      </div>
    );
  }
  return (
    <form className="mb-add mb-add--open" onSubmit={submit}>
      <div className="lu-field">
        <label className="lu-label" htmlFor="personas-nuevas">
          {t('Nombres')}
        </label>
        <input
          id="personas-nuevas"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={t('Mafe, Santi y Caro')}
          autoComplete="off"
          aria-describedby="personas-nuevas-ayuda"
        />
        <span className="lu-small lu-muted" id="personas-nuevas-ayuda">
          {nombres.length > 1 ? t('Vas a agregar a {nombres}.', { nombres: nombres.join(', ') }) : t('Separa con comas para agregar a varias de una vez.')}
        </span>
      </div>
      <label className="qp-check">
        <input type="checkbox" checked={incluir} onChange={(e) => setIncluir(e.target.checked)} />
        <span className="lu-small">
          {nombres.length > 1
            ? t('Dividir con ellos los gastos que ya estaban entre todos (si subiste los recibos antes)')
            : t('Dividir con esa persona los gastos que ya estaban entre todos (si subiste los recibos antes)')}
        </span>
      </label>
      {aviso && (
        <p className="lu-field-error" role="alert">
          {aviso}
        </p>
      )}
      <div className="mb-btns">
        <Button size="sm" variant="secondary" type="submit" disabled={busy}>
          {busy ? t('Agregando…') : nombres.length > 1 ? t('Agregar a {n}', { n: nombres.length }) : t('Agregar')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t('Cancelar')}
        </Button>
      </div>
    </form>
  );
}
