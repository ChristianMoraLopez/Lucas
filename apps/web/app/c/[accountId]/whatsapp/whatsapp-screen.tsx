'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { Cargando } from '@/components/cargando';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button, ConnectionStatus, LottieSlot, Sticker } from '@/components/lucas-ui';
import { formatDay, formatWhen, todayInBogota } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { type AccountPerson, type AccountType, formatWaNumber, type MyWhatsappLink, numeroParaCodigo, plural, type WhatsappOverview } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

type Grupo = WhatsappOverview['groups'][number];
type Remitente = WhatsappOverview['unknown_senders'][number];

/** timestamptz → «24 sep» */
const dia = (iso: string) => formatDay(todayInBogota(new Date(iso)));

/** Cambios en vivo: el enlace del grupo, números nuevos y mensajes que llegan */
function useWhatsappChanges(accountId: string, onChange: () => void) {
  const [supabase] = useState(() => createClient());
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const filter = `account_id=eq.${accountId}`;
    const channel = supabase
      .channel(`whatsapp-${accountId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'account_group_links', filter }, () => cb.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_senders', filter }, () => cb.current())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter }, () => cb.current())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, supabase]);
}

/** «hace 4 s», actualizado cada segundo */
function useHace(desde: number) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((ahora - desde) / 1000));
  return s < 60 ? `hace ${s} s` : `hace ${Math.round(s / 60)} min`;
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <li className={`wa-step${done ? ' is-done' : ''}`}>
      <span className="wa-n" aria-hidden="true">
        {done ? '✓' : n}
      </span>
      <div className="wa-body">
        <h2 className="wa-t">
          {title}
          {done && <span className="lu-sr"> · listo</span>}
        </h2>
        {children}
      </div>
    </li>
  );
}

/** Copia al portapapeles; si el navegador no deja (p. ej. dentro de otra app), con el método viejo */
async function copiar(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function CopyButton({ text, label, variant = 'secondary' }: { text: string; label: string; variant?: 'primary' | 'secondary' }) {
  const [estado, setEstado] = useState<'listo' | 'copiado' | 'fallo'>('listo');
  return (
    <Button
      size="sm"
      variant={variant}
      onClick={async () => {
        setEstado((await copiar(text)) ? 'copiado' : 'fallo');
        setTimeout(() => setEstado('listo'), 2500);
      }}
    >
      {estado === 'copiado' ? '¡Copiado!' : estado === 'fallo' ? 'Cópialo a mano' : label}
    </Button>
  );
}

export function WhatsappScreen({
  accountId,
  accountName,
  accountType,
  closed,
}: {
  accountId: string;
  accountName: string;
  accountType: AccountType;
  closed: boolean;
}) {
  const [supabase] = useState(() => createClient());
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: ['whatsapp', accountId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('whatsapp_overview', { p_account_id: accountId });
      if (error) throw error;
      return data as WhatsappOverview;
    },
    // El estado del número contador no llega en vivo: se revisa seguido
    refetchInterval: 10_000,
  });
  const refrescar = () => queryClient.invalidateQueries({ queryKey: ['whatsapp', accountId] });
  useWhatsappChanges(accountId, refrescar);
  const hace = useHace(overview.dataUpdatedAt);

  const crearCodigo = useMutation({
    mutationFn: async () => {
      const dias = accountType === 'evento' ? 7 : 30;
      const { error } = await supabase.rpc('create_invitation', {
        p_account_id: accountId,
        p_role: 'member',
        p_expires_at: new Date(Date.now() + dias * 86_400_000).toISOString(),
        p_max_uses: null,
      });
      if (error) throw error;
    },
    onSuccess: refrescar,
    onError: (e) => setError(humanError(e)),
  });

  if (overview.isPending) {
    return (
      <div className="wa">
        <h1 className="lu-display">Conecta el grupo de WhatsApp</h1>
        <Cargando />
      </div>
    );
  }
  if (overview.isError) {
    return (
      <div className="wa">
        <h1 className="lu-display">Conecta el grupo de WhatsApp</h1>
        <p className="lu-error" role="alert">
          {humanError(overview.error)}
        </p>
      </div>
    );
  }

  const d = overview.data;
  const enlazados = d.groups.filter((g) => !g.left_at);
  const conectado = enlazados.length > 0;
  const contadorOk = Boolean(d.contador?.connected);
  const estado = !contadorOk ? 'error' : conectado ? 'conectado' : 'esperando';
  const principal = enlazados[0];
  const telefono = d.contador?.phone ?? null;

  return (
    <div className="wa">
      <header className="wa-head">
        <h1 className="lu-display">Conecta el grupo de WhatsApp</h1>
        <p className="lu-small lu-muted" style={{ margin: '6px 0 0', maxWidth: '52ch' }}>
          Todo lo que manden al grupo, sean fotos de recibos, PDFs o mensajes con montos («almuerzo 45 lucas, pagó Mafe»), llega a Luks para revisar.
        </p>
      </header>

      {closed && (
        <p className="rv-member lu-small" role="status">
          La cuenta ya no recibe gastos: está cerrada o liquidándose.
        </p>
      )}

      <ol className="wa-steps">
        <Step n={1} title="Agrega a Luks al grupo" done={conectado}>
          {telefono ? (
            <>
              <div className="wa-num lu-num">{formatWaNumber(telefono)}</div>
              <p className="lu-small lu-muted" style={{ margin: '0 0 12px' }}>
                Aparece como «Luks». Solo lee el grupo; escribe únicamente para confirmar.
              </p>
              <div className="wa-row">
                <CopyButton text={`+${telefono}`} label="Copiar número" />
                <a
                  className="lu-btn lu-btn--sm lu-btn--ghost"
                  download="Luks.vcf"
                  href={`data:text/vcard;charset=utf-8,${encodeURIComponent(`BEGIN:VCARD\nVERSION:3.0\nFN:Luks\nTEL;TYPE=CELL:+${telefono}\nEND:VCARD\n`)}`}
                >
                  Guardar contacto
                </a>
              </div>
            </>
          ) : (
            <p className="lu-small lu-muted" style={{ margin: 0 }}>
              El número de Luks todavía no está listo. Mientras tanto, abajo puedes vincular tu propio WhatsApp.
            </p>
          )}
        </Step>

        <Step n={2} title="Escribe este mensaje en el grupo" done={conectado}>
          {d.code && !closed ? (
            <>
              <div className="wa-bubble">
                <span className="lu-num">luks {d.code}</span>
              </div>
              <div className="wa-row">
                <CopyButton text={`luks ${d.code}`} label="Copiar mensaje" />
              </div>
              <p className="lu-small lu-muted" style={{ margin: '12px 0 0' }}>
                Es el mismo código de las invitaciones: quien lo vea en el grupo también puede entrar a «{accountName}» con él.
              </p>
            </>
          ) : d.is_admin && !closed ? (
            <>
              <p className="lu-small" style={{ margin: '0 0 12px' }}>
                La cuenta no tiene un código vigente.
              </p>
              <Button size="sm" onClick={() => crearCodigo.mutate()} disabled={crearCodigo.isPending}>
                {crearCodigo.isPending ? 'Creando…' : 'Crear código'}
              </Button>
            </>
          ) : (
            <p className="lu-small lu-muted" style={{ margin: 0 }}>
              Pídele el mensaje a quien administra la cuenta: lo ve aquí mismo.
            </p>
          )}
        </Step>

        <Step n={3} title="Espera la confirmación" done={conectado}>
          <div className={`wa-live wa-live--${estado}`}>
            <LottieSlot name={conectado ? 'whatsapp-conectado' : 'conectando-whatsapp'} width={64} height={64} />
            <div className="wa-live__txt">
              {estado === 'esperando' && <ConnectionStatus state="esperando" sub={`revisado ${hace}`} />}
              {estado === 'conectado' && principal && (
                <ConnectionStatus
                  state="conectado"
                  sub={
                    principal.last_message_at
                      ? `último mensaje ${formatWhen(principal.last_message_at)}${principal.last_sender ? ` · ${principal.last_sender}` : ''}`
                      : 'todavía sin mensajes'
                  }
                >
                  Conectado a «{principal.name ?? 'el grupo'}»{enlazados.length > 1 ? ` y ${plural(enlazados.length - 1, 'grupo más', 'grupos más')}` : ''}
                </ConnectionStatus>
              )}
              {estado === 'error' && (
                <ConnectionStatus state="error" sub={d.contador ? 'el número de Luks está desconectado' : 'el número de Luks todavía no está vinculado'}>
                  {conectado ? 'Luks no está leyendo el grupo ahora' : 'Todavía no vemos el código'}
                </ConnectionStatus>
              )}
              {conectado && principal && (
                <span className="lu-small">
                  {principal.participants ? `${principal.participants} personas · ` : ''}
                  {plural(principal.expenses, 'mensaje con gasto', 'mensajes con gastos')} desde el {dia(principal.linked_at)}
                </span>
              )}
              {estado === 'error' && <span className="lu-small">Ya avisamos a quien opera Luks. Lo que manden al grupo se lee cuando vuelva.</span>}
            </div>
          </div>
        </Step>
      </ol>

      <aside className="wa-side">
        {conectado && (
          <div className="wa-ready">
            <Sticker tone="pagado" rotate={-5} size="lg">
              ¡Listo!
            </Sticker>
            <Link href={`/c/${accountId}/revisar`} className="lu-btn lu-btn--primary">
              Ir a revisar
            </Link>
          </div>
        )}
        {error && (
          <p className="lu-error" role="alert">
            {error}
          </p>
        )}
        {d.is_admin && d.unknown_senders.length > 0 && <QuienEs accountId={accountId} remitentes={d.unknown_senders} onDone={refrescar} onError={setError} />}
        {d.groups.length > 0 && <Grupos grupos={d.groups} isAdmin={d.is_admin} onDone={refrescar} onError={setError} />}
        <MiWhatsapp />
      </aside>
    </div>
  );
}

/** «¿Quién es este número?»: un admin dice de quién es cada número nuevo del grupo */
function QuienEs({ accountId, remitentes, onDone, onError }: { accountId: string; remitentes: Remitente[]; onDone: () => void; onError: (e: string) => void }) {
  const [supabase] = useState(() => createClient());
  const personas = useQuery({
    queryKey: ['personas-wa', accountId],
    queryFn: async () => {
      const { data, error } = await supabase.from('people').select('id, display_name, tone, claimed_by').eq('account_id', accountId).order('display_name');
      if (error) throw error;
      return data as AccountPerson[];
    },
  });

  return (
    <section className="wa-card" aria-labelledby="wa-quien">
      <h2 className="lu-title" id="wa-quien" style={{ margin: 0 }}>
        ¿Quién es este número?
      </h2>
      <p className="lu-small lu-muted" style={{ margin: 0 }}>
        Escribieron en el grupo y no sabemos de quién son. Así sus gastos quedan a su nombre.
      </p>
      <ul className="wa-who">
        {remitentes.map((r) => (
          <Remitente key={r.wa_id} accountId={accountId} r={r} personas={personas.data ?? []} onDone={onDone} onError={onError} />
        ))}
      </ul>
    </section>
  );
}

function Remitente({
  accountId,
  r,
  personas,
  onDone,
  onError,
}: {
  accountId: string;
  r: Remitente;
  personas: AccountPerson[];
  onDone: () => void;
  onError: (e: string) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [eleccion, setEleccion] = useState('');
  const [nombre, setNombre] = useState(r.push_name ?? '');
  const [busy, setBusy] = useState(false);
  const numero = formatWaNumber(r.wa_id);

  const guardar = async () => {
    setBusy(true);
    const nuevo = eleccion === '__nuevo';
    const { error } = await supabase.rpc('identify_wa_sender', {
      p_account_id: accountId,
      p_wa_id: r.wa_id,
      p_person_id: nuevo ? null : eleccion,
      p_new_name: nuevo ? nombre : null,
    });
    setBusy(false);
    if (error) return onError(humanError(error));
    onDone();
  };
  const descartar = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('dismiss_wa_sender', { p_account_id: accountId, p_wa_id: r.wa_id });
    setBusy(false);
    if (error) return onError(humanError(error));
    onDone();
  };

  return (
    <li>
      <div className="wa-who__id">
        <b className="lu-num">{numero ?? 'Número oculto por WhatsApp'}</b>
        <span className="lu-small lu-muted">
          {r.push_name ? `se hace llamar «${r.push_name}» · ` : ''}
          {plural(r.message_count, 'mensaje', 'mensajes')}
        </span>
      </div>
      <div className="wa-who__form">
        <select
          aria-label={`¿Quién es ${numero ?? r.push_name ?? 'este número'}?`}
          value={eleccion}
          onChange={(e) => setEleccion(e.target.value)}
          className="wa-input"
        >
          <option value="">Elige a la persona…</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name}
            </option>
          ))}
          <option value="__nuevo">Es alguien nuevo</option>
        </select>
        {eleccion === '__nuevo' && (
          <input
            className="wa-input"
            aria-label="Cómo le dicen"
            placeholder="Cómo le dicen"
            value={nombre}
            maxLength={40}
            onChange={(e) => setNombre(e.target.value)}
          />
        )}
        <div className="wa-row">
          <Button size="sm" onClick={guardar} disabled={busy || !eleccion || (eleccion === '__nuevo' && !nombre.trim())}>
            Guardar
          </Button>
          <Button size="sm" variant="ghost" onClick={descartar} disabled={busy}>
            No es de la cuenta
          </Button>
        </div>
      </div>
    </li>
  );
}

function Grupos({ grupos, isAdmin, onDone, onError }: { grupos: Grupo[]; isAdmin: boolean; onDone: () => void; onError: (e: string) => void }) {
  const [supabase] = useState(() => createClient());
  const [quitar, setQuitar] = useState<Grupo | null>(null);
  const [busy, setBusy] = useState(false);

  const confirmaciones = async (g: Grupo, on: boolean) => {
    const { error } = await supabase.rpc('set_group_confirmations', { p_group_id: g.group_id, p_on: on });
    if (error) return onError(humanError(error));
    onDone();
  };
  const desconectar = async () => {
    if (!quitar) return;
    setBusy(true);
    const { error } = await supabase.from('account_group_links').delete().eq('group_id', quitar.group_id);
    setBusy(false);
    setQuitar(null);
    if (error) return onError(humanError(error));
    onDone();
  };

  return (
    <section className="wa-card" aria-labelledby="wa-grupos">
      <h2 className="lu-title" id="wa-grupos" style={{ margin: 0 }}>
        {grupos.length === 1 ? 'Grupo conectado' : 'Grupos conectados'}
      </h2>
      <ul className="wa-groups">
        {grupos.map((g) => (
          <li key={g.group_id}>
            <div className="wa-groups__t">
              <b>{g.name ?? 'Grupo sin nombre'}</b>
              <span className="lu-small lu-muted">
                {g.left_at
                  ? `Sacaron a Luks del grupo el ${dia(g.left_at)}`
                  : `desde el ${dia(g.linked_at)} · ${plural(g.expenses, 'gasto', 'gastos')}${g.connection_kind === 'personal' ? ' · por un WhatsApp personal' : ''}`}
              </span>
            </div>
            {isAdmin && !g.left_at && (
              <div className="wa-groups__acts">
                <label className="wa-switch">
                  <input type="checkbox" checked={g.confirm_in_group} onChange={(e) => confirmaciones(g, e.target.checked)} />
                  <span>Confirmar en el grupo</span>
                </label>
                <Button size="sm" variant="ghost" onClick={() => setQuitar(g)}>
                  Desconectar
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={quitar !== null}
        onOpenChange={(o) => !o && setQuitar(null)}
        title="¿Desconectar el grupo?"
        confirmLabel="Desconectar"
        busy={busy}
        onConfirm={desconectar}
      >
        Luks deja de anotar lo que manden a «{quitar?.name ?? 'el grupo'}». Lo que ya está registrado se queda. Para volver, escriban otra vez «luks» y el
        código.
      </ConfirmDialog>
    </section>
  );
}

/** Vincular el WhatsApp propio (opcional): Luks lee los grupos sin agregar el número contador */
function MiWhatsapp() {
  const [supabase] = useState(() => createClient());
  const queryClient = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [numero, setNumero] = useState('');
  const [qrImg, setQrImg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cerrar, setCerrar] = useState(false);

  const link = useQuery({
    queryKey: ['mi-whatsapp'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_whatsapp_link');
      if (error) throw error;
      return (data as MyWhatsappLink | null) ?? null;
    },
    // Mientras se vincula, el QR cambia cada ~20 s
    refetchInterval: (q) => (q.state.data?.status === 'connecting' ? 2000 : false),
  });
  const l = link.data;

  useEffect(() => {
    if (!l?.qr || l.code) return setQrImg(null);
    QRCode.toDataURL(l.qr, { margin: 1, width: 240 })
      .then(setQrImg)
      .catch(() => setQrImg(null));
  }, [l?.qr, l?.code]);

  const telefono = numeroParaCodigo(numero);
  const pedir = async (conCodigo: boolean) => {
    setError(null);
    const { error } = await supabase.rpc('request_personal_whatsapp', { p_phone: conCodigo ? telefono : null });
    if (error) return setError(humanError(error));
    queryClient.invalidateQueries({ queryKey: ['mi-whatsapp'] });
  };
  const desvincular = async () => {
    const { error } = await supabase.rpc('stop_personal_whatsapp');
    setCerrar(false);
    if (error) return setError(humanError(error));
    queryClient.invalidateQueries({ queryKey: ['mi-whatsapp'] });
  };

  if (l?.status === 'connected') {
    return (
      <section className="wa-card" aria-labelledby="wa-mio">
        <h2 className="lu-title" id="wa-mio" style={{ margin: 0 }}>
          Tu WhatsApp
        </h2>
        <ConnectionStatus state={l.alive === false ? 'error' : 'conectado'} sub={l.connected_at ? `desde el ${dia(l.connected_at)}` : undefined}>
          {l.stopping ? 'Desvinculando…' : `Vinculado${l.phone ? ` (${formatWaNumber(l.phone)})` : ''}`}
        </ConnectionStatus>
        <p className="lu-small lu-muted" style={{ margin: 0 }}>
          Luks lee los grupos que conectes con «luks» y el código. Nunca escribe desde tu número.
        </p>
        {!l.stopping && (
          <Button size="sm" variant="ghost" onClick={() => setCerrar(true)}>
            Desvincular mi WhatsApp
          </Button>
        )}
        <ConfirmDialog open={cerrar} onOpenChange={setCerrar} title="¿Desvincular tu WhatsApp?" confirmLabel="Desvincular" onConfirm={desvincular}>
          Luks deja de leer los grupos desde tu número. Si un grupo solo estaba conectado así, hay que agregar el número de Luks.
        </ConfirmDialog>
      </section>
    );
  }

  if (l?.status === 'connecting') {
    return (
      <section className="wa-card" aria-labelledby="wa-mio" aria-live="polite">
        <h2 className="lu-title" id="wa-mio" style={{ margin: 0 }}>
          Vincula tu WhatsApp
        </h2>
        {l.code ? (
          <>
            <div className="wa-code lu-num">
              {l.code.slice(0, 4)}-{l.code.slice(4)}
            </div>
            <CopyButton text={l.code} label="Copiar código" variant="primary" />
            <ol className="wa-howto lu-small">
              <li>
                Abre WhatsApp → <b>Dispositivos vinculados</b> → <b>Vincular un dispositivo</b>.
              </li>
              <li>
                Abajo, toca <b>Vincular con el número de teléfono</b> (o abre la notificación que te manda WhatsApp).
              </li>
              <li>Escribe o pega el código.</li>
            </ol>
            <p className="lu-small lu-muted" style={{ margin: 0 }}>
              El código cambia cada 2 o 3 minutos. Si WhatsApp dice que no sirve, vuelve aquí y usa el nuevo.
            </p>
          </>
        ) : (
          <p className="lu-small" style={{ margin: 0 }}>
            Desde otro celular o con la cámara de tu WhatsApp: <b>Dispositivos vinculados</b> → <b>Vincular un dispositivo</b>, y escanea este código:
          </p>
        )}
        {l.code ? null : qrImg ? (
          // biome-ignore lint/performance/noImgElement: es un QR generado en el navegador, no una imagen para optimizar
          <img className="wa-qr" src={qrImg} alt="Código QR para vincular tu WhatsApp con Luks" width={240} height={240} />
        ) : (
          <p className="lu-small lu-muted" style={{ margin: 0 }}>
            Preparando el código… {l.alive === false ? 'Si no aparece en unos segundos, el servidor de Luks puede estar apagado.' : ''}
          </p>
        )}
        <Button size="sm" variant="ghost" onClick={desvincular}>
          Cancelar
        </Button>
      </section>
    );
  }

  return (
    <section className="wa-card wa-card--muted" aria-labelledby="wa-mio">
      <h2 className="lu-label" id="wa-mio" style={{ margin: 0 }}>
        ¿Sin el número de Luks?
      </h2>
      <p className="lu-small" style={{ margin: 0 }}>
        Luks también puede leer los grupos desde tu propio WhatsApp, como un dispositivo vinculado más. Solo lee los grupos que conectes y nunca escribe desde
        tu número.
      </p>
      {l?.status === 'disconnected' && l.disconnect_reason && (
        <p className="lu-small lu-muted" style={{ margin: 0 }}>
          La última vez: {l.disconnect_reason}
        </p>
      )}
      {abierto ? (
        <>
          <label className="lu-label" htmlFor="wa-numero">
            Tu número de WhatsApp
          </label>
          <input
            id="wa-numero"
            className="wa-input lu-num"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="300 123 4567"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            aria-describedby="wa-numero-ayuda"
          />
          <p className="lu-small lu-muted" id="wa-numero-ayuda" style={{ margin: 0 }}>
            {numero.trim() && !telefono
              ? 'Escribe el número completo. Si no es de Colombia, con su indicativo (p. ej. 34 612 345 678).'
              : telefono
                ? `Te damos un código de 8 letras para ${formatWaNumber(telefono)}: sirve desde este mismo celular.`
                : 'Desde este celular: escribe tu número y te damos un código de 8 letras. Desde un computador: usa el QR.'}
          </p>
          <div className="wa-row">
            <Button size="sm" onClick={() => pedir(true)} disabled={!telefono}>
              Pedir código
            </Button>
            <Button size="sm" variant="secondary" onClick={() => pedir(false)}>
              Mostrar QR
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
          </div>
        </>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setAbierto(true)}>
          Vincular mi WhatsApp
        </Button>
      )}
      {error && (
        <p className="lu-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
