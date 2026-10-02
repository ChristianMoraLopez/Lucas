'use client';

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useId, useState } from 'react';
import { Avatar, Button } from '@/components/lucas-ui';
import { ThemeToggle } from '@/components/theme-toggle';
import { formatDay, formatWhen } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { asTone, formatWaNumber, type MyProfile, plural, ROLE_LABEL } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

const PROVEEDOR: Record<string, string> = { email: 'Correo (contraseña o enlace)', google: 'Google' };

/**
 * Perfil: lo que se puede cambiar (el nombre, cómo te llaman en cada cuenta,
 * tus números de WhatsApp), lo que solo se ve (correo, con qué entras,
 * fechas, la política de datos) y tus datos: descargarlos o borrar la cuenta.
 */
export function ProfileScreen({ p }: { p: MyProfile }) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const nombre = p.full_name?.trim() || p.email?.split('@')[0] || 'Tú';
  const conCorreo = p.providers.includes('email');

  return (
    <div className="pf">
      <header className="pf-head">
        <Avatar name={nombre} size="md" />
        <div>
          <h1 className="lu-display">Tu perfil</h1>
          <span className="lu-small lu-muted">{p.email}</span>
        </div>
      </header>

      <section className="pf-card" aria-labelledby="pf-nombre">
        <h2 id="pf-nombre" className="lu-title">
          Tu nombre
        </h2>
        <Nombre actual={p.full_name ?? ''} onSaved={refresh} />
      </section>

      {p.accounts.some((a) => a.person_id) && (
        <section className="pf-card" aria-labelledby="pf-cuentas">
          <h2 id="pf-cuentas" className="lu-title">
            Cómo te llaman en cada cuenta
          </h2>
          <p className="lu-small lu-muted pf-nota">Es el nombre que ven los demás en los gastos y en Liquidar.</p>
          <ul className="pf-list">
            {p.accounts
              .filter((a) => a.person_id)
              .map((a) => (
                <NombreEnCuenta key={a.id} cuenta={a} onSaved={refresh} />
              ))}
          </ul>
        </section>
      )}

      <section className="pf-card" aria-labelledby="pf-wa">
        <h2 id="pf-wa" className="lu-title">
          Tu WhatsApp
        </h2>
        <p className="lu-small lu-muted pf-nota">Con tu número, los gastos que mandas a los grupos quedan a tu nombre en todas tus cuentas.</p>
        <Whatsapp numeros={p.whatsapp} onChanged={refresh} />
      </section>

      <section className="pf-card" aria-labelledby="pf-cuenta">
        <h2 id="pf-cuenta" className="lu-title">
          Tu cuenta de Luks
        </h2>
        <dl className="gd-facts pf-facts">
          <div>
            <dt>Correo</dt>
            <dd>{p.email ?? '—'}</dd>
          </div>
          <div>
            <dt>Entras con</dt>
            <dd>{p.providers.length ? p.providers.map((x) => PROVEEDOR[x] ?? x).join(' · ') : '—'}</dd>
          </div>
          <div>
            <dt>Creaste tu cuenta</dt>
            <dd>{formatDay(new Date(p.created_at))}</dd>
          </div>
          {p.last_sign_in_at && (
            <div>
              <dt>Última vez que entraste</dt>
              <dd>{formatWhen(p.last_sign_in_at)}</dd>
            </div>
          )}
          <div>
            <dt>Política de datos</dt>
            <dd>
              {p.privacy_accepted_at
                ? `Aceptada el ${formatDay(new Date(p.privacy_accepted_at))}${p.privacy_version ? ` (versión ${p.privacy_version})` : ''}`
                : 'Sin aceptar'}
            </dd>
          </div>
          <div>
            <dt>Cuentas</dt>
            <dd>{p.accounts.length ? p.accounts.map((a) => `${a.name} (${ROLE_LABEL[a.role].toLowerCase()})`).join(', ') : 'Ninguna todavía'}</dd>
          </div>
        </dl>
        <div className="pf-acts">
          {conCorreo && (
            <Link href="/cuenta/clave" className="lu-btn lu-btn--sm lu-btn--secondary">
              Cambiar contraseña
            </Link>
          )}
          <span className="pf-tema">
            <span className="lu-small">Tema</span>
            <ThemeToggle />
          </span>
        </div>
      </section>

      <section className="pf-card pf-card--datos" aria-labelledby="pf-datos">
        <h2 id="pf-datos" className="lu-title">
          Tus datos
        </h2>
        <p className="lu-small lu-muted pf-nota">
          Puedes descargar todo lo tuyo (perfil, gastos que pagaste, tu parte de cada gasto y tus mensajes) o borrar tu cuenta cuando quieras.
        </p>
        <MisDatos p={p} />
      </section>
    </div>
  );
}

function Nombre({ actual, onSaved }: { actual: string; onSaved: () => void }) {
  const [supabase] = useState(() => createClient());
  const [v, setV] = useState(actual);
  const [estado, setEstado] = useState<{ busy?: boolean; error?: string; ok?: boolean }>({});
  const id = useId();
  const cambio = v.trim() !== actual.trim();

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    if (!cambio) return;
    setEstado({ busy: true });
    const { error } = await supabase.rpc('update_my_name', { p_full_name: v });
    if (error) return setEstado({ error: humanError(error) });
    setEstado({ ok: true });
    onSaved();
  };

  return (
    <form className="pf-row" onSubmit={guardar}>
      <label htmlFor={id} className="lu-sr">
        Tu nombre
      </label>
      <input
        id={id}
        className="pf-input"
        value={v}
        onChange={(e) => {
          setV(e.target.value);
          setEstado({});
        }}
        maxLength={80}
        autoComplete="name"
      />
      <Button size="sm" type="submit" disabled={!cambio || estado.busy}>
        {estado.busy ? 'Guardando…' : 'Guardar'}
      </Button>
      {estado.error && (
        <p className="lu-error pf-msg" role="alert">
          {estado.error}
        </p>
      )}
      {estado.ok && (
        <p className="lu-success pf-msg" role="status">
          Listo, así te vamos a saludar.
        </p>
      )}
    </form>
  );
}

function NombreEnCuenta({ cuenta, onSaved }: { cuenta: MyProfile['accounts'][number]; onSaved: () => void }) {
  const [supabase] = useState(() => createClient());
  const actual = cuenta.person_name ?? '';
  const [v, setV] = useState(actual);
  const [estado, setEstado] = useState<{ busy?: boolean; error?: string }>({});
  const id = useId();
  const cambio = v.trim() !== actual.trim();

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    if (!cambio) return;
    setEstado({ busy: true });
    const { error } = await supabase.rpc('update_my_person_name', { p_person_id: cuenta.person_id, p_name: v });
    if (error) return setEstado({ error: humanError(error) });
    setEstado({});
    onSaved();
  };

  return (
    <li>
      <form className="pf-row" onSubmit={guardar}>
        <label htmlFor={id} className="pf-cuenta">
          <Avatar name={actual || cuenta.name} tone={asTone(cuenta.person_tone, actual)} size="sm" />
          <span>
            <b>{cuenta.name}</b>
            <span className="lu-small lu-muted"> · {ROLE_LABEL[cuenta.role]}</span>
          </span>
        </label>
        <input
          id={id}
          className="pf-input"
          value={v}
          onChange={(e) => {
            setV(e.target.value);
            setEstado({});
          }}
          maxLength={40}
        />
        <Button size="sm" variant="secondary" type="submit" disabled={!cambio || estado.busy}>
          {estado.busy ? '…' : 'Guardar'}
        </Button>
        {estado.error && (
          <p className="lu-error pf-msg" role="alert">
            {estado.error}
          </p>
        )}
      </form>
    </li>
  );
}

function Whatsapp({ numeros, onChanged }: { numeros: string[]; onChanged: () => void }) {
  const [supabase] = useState(() => createClient());
  const [v, setV] = useState('');
  const [estado, setEstado] = useState<{ busy?: string; error?: string; aviso?: string }>({});
  const id = useId();

  const agregar = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.trim()) return;
    setEstado({ busy: 'agregar' });
    const { data, error } = await supabase.rpc('add_my_whatsapp', { p_phone: v });
    if (error) return setEstado({ error: humanError(error) });
    const r = data as { wa_id: string; accounts: number; taken_in: string[] };
    setV('');
    setEstado({
      aviso: r.taken_in.length
        ? `En ${r.taken_in.join(', ')} ese número ya es de otra persona: pídele a quien administra que lo arregle en «Conectar WhatsApp».`
        : r.accounts
          ? `Listo: quedó en ${plural(r.accounts, 'cuenta', 'cuentas')}.`
          : undefined,
    });
    onChanged();
  };

  const quitar = async (wa: string) => {
    setEstado({ busy: wa });
    const { error } = await supabase.rpc('remove_my_whatsapp', { p_wa_id: wa });
    if (error) return setEstado({ error: humanError(error) });
    setEstado({});
    onChanged();
  };

  return (
    <>
      {numeros.length > 0 && (
        <ul className="pf-list">
          {numeros.map((n) => (
            <li key={n} className="pf-row">
              <span className="pf-num">{formatWaNumber(n) ?? n}</span>
              <Button size="sm" variant="ghost" onClick={() => quitar(n)} disabled={estado.busy === n}>
                Quitar
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form className="pf-row" onSubmit={agregar}>
        <label htmlFor={id} className="lu-sr">
          Número de WhatsApp
        </label>
        <input
          id={id}
          className="pf-input"
          value={v}
          onChange={(e) => setV(e.target.value)}
          inputMode="tel"
          autoComplete="tel"
          placeholder={numeros.length ? 'Otro número: 300 123 4567' : '300 123 4567'}
        />
        <Button size="sm" variant="secondary" type="submit" disabled={!v.trim() || estado.busy === 'agregar'}>
          {estado.busy === 'agregar' ? 'Agregando…' : 'Agregar'}
        </Button>
      </form>
      {estado.error && (
        <p className="lu-error pf-msg" role="alert">
          {estado.error}
        </p>
      )}
      {estado.aviso && (
        <p className="lu-small pf-msg" role="status">
          {estado.aviso}
        </p>
      )}
    </>
  );
}

const PALABRA = 'ELIMINAR';

function MisDatos({ p }: { p: MyProfile }) {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const [bajando, setBajando] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [anonimizar, setAnonimizar] = useState(true);
  const [palabra, setPalabra] = useState('');
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titular = p.accounts.filter((a) => a.role === 'owner').map((a) => a.name);
  const id = useId();

  const descargar = async () => {
    setBajando(true);
    setError(null);
    const { data, error } = await supabase.rpc('my_data_export');
    setBajando(false);
    if (error) return setError(humanError(error));
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `luks-mis-datos-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const borrar = async () => {
    setBorrando(true);
    setError(null);
    const { error } = await supabase.rpc('delete_my_account', { p_anonimizar: anonimizar });
    if (error) {
      setBorrando(false);
      return setError(humanError(error));
    }
    await supabase.auth.signOut();
    router.replace('/login?eliminada=1');
    router.refresh();
  };

  return (
    <>
      <div className="pf-acts">
        <Button size="sm" variant="secondary" onClick={descargar} disabled={bajando}>
          {bajando ? 'Preparando…' : 'Descargar mis datos'}
        </Button>
        <Button size="sm" variant="secondary" className="lu-btn--danger" onClick={() => setAbierto(true)}>
          Eliminar mi cuenta
        </Button>
      </div>
      {error && (
        <p className="lu-error pf-msg" role="alert">
          {error}
        </p>
      )}

      <AlertDialog.Root open={abierto} onOpenChange={(o) => !borrando && setAbierto(o)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="lu-dialog__overlay" />
          <AlertDialog.Content className="lu-dialog qp">
            <AlertDialog.Title className="lu-title">¿Eliminar tu cuenta?</AlertDialog.Title>
            <AlertDialog.Description asChild>
              <ul className="pf-consecuencias lu-small">
                <li>Se borran tu usuario, tu perfil y tus números de WhatsApp. No se puede deshacer.</li>
                {titular.length > 0 && (
                  <li>
                    {titular.length === 1
                      ? `«${titular[0]}» pasa`
                      : `${titular
                          .slice(0, -1)
                          .map((t) => `«${t}»`)
                          .join(', ')} y «${titular[titular.length - 1]}» pasan`}{' '}
                    a un admin o a quien lleve más tiempo; si no hay nadie más, se borra con sus gastos.
                  </li>
                )}
                <li>En las cuentas que siguen, tus gastos se quedan para que a los demás les cuadren las cuentas.</li>
              </ul>
            </AlertDialog.Description>
            <label className="qp-check">
              <input type="checkbox" checked={anonimizar} onChange={(e) => setAnonimizar(e.target.checked)} />
              <span className="lu-small">Que en esas cuentas mi nombre pase a «Persona eliminada»</span>
            </label>
            <div className="qp-a">
              <label htmlFor={id} className="lu-label">
                Escribe {PALABRA} para confirmar
              </label>
              <input id={id} className="pf-input" value={palabra} onChange={(e) => setPalabra(e.target.value)} autoComplete="off" autoCapitalize="characters" />
            </div>
            <div className="lu-dialog__btns">
              <AlertDialog.Cancel asChild>
                <Button variant="secondary" size="sm" disabled={borrando}>
                  Cancelar
                </Button>
              </AlertDialog.Cancel>
              <Button
                size="sm"
                variant="secondary"
                className="lu-btn--danger"
                disabled={borrando || palabra.trim().toUpperCase() !== PALABRA}
                onClick={(e) => {
                  e.preventDefault();
                  borrar();
                }}
              >
                {borrando ? 'Eliminando…' : 'Eliminar mi cuenta'}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
