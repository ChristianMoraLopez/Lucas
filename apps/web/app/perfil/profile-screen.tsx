'use client';

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { lanzarChispas } from '@/components/chispas';
import { olvidarGuias } from '@/components/guia';
import { Avatar, Button, LottieSlot } from '@/components/lucas-ui';
import { ThemeToggle } from '@/components/theme-toggle';
import { formatDay, formatWhen, monthName, todayInBogota } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { accountGlyph, accountTone, formatWaNumber, type MyProfile, plural, ROLE_LABEL } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

const PROVEEDOR: Record<string, string> = { email: 'Correo', google: 'Google' };

/** Chispas en el centro del botón que envió el formulario (cuando quedó guardado). */
function chispasEn(boton: Element | null) {
  if (!boton) return;
  const r = boton.getBoundingClientRect();
  lanzarChispas({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, currentTarget: null });
}

/* Íconos de trazo de 2px, redondeados, de 24px (como ICONS del kit) */
const ICONO = {
  nombre: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.6-4 4.6-6 8-6s6.4 2 8 6" />
    </>
  ),
  cuentas: (
    <>
      <path d="M3 12V4h8l10 10-8 8z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </>
  ),
  whatsapp: <path d="M4 20l1.4-4.2A8 8 0 1 1 8.6 19z" />,
  guia: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.4M12 17h.01" />
    </>
  ),
  datos: (
    <>
      <path d="M12 3l8 3v6c0 4.4-3.4 8-8 9-4.6-1-8-4.6-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  bajar: (
    <>
      <path d="M12 4v11M7 10l5 5 5-5" />
      <path d="M5 20h14" />
    </>
  ),
  borrar: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
    </>
  ),
} satisfies Record<string, ReactNode>;

function Icono({ d, className }: { d: keyof typeof ICONO; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      {ICONO[d]}
    </svg>
  );
}

/** Tarjeta de sección con su ícono de color */
function Seccion({
  id,
  icono,
  tono,
  titulo,
  nota,
  i,
  children,
}: {
  id: string;
  icono: keyof typeof ICONO;
  tono: string;
  titulo: string;
  nota?: string;
  i: number;
  children: ReactNode;
}) {
  return (
    <section className="pf-card" aria-labelledby={id} style={{ '--i': i } as React.CSSProperties}>
      <div className="pf-card__head">
        <span className={`pf-ico pf-ico--${tono}`}>
          <Icono d={icono} />
        </span>
        <div>
          <h2 id={id} className="lu-title">
            {titulo}
          </h2>
          {nota && <p className="lu-small lu-muted pf-nota">{nota}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * Perfil: el carné con lo que solo se ve (correo, con qué entras, fechas,
 * política de datos, cuentas), lo que se puede cambiar (nombre, cómo te
 * llaman en cada cuenta, tus números de WhatsApp) y tus datos: descargarlos o
 * borrar la cuenta.
 */
export function ProfileScreen({ p: completo, archivadas = [] }: { p: MyProfile; archivadas?: string[] }) {
  const router = useRouter();
  const refresh = () => router.refresh();
  // Las cuentas archivadas ya pasaron: no salen en el carné ni en «cómo te llaman»
  const p = { ...completo, accounts: completo.accounts.filter((a) => !archivadas.includes(a.id)) };
  const conCuentas = p.accounts.filter((a) => a.person_id);

  return (
    <div className="pf lu-stagger">
      <header className="pf-head" style={{ '--i': 0 } as React.CSSProperties}>
        <h1 className="lu-display">Tu perfil</h1>
        <p className="lu-small lu-muted" style={{ margin: 0 }}>
          Lo tuyo en Luks: cámbialo, descárgalo o bórralo cuando quieras.
        </p>
      </header>

      <Carne p={p} />

      <Seccion id="pf-nombre" icono="nombre" tono="morado" titulo="Tu nombre" nota="Así te saludamos y es el que sale cuando creas una cuenta." i={2}>
        <Nombre actual={p.full_name ?? ''} onSaved={refresh} />
      </Seccion>

      {conCuentas.length > 0 && (
        <Seccion
          id="pf-cuentas"
          icono="cuentas"
          tono="naranja"
          titulo="Cómo te llaman en cada cuenta"
          nota="Es el nombre que ven los demás en los gastos y en Liquidar."
          i={3}
        >
          <ul className="pf-list">
            {conCuentas.map((a) => (
              <NombreEnCuenta key={a.id} cuenta={a} onSaved={refresh} />
            ))}
          </ul>
        </Seccion>
      )}

      <Seccion
        id="pf-wa"
        icono="whatsapp"
        tono="verde"
        titulo="Tu WhatsApp"
        nota="Con tu número, los gastos que mandas a los grupos quedan a tu nombre en todas tus cuentas."
        i={4}
      >
        <Whatsapp numeros={p.whatsapp} onChanged={refresh} />
      </Seccion>

      <Seccion
        id="pf-guia"
        icono="guia"
        tono="azul"
        titulo="La guía"
        nota="Te muestra Luks paso a paso. Sale sola la primera vez; después, con el «?» de arriba."
        i={5}
      >
        <VerGuias usuario={p.id} />
      </Seccion>

      <Seccion id="pf-datos" icono="datos" tono="coral" titulo="Tus datos" nota="Son tuyos: llévatelos o bórralos (Ley 1581)." i={6}>
        {/* Borrar tu usuario también toca las archivadas: ahí van todas */}
        <MisDatos p={completo} />
      </Seccion>
    </div>
  );
}

/** El carné: lo que solo se ve, con el lenguaje de la tarjeta billete del kit. */
function Carne({ p }: { p: MyProfile }) {
  const nombre = p.full_name?.trim() || p.email?.split('@')[0] || 'Tú';
  const desde = new Date(p.created_at);
  const desdeMes = `${monthName(desde).slice(0, 3).toUpperCase()} ${todayInBogota(desde).slice(0, 4)}`;
  return (
    <section className="lu-bill lu-bill--morado pf-carne" aria-labelledby="pf-carne-t" style={{ '--i': 1 } as React.CSSProperties}>
      <div className="lu-bill__top">
        <span id="pf-carne-t" className="lu-bill__label">
          Tu cuenta de Luks
        </span>
        <span className="lu-bill__denom">DESDE {desdeMes}</span>
      </div>

      <div className="pf-carne__id">
        <span className="pf-carne__avatar">
          <Avatar name={nombre} size="md" />
        </span>
        <span className="pf-carne__nombre">
          <b>{nombre}</b>
          <span className="pf-carne__mail">{p.email}</span>
        </span>
      </div>

      {p.providers.length > 0 && (
        <ul className="pf-carne__chips" aria-label="Entras con">
          {p.providers.map((x) => (
            <li key={x} className="pf-carne__chip">
              Entras con {PROVEEDOR[x] ?? x}
            </li>
          ))}
        </ul>
      )}

      <dl className="pf-carne__facts">
        <div>
          <dt>Creaste tu cuenta</dt>
          <dd>{formatDay(desde, '0000-01-01')}</dd>
        </div>
        {p.last_sign_in_at && (
          <div>
            <dt>Última entrada</dt>
            <dd>{formatWhen(p.last_sign_in_at)}</dd>
          </div>
        )}
        <div>
          <dt>Política de datos</dt>
          <dd>
            {p.privacy_accepted_at
              ? `Aceptada el ${formatDay(new Date(p.privacy_accepted_at))}${p.privacy_version ? ` · v${p.privacy_version}` : ''}`
              : 'Sin aceptar'}
          </dd>
        </div>
        <div>
          <dt>Cuentas</dt>
          <dd>{p.accounts.length ? plural(p.accounts.length, 'cuenta', 'cuentas') : 'Ninguna todavía'}</dd>
        </div>
      </dl>

      {p.accounts.length > 0 && (
        <ul className="pf-carne__cuentas" aria-label="Tus cuentas">
          {p.accounts.map((a) => (
            <li key={a.id} className="pf-carne__cuenta">
              <span className="pf-carne__glyph" style={{ background: `var(--tono-${accountTone(a.name)})` }} aria-hidden="true">
                {accountGlyph(a.name)}
              </span>
              {a.name}
              <span className="pf-carne__rol">{ROLE_LABEL[a.role]}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="pf-carne__acts">
        {p.providers.includes('email') && (
          <Link href="/cuenta/clave" className="pf-carne__btn">
            Cambiar contraseña
          </Link>
        )}
        <span className="pf-carne__tema">
          Tema <ThemeToggle />
        </span>
      </div>
    </section>
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
    const boton = (e.nativeEvent as SubmitEvent).submitter ?? null;
    setEstado({ busy: true });
    const { error } = await supabase.rpc('update_my_name', { p_full_name: v });
    if (error) return setEstado({ error: humanError(error) });
    chispasEn(boton);
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
    const boton = (e.nativeEvent as SubmitEvent).submitter ?? null;
    setEstado({ busy: true });
    const { error } = await supabase.rpc('update_my_person_name', { p_person_id: cuenta.person_id, p_name: v });
    if (error) return setEstado({ error: humanError(error) });
    chispasEn(boton);
    setEstado({});
    onSaved();
  };

  return (
    <li className="pf-alias">
      <form className="pf-row" onSubmit={guardar}>
        <label htmlFor={id} className="pf-cuenta">
          <span className="ap-glyph pf-glyph" style={{ background: `var(--tono-${accountTone(cuenta.name)})` }} aria-hidden="true">
            {accountGlyph(cuenta.name)}
          </span>
          <span>
            <b>{cuenta.name}</b>
            <span className={`lu-role lu-role--${cuenta.role}`}>{ROLE_LABEL[cuenta.role]}</span>
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
  const [estado, setEstado] = useState<{ busy?: string; error?: string; aviso?: string; listo?: boolean }>({});
  const id = useId();

  const agregar = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.trim()) return;
    const boton = (e.nativeEvent as SubmitEvent).submitter ?? null;
    setEstado({ busy: 'agregar' });
    const { data, error } = await supabase.rpc('add_my_whatsapp', { p_phone: v });
    if (error) return setEstado({ error: humanError(error) });
    const r = data as { wa_id: string; accounts: number; taken_in: string[] };
    setV('');
    if (r.accounts) chispasEn(boton);
    setEstado({
      listo: r.accounts > 0,
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
        <ul className="pf-nums">
          {numeros.map((n) => (
            <li key={n} className="pf-num">
              <Icono d="whatsapp" className="pf-num__ico" />
              <span>{formatWaNumber(n) ?? n}</span>
              <button
                type="button"
                className="pf-num__x"
                onClick={() => quitar(n)}
                disabled={estado.busy === n}
                aria-label={`Quitar ${formatWaNumber(n) ?? n}`}
              >
                ×
              </button>
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
        <div className="pf-aviso" role="status">
          {estado.listo && <LottieSlot name="whatsapp-conectado" width={40} height={40} />}
          <span className="lu-small">{estado.aviso}</span>
        </div>
      )}
    </>
  );
}

const PALABRA = 'ELIMINAR';

/** «Ver las guías otra vez»: la del inicio y la de las cuentas vuelven a salir solas */
function VerGuias({ usuario }: { usuario: string }) {
  const [estado, setEstado] = useState<'quieto' | 'cargando' | 'listo'>('quieto');
  const [error, setError] = useState<string | null>(null);
  const reiniciar = async () => {
    setEstado('cargando');
    setError(null);
    const { error } = await createClient().rpc('reiniciar_guias');
    if (error) {
      setEstado('quieto');
      return setError(humanError(error));
    }
    olvidarGuias(usuario);
    setEstado('listo');
  };
  return (
    <div className="pf-guia">
      {estado === 'listo' ? (
        <p className="lu-small" role="status" style={{ margin: 0 }}>
          Listo: al volver al inicio sale la guía, y la de las cuentas la primera vez que entres a una.{' '}
          <Link href="/" className="pf-link">
            Ir al inicio
          </Link>
        </p>
      ) : (
        <Button size="sm" variant="secondary" onClick={reiniciar} disabled={estado === 'cargando'}>
          {estado === 'cargando' ? 'Un momento…' : 'Ver las guías otra vez'}
        </Button>
      )}
      {error && (
        <p className="lu-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

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
      <div className="pf-tiles">
        <button type="button" className="pf-tile" onClick={descargar} disabled={bajando}>
          <span className="pf-ico pf-ico--azul">
            <Icono d="bajar" />
          </span>
          <span className="pf-tile__txt">
            <b>{bajando ? 'Preparando…' : 'Descargar mis datos'}</b>
            <span className="lu-small lu-muted">Tu perfil, lo que pagaste, tu parte de cada gasto y tus mensajes, en un archivo.</span>
          </span>
        </button>
        <button type="button" className="pf-tile pf-tile--peligro" onClick={() => setAbierto(true)}>
          <span className="pf-ico pf-ico--coral">
            <Icono d="borrar" />
          </span>
          <span className="pf-tile__txt">
            <b>Eliminar mi cuenta</b>
            <span className="lu-small lu-muted">Se borra tu usuario. Antes te contamos qué pasa con cada cuenta.</span>
          </span>
        </button>
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
