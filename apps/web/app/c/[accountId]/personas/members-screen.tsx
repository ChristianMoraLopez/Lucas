'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button, CodeInput, Divider, Field, Person } from '@/components/lucas-ui';
import { formatDay, isRecent, todayInBogota } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { displayLink, inviteHint, inviteLink, inviteMessage, isInviteActive, whatsappUrl } from '@/lib/invite';
import { type AccountType, asTone, type Invitation, type PersonRow, plural, ROLE_HELP, ROLE_LABEL, type Role } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

type Confirm = { kind: 'remove'; userId: string; name: string } | { kind: 'leave' } | null;

const ROLE_ORDER: Record<Role, number> = { owner: 0, admin: 1, member: 2 };

/** timestamptz → día en Bogotá ('5 oct') */
const dayOf = (iso: string) => formatDay(todayInBogota(new Date(iso)));

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
  const isAdmin = myRole === 'owner' || myRole === 'admin';

  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [oldCode, setOldCode] = useState<string | null>(null);

  const people = useQuery({
    queryKey: ['people', accountId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('account_people', { p_account_id: accountId });
      if (error) throw error;
      return data as PersonRow[];
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
  };
  const onError = (e: unknown) => setError(humanError(e as { message?: string }));

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: Role }) => {
      const { error } = await supabase.rpc('set_member_role', { p_account_id: accountId, p_user_id: userId, p_role: role });
      if (error) throw error;
    },
    onMutate: () => setError(null),
    onSuccess: refresh,
    onError,
  });

  const removeOrLeave = useMutation({
    mutationFn: async (c: NonNullable<Confirm>) => {
      const { error } =
        c.kind === 'remove'
          ? await supabase.rpc('remove_member', { p_account_id: accountId, p_user_id: c.userId })
          : await supabase.rpc('leave_account', { p_account_id: accountId });
      if (error) throw error;
      return c.kind;
    },
    onMutate: () => setError(null),
    onSuccess: (kind) => {
      setConfirm(null);
      if (kind === 'leave') {
        router.push('/');
        router.refresh();
      } else refresh();
    },
    onError: (e) => {
      setConfirm(null);
      onError(e);
    },
  });

  const current = invitations.data?.[0] ?? null;
  const others = invitations.data?.slice(1) ?? [];
  const link = current ? inviteLink(origin, current.code) : null;
  const admins = members.filter((m) => m.role !== 'member').map((m) => m.display_name);

  const subtitle = people.isPending
    ? 'Cargando…'
    : unclaimed.length === 0
      ? `${plural(rows.length, 'persona', 'personas')} en la cuenta · todas con usuario en Lucas`
      : `${rows.length} en la cuenta · ${members.length} con cuenta y ${unclaimed.length} solo en WhatsApp`;

  return (
    <div className="mb">
      <header className="mb-head">
        <h1 className="lu-display">Personas</h1>
        <span className="lu-small lu-muted">{subtitle}</span>
      </header>

      <section className="mb-list" aria-label="Personas de la cuenta">
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
            <li key={p.user_id}>
              <Person name={p.display_name} tone={asTone(p.tone, p.display_name)} sub={memberSub(p)} />
              <RoleControl
                person={p}
                myRole={myRole}
                busy={setRole.isPending}
                onRole={(role) => setRole.mutate({ userId: p.user_id as string, role })}
                onRemove={() => setConfirm({ kind: 'remove', userId: p.user_id as string, name: p.display_name })}
              />
            </li>
          ))}
        </ul>

        {unclaimed.length > 0 && (
          <>
            <Divider label="Todavía sin cuenta" />
            <ul>
              {unclaimed.map((p) => (
                <li key={p.person_id}>
                  <Person
                    name={p.display_name}
                    tone={asTone(p.tone, p.display_name)}
                    registered={false}
                    sub={p.wa_last4 ? `Solo en WhatsApp · +57 ••• ${p.wa_last4}` : 'Sin cuenta todavía'}
                  />
                  {isAdmin && current && link && (
                    <a
                      className="lu-btn lu-btn--outline lu-btn--sm"
                      href={whatsappUrl(
                        inviteMessage({ accountName, code: current.code, link, name: p.display_name }),
                        p.person_id ? phones.data?.[p.person_id] : undefined,
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Invitar
                    </a>
                  )}
                </li>
              ))}
            </ul>
            <p className="lu-small lu-muted" style={{ margin: 'var(--space-3) 0 0' }}>
              Sus gastos ya cuentan. Cuando entren con el código, eligen su nombre y quedan enlazados.
            </p>
          </>
        )}

        {isAdmin && !closed && <AddPerson accountId={accountId} onAdded={refresh} onError={onError} />}

        {myRole !== 'owner' && (
          <div className="mb-leave">
            <Button variant="ghost" size="sm" onClick={() => setConfirm({ kind: 'leave' })}>
              Salir de esta cuenta
            </Button>
          </div>
        )}
      </section>

      <aside className="mb-inv">
        <h2 className="lu-title">Invitar</h2>

        {closed ? (
          <p className="lu-small lu-muted" style={{ margin: 0 }}>
            La cuenta está cerrada: ya no entra nadie más.
          </p>
        ) : isAdmin ? (
          <>
            {current && link ? (
              <>
                <CodeInput value={current.code} readOnly label="Código de invitación" hint={inviteHint(current, dayOf)} id="inv" />
                {oldCode && <span className="mb-old">{oldCode} ya no sirve</span>}
                <div className="mb-link">{displayLink(link)}</div>
                <InviteButtons accountName={accountName} code={current.code} link={link} />
              </>
            ) : (
              <p className="lu-small lu-muted" style={{ margin: 0 }}>
                {invitations.isPending ? 'Cargando el código…' : 'No hay ningún código activo. Crea uno y compártelo en el grupo.'}
              </p>
            )}

            <NewCodeForm
              accountId={accountId}
              accountType={accountType}
              label={current ? 'Código nuevo' : 'Crear código'}
              replaces={current}
              onCreated={(replaced) => {
                if (replaced) setOldCode(replaced);
                refresh();
              }}
              onError={onError}
            />

            {others.length > 0 && (
              <div className="mb-invs">
                <span className="lu-label">Otros códigos activos</span>
                {others.map((inv) => (
                  <RevokeRow key={inv.id} inv={inv} onDone={refresh} onError={onError} />
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="lu-small lu-muted" style={{ margin: 0 }}>
            Los códigos los generan quienes administran la cuenta{admins.length ? `: ${admins.join(' o ')}` : ''}. Pídeles uno para invitar a alguien.
          </p>
        )}

        <dl className="mb-roles">
          {ROLE_HELP.map(([role, text]) => (
            <div key={role}>
              <dt>
                <span className={`lu-role lu-role--${role}`}>{ROLE_LABEL[role]}</span>
              </dt>
              <dd className="lu-small">{text}</dd>
            </div>
          ))}
        </dl>
      </aside>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm?.kind === 'remove' ? `¿Sacar a ${confirm.name}?` : '¿Salir de esta cuenta?'}
        confirmLabel={confirm?.kind === 'remove' ? 'Sacar' : 'Salir'}
        busy={removeOrLeave.isPending}
        onConfirm={() => confirm && removeOrLeave.mutate(confirm)}
      >
        {confirm?.kind === 'remove'
          ? `Deja de ver la cuenta. Sus gastos siguen contando y su nombre queda «sin cuenta», por si vuelve a entrar con un código.`
          : `Dejas de ver «${accountName}». Tus gastos siguen contando; si vuelves a entrar con un código, eliges tu nombre otra vez.`}
      </ConfirmDialog>
    </div>
  );
}

function memberSub(p: PersonRow) {
  if (p.is_me) return p.role === 'owner' ? 'Tú · creaste la cuenta' : 'Tú';
  const parts = [p.paid_count ? plural(p.paid_count, 'gasto', 'gastos') : 'Sin gastos todavía'];
  if (p.corrections_count) parts.push(`corrigió ${p.corrections_count}`);
  else if (p.joined_at && isRecent(p.joined_at, 14)) parts.push(`entró el ${dayOf(p.joined_at)}`);
  return parts.join(' · ');
}

/**
 * Titular: fijo. Quien administra ve un selector con las opciones que el RPC
 * le permite (un admin nombra admins pero no baja ni saca a otro admin).
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
  onRemove: () => void;
}) {
  const role = person.role as Role;
  const canManage = !person.is_me && role !== 'owner' && (myRole === 'owner' || (myRole === 'admin' && role === 'member'));
  if (!canManage) return <span className={`lu-role lu-role--${role}`}>{ROLE_LABEL[role]}</span>;
  return (
    <select
      className="mb-role"
      aria-label={`Rol de ${person.display_name}`}
      value={role}
      disabled={busy}
      onChange={(e) => (e.target.value === 'sacar' ? onRemove() : onRole(e.target.value as Role))}
    >
      <option value="admin">Admin</option>
      <option value="member">Miembro</option>
      <option value="sacar">Sacar de la cuenta…</option>
    </select>
  );
}

function InviteButtons({ accountName, code, link }: { accountName: string; code: string; link: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copia el link', link);
    }
  };
  return (
    <div className="mb-btns">
      <Button size="sm" onClick={copy}>
        {copied ? '¡Copiado!' : 'Copiar link'}
      </Button>
      <a className="lu-btn lu-btn--secondary lu-btn--sm" href={whatsappUrl(inviteMessage({ accountName, code, link }))} target="_blank" rel="noreferrer">
        Mandar al grupo
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
        <summary>Opciones del código</summary>
        <div className="mb-opts__grid">
          <Controller
            control={control}
            name="role"
            render={({ field }) => (
              <Field label="Entran como" id="inv-rol">
                <select id="inv-rol" value={field.value} onChange={field.onChange}>
                  <option value="member">Miembro</option>
                  <option value="admin">Admin</option>
                </select>
              </Field>
            )}
          />
          <Controller
            control={control}
            name="vence"
            render={({ field }) => (
              <Field label="Vence" id="inv-vence">
                <select id="inv-vence" value={field.value} onChange={field.onChange}>
                  <option value="7">En 7 días</option>
                  <option value="30">En 30 días</option>
                  <option value="0">No vence</option>
                </select>
              </Field>
            )}
          />
          <Controller
            control={control}
            name="usos"
            render={({ field }) => <Field label="Máximo de personas" id="inv-usos" value={field.value} onChange={field.onChange} inputMode="numeric" num />}
          />
        </div>
        {errors.usos && (
          <p className="lu-field-error" role="alert">
            {errors.usos.message}
          </p>
        )}
      </details>
      <Button size="sm" variant={replaces ? 'ghost' : 'primary'} type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Creando…' : label}
      </Button>
    </form>
  );
}

function RevokeRow({ inv, onDone, onError }: { inv: Invitation; onDone: () => void; onError: (e: unknown) => void }) {
  const [supabase] = useState(() => createClient());
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
        <code>{inv.code}</code> <span className="lu-muted">· {inviteHint(inv, dayOf)}</span>
      </span>
      <Button size="sm" variant="ghost" onClick={revoke} disabled={busy}>
        Anular
      </Button>
    </div>
  );
}

const personSchema = z.object({
  name: z.string().trim().min(1, 'Escribe el nombre').max(40, 'Máximo 40 letras'),
});

/** Agregar a alguien que todavía no tiene cuenta (solo WhatsApp). El tono lo pone la base. */
function AddPerson({ accountId, onAdded, onError }: { accountId: string; onAdded: () => void; onError: (e: unknown) => void }) {
  const [supabase] = useState(() => createClient());
  const [open, setOpen] = useState(false);
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<{ name: string }>({ resolver: zodResolver(personSchema), defaultValues: { name: '' } });

  const submit = handleSubmit(async ({ name }) => {
    const { error } = await supabase.from('people').insert({ account_id: accountId, display_name: name });
    if (error) return onError(error);
    reset();
    setOpen(false);
    onAdded();
  });

  if (!open) {
    return (
      <div className="mb-add">
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          Agregar a alguien sin cuenta
        </Button>
      </div>
    );
  }
  return (
    <form className="mb-add mb-add--open" onSubmit={submit}>
      <Controller
        control={control}
        name="name"
        render={({ field }) => <Field label="Nombre" id="persona-nueva" value={field.value} onChange={field.onChange} />}
      />
      {errors.name && (
        <p className="lu-field-error" role="alert">
          {errors.name.message}
        </p>
      )}
      <div className="mb-btns">
        <Button size="sm" variant="secondary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Agregando…' : 'Agregar'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
