'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { CampoTelefono } from '@/components/campo-telefono';
import { Cargando } from '@/components/cargando';
import { lanzarChispas } from '@/components/chispas';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useT } from '@/components/idioma';
import { Button, ConnectionStatus, LottieSlot, Sticker } from '@/components/lucas-ui';
import { ItemAnimado, ListaAnimada } from '@/components/movimiento';
import { copiar } from '@/lib/clipboard';
import { formatDay, formatWhen, todayInBogota } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import type { T } from '@/lib/i18n';
import { rico } from '@/lib/i18n/rico';
import { archivosGuia, chatHref, MISTER_LUKS, vcardHref } from '@/lib/mister-luks';
import { formatear } from '@/lib/telefono';
import { type AccountPerson, type AccountType, type MyWhatsappLink, plural, type WhatsappOverview } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';
import { MonedaIdioma } from './moneda-idioma';

type Grupo = WhatsappOverview['groups'][number];
type Remitente = WhatsappOverview['unknown_senders'][number];

/** timestamptz → «24 sep» («Sep 24» en inglés) */
const dia = (iso: string, t: T) => formatDay(todayInBogota(new Date(iso)), undefined, t.idioma);

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

/** true desde que `si` pasa de false a true mientras se mira (no al llegar ya en true) */
function useRecien(si: boolean) {
  const antes = useRef<boolean | null>(null);
  const [recien, setRecien] = useState(false);
  useEffect(() => {
    if (antes.current === false && si) setRecien(true);
    antes.current = si;
  }, [si]);
  return recien;
}

/** «hace 4 s», actualizado cada segundo */
function useHace(desde: number) {
  const t = useT();
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const reloj = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(reloj);
  }, []);
  const s = Math.max(0, Math.round((ahora - desde) / 1000));
  return s < 60 ? t('hace {n} s', { n: s }) : t('hace {n} min', { n: Math.round(s / 60) });
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  const t = useT();
  return (
    <li className={`wa-step${done ? ' is-done' : ''}`}>
      <span className="wa-n" aria-hidden="true">
        {done ? '✓' : n}
      </span>
      <div className="wa-body">
        <h2 className="wa-t">
          {title}
          {done && <span className="lu-sr"> · {t('listo')}</span>}
        </h2>
        {children}
      </div>
    </li>
  );
}

function CopyButton({ text, label, variant = 'secondary' }: { text: string; label: string; variant?: 'primary' | 'secondary' }) {
  const t = useT();
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
      {estado === 'copiado' ? t('¡Copiado!') : estado === 'fallo' ? t('Cópialo a mano') : label}
    </Button>
  );
}

export function WhatsappScreen({
  accountId,
  accountName,
  accountType,
  closed,
  ajustes,
}: {
  accountId: string;
  accountName: string;
  accountType: AccountType;
  closed: boolean;
  ajustes: Omit<React.ComponentProps<typeof MonedaIdioma>, 'accountId'>;
}) {
  const t = useT();
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

  // Se conectó el grupo mientras miraba la pantalla: se celebra una vez
  const recienConectado = useRecien(Boolean(overview.data?.groups.some((g) => !g.left_at)));
  const celebrado = useRef(false);
  useEffect(() => {
    if (!recienConectado || celebrado.current) return;
    celebrado.current = true;
    const el = document.querySelector('.wa-live');
    lanzarChispas({ clientX: 0, clientY: 0, currentTarget: el });
  }, [recienConectado]);

  if (overview.isPending) {
    return (
      <div className="wa">
        <h1 className="lu-display">{t('Conecta el grupo de WhatsApp')}</h1>
        <Cargando />
      </div>
    );
  }
  if (overview.isError) {
    return (
      <div className="wa">
        <h1 className="lu-display">{t('Conecta el grupo de WhatsApp')}</h1>
        <p className="lu-error" role="alert">
          {humanError(overview.error)}
        </p>
      </div>
    );
  }

  const d = overview.data;
  const enlazados = d.groups.filter((g) => !g.left_at);
  const conectado = enlazados.length > 0;
  // Cada grupo lo lee una sesión: Mister Luks o el WhatsApp vinculado de alguien
  const leidos = enlazados.filter((g) => g.connection_ok);
  const contadorOk = Boolean(d.contador?.connected);
  const lectores = d.lectores ?? [];
  const otrosLectores = lectores.filter((l) => !l.is_me).map((l) => l.name);
  const alguienLee = contadorOk || lectores.length > 0;
  const estado: 'conectado' | 'esperando' | 'error' = conectado ? (leidos.length > 0 ? 'conectado' : 'error') : alguienLee ? 'esperando' : 'error';
  const principal = leidos[0] ?? enlazados[0];
  // Mister Luks existe cuando su número quedó vinculado alguna vez; antes, su tarjeta dice «Pronto»
  const telefono = d.contador?.phone ?? null;
  // El paso 1 está hecho si el grupo ya está conectado o alguien de la cuenta vinculó su WhatsApp
  // (que Mister Luks esté conectado no dice que ya esté en el grupo)
  const paso1 = conectado || lectores.length > 0;
  const caido = principal?.connection_kind === 'personal' ? t('el WhatsApp vinculado que lo lee está desconectado') : t('Mister Luks está desconectado');

  return (
    <div className={`wa${conectado ? ' wa--conectado' : ''}`}>
      <header className="wa-head">
        <h1 className="lu-display">{t('Conecta el grupo de WhatsApp')}</h1>
        <p className="lu-small lu-muted" style={{ margin: '6px 0 0', maxWidth: '52ch' }}>
          {t('Todo lo que manden al grupo, sean fotos de recibos, PDFs o mensajes con montos («almuerzo 45 lucas, pagó Mafe»), llega a Luks para revisar.')}
        </p>
      </header>

      {closed && (
        <p className="rv-member lu-small" role="status">
          {t('La cuenta ya no recibe gastos: está cerrada o liquidándose.')}
        </p>
      )}

      <section className="wa-formas" aria-labelledby="wa-formas-t">
        <div className="wa-formas__head">
          <span className={`wa-n${paso1 ? ' is-done' : ''}`} aria-hidden="true">
            {paso1 ? '✓' : 1}
          </span>
          <div>
            <h2 className="wa-t" id="wa-formas-t">
              {t('Elige cómo entra Luks al grupo')}
            </h2>
            <p className="lu-small lu-muted" style={{ margin: 0 }}>
              {t('Las dos sirven y se pueden usar juntas en el mismo grupo: nada se anota dos veces.')}
            </p>
          </div>
        </div>
        <div className="wa-formas__grid lu-stagger">
          <FormaMisterLuks telefono={telefono} conectado={contadorOk} />
          <FormaMiWhatsapp otrosLectores={otrosLectores} />
        </div>
      </section>

      <ol className="wa-steps">
        <Step n={2} title={t('Escribe este mensaje en el grupo')} done={conectado}>
          {d.code && !closed ? (
            <>
              <div className="wa-bubble">
                <span className="lu-num">luks {d.code}</span>
              </div>
              <div className="wa-row">
                <CopyButton text={`luks ${d.code}`} label={t('Copiar mensaje')} />
              </div>
              <p className="lu-small lu-muted" style={{ margin: '12px 0 0' }}>
                {t('Es el mismo código de las invitaciones: quien lo vea en el grupo también puede entrar a «{cuenta}» con él.', { cuenta: accountName })}
              </p>
            </>
          ) : d.is_admin && !closed ? (
            <>
              <p className="lu-small" style={{ margin: '0 0 12px' }}>
                {t('La cuenta no tiene un código vigente.')}
              </p>
              <Button size="sm" onClick={() => crearCodigo.mutate()} disabled={crearCodigo.isPending}>
                {crearCodigo.isPending ? t('Creando…') : t('Crear código')}
              </Button>
            </>
          ) : (
            <p className="lu-small lu-muted" style={{ margin: 0 }}>
              {t('Pídele el mensaje a quien administra la cuenta: lo ve aquí mismo.')}
            </p>
          )}
        </Step>

        <Step n={3} title={t('Espera la confirmación')} done={conectado}>
          <div className={`wa-live wa-live--${estado}`}>
            <LottieSlot name={conectado ? 'whatsapp-conectado' : 'conectando-whatsapp'} width={64} height={64} />
            <div className="wa-live__txt">
              {estado === 'esperando' && <ConnectionStatus state="esperando" sub={t('revisado {hace}', { hace })} />}
              {estado === 'conectado' && principal && (
                <ConnectionStatus
                  state="conectado"
                  sub={
                    principal.last_message_at
                      ? `${t('último mensaje {cuando}', { cuando: formatWhen(principal.last_message_at, t.idioma) })}${principal.last_sender ? ` · ${principal.last_sender}` : ''}`
                      : t('todavía sin mensajes')
                  }
                >
                  {t('Conectado a «{grupo}»', { grupo: principal.name ?? t('el grupo') })}
                  {enlazados.length > 1 ? ` ${t('y {grupos}', { grupos: plural(enlazados.length - 1, t('grupo más'), t('grupos más')) })}` : ''}
                </ConnectionStatus>
              )}
              {estado === 'error' && (
                <ConnectionStatus
                  state="error"
                  sub={conectado ? caido : telefono ? t('Mister Luks está desconectado') : t('todavía no hay un WhatsApp vinculado que lo lea')}
                >
                  {conectado ? t('Luks no está leyendo el grupo ahora') : t('Nadie está leyendo el grupo todavía')}
                </ConnectionStatus>
              )}
              {conectado && principal && (
                <span className="lu-small">
                  {(principal.members ?? principal.participants) ? `${t('{n} integrantes', { n: principal.members ?? principal.participants ?? 0 })} · ` : ''}
                  {t('{mensajes} desde el {dia}', {
                    mensajes: plural(principal.expenses, t('mensaje con gasto'), t('mensajes con gastos')),
                    dia: dia(principal.linked_at, t),
                  })}
                </span>
              )}
              {estado === 'error' && conectado && (
                <span className="lu-small">
                  {principal?.connection_kind === 'personal'
                    ? t(
                        'Puede que el servidor de Luks esté apagado, o que desvincularan ese WhatsApp (si es así, vuelve a vincularlo aquí abajo). Lo que manden mientras tanto se lee cuando vuelva.',
                      )
                    : t('Ya avisamos a quien opera Luks. Lo que manden al grupo se lee cuando vuelva.')}
                </span>
              )}
              {estado === 'error' && !conectado && (
                <span className="lu-small">
                  {t('Agrega a Mister Luks o vincula tu WhatsApp (paso 1) y después escribe el mensaje del paso 2 en el grupo.')}
                </span>
              )}
            </div>
          </div>
        </Step>
      </ol>

      <aside className="wa-side">
        {conectado && (
          <div className="wa-ready">
            <Sticker tone="pagado" rotate={-5} size="lg" animate={recienConectado}>
              {t('¡Listo!')}
            </Sticker>
            <Link href={`/c/${accountId}/revisar`} className="lu-btn lu-btn--primary">
              {t('Ir a revisar')}
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
        {conectado && <OtrosGrupos />}
        {d.is_admin && !closed && <MonedaIdioma accountId={accountId} {...ajustes} />}
      </aside>
    </div>
  );
}

/** «Vale», «Vale y Santi», «Vale, Santi y Mafe» */
function listaNombres(nombres: string[], t: T) {
  return nombres.length <= 1 ? (nombres[0] ?? '') : `${nombres.slice(0, -1).join(', ')} ${t('y')} ${nombres.at(-1)}`;
}

/** Un grupo de WhatsApp por cuenta: otro plan con otra gente es otra cuenta con su propio código */
function OtrosGrupos() {
  const t = useT();
  return (
    <section className="wa-card wa-card--muted" aria-labelledby="wa-otros">
      <h2 className="lu-label" id="wa-otros" style={{ margin: 0 }}>
        {t('¿Otro plan con otro grupo?')}
      </h2>
      <p className="lu-small" style={{ margin: 0 }}>
        {t(
          'Cada grupo de WhatsApp va con una cuenta. Para un paseo o una fiesta, crea otra cuenta y escribe su código en el grupo de ese plan: cada una lleva sus gastos y sus personas aparte. Tu WhatsApp vinculado sirve para todas.',
        )}
      </p>
      <Link href="/cuentas/nueva" className="lu-btn lu-btn--sm lu-btn--secondary">
        {t('Crear otra cuenta')}
      </Link>
    </section>
  );
}

/** «¿Quién es este número?»: un admin dice de quién es cada número nuevo del grupo */
function QuienEs({ accountId, remitentes, onDone, onError }: { accountId: string; remitentes: Remitente[]; onDone: () => void; onError: (e: string) => void }) {
  const t = useT();
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
        {t('¿Quién es este número?')}
      </h2>
      <p className="lu-small lu-muted" style={{ margin: 0 }}>
        {t('Escribieron en el grupo y no sabemos de quién son. Así sus gastos quedan a su nombre.')}
      </p>
      <ul className="wa-who">
        <ListaAnimada>
          {remitentes.map((r) => (
            <Remitente key={r.wa_id} accountId={accountId} r={r} personas={personas.data ?? []} onDone={onDone} onError={onError} />
          ))}
        </ListaAnimada>
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
  const t = useT();
  const [supabase] = useState(() => createClient());
  const [eleccion, setEleccion] = useState('');
  const [nombre, setNombre] = useState(r.push_name ?? '');
  const [busy, setBusy] = useState(false);
  const numero = formatear(r.wa_id);

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
    <ItemAnimado>
      <div className="wa-who__id">
        <b className="lu-num">{numero ?? t('Número oculto por WhatsApp')}</b>
        <span className="lu-small lu-muted">
          {r.push_name ? `${t('se hace llamar «{nombre}»', { nombre: r.push_name })} · ` : ''}
          {plural(r.message_count, t('mensaje'), t('mensajes'))}
        </span>
      </div>
      <div className="wa-who__form">
        <select
          aria-label={t('¿Quién es {numero}?', { numero: numero ?? r.push_name ?? t('este número') })}
          value={eleccion}
          onChange={(e) => setEleccion(e.target.value)}
          className="wa-input"
        >
          <option value="">{t('Elige a la persona…')}</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name}
            </option>
          ))}
          <option value="__nuevo">{t('Es alguien nuevo')}</option>
        </select>
        {eleccion === '__nuevo' && (
          <input
            className="wa-input"
            aria-label={t('Cómo le dicen')}
            placeholder={t('Cómo le dicen')}
            value={nombre}
            maxLength={40}
            onChange={(e) => setNombre(e.target.value)}
          />
        )}
        <div className="wa-row">
          <Button size="sm" onClick={guardar} disabled={busy || !eleccion || (eleccion === '__nuevo' && !nombre.trim())}>
            {t('Guardar')}
          </Button>
          <Button size="sm" variant="ghost" onClick={descartar} disabled={busy}>
            {t('No es de la cuenta')}
          </Button>
        </div>
      </div>
    </ItemAnimado>
  );
}

function Grupos({ grupos, isAdmin, onDone, onError }: { grupos: Grupo[]; isAdmin: boolean; onDone: () => void; onError: (e: string) => void }) {
  const t = useT();
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
        {grupos.length === 1 ? t('Grupo conectado') : t('Grupos conectados')}
      </h2>
      <p className="lu-small lu-muted" style={{ margin: 0 }}>
        {t('La gente del grupo es la gente de la cuenta: quien entra al grupo aparece solo en Personas, con su nombre de WhatsApp.')}
      </p>
      <ul className="wa-groups">
        <ListaAnimada>
          {grupos.map((g) => (
            <ItemAnimado key={g.group_id}>
              <div className="wa-groups__t">
                <b>{g.name ?? t('Grupo sin nombre')}</b>
                <span className="lu-small lu-muted">
                  {g.left_at
                    ? t('Sacaron a Luks del grupo el {dia}', { dia: dia(g.left_at, t) })
                    : [
                        t('desde el {dia}', { dia: dia(g.linked_at, t) }),
                        g.members != null ? plural(g.members, t('integrante'), t('integrantes')) : null,
                        plural(g.expenses, t('gasto'), t('gastos')),
                        g.connection_kind === 'personal' ? t('por un WhatsApp vinculado') : g.connection_kind === 'contador' ? t('por Mister Luks') : null,
                        g.connection_ok ? null : t('nadie lo lee ahora'),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                </span>
              </div>
              {isAdmin && !g.left_at && (
                <div className="wa-groups__acts">
                  <label className="wa-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-checked={g.confirm_in_group}
                      className="lu-switch"
                      checked={g.confirm_in_group}
                      onChange={(e) => confirmaciones(g, e.target.checked)}
                    />
                    <span>{t('Confirmar en el grupo')}</span>
                  </label>
                  <Button size="sm" variant="ghost" onClick={() => setQuitar(g)}>
                    {t('Desconectar')}
                  </Button>
                </div>
              )}
            </ItemAnimado>
          ))}
        </ListaAnimada>
      </ul>
      <ConfirmDialog
        open={quitar !== null}
        onOpenChange={(o) => !o && setQuitar(null)}
        title={t('¿Desconectar el grupo?')}
        confirmLabel={t('Desconectar')}
        busy={busy}
        onConfirm={desconectar}
      >
        {t('Luks deja de anotar lo que manden a «{grupo}». Lo que ya está registrado se queda. Para volver, escriban otra vez «luks» y el código.', {
          grupo: quitar?.name ?? t('el grupo'),
        })}
      </ConfirmDialog>
    </section>
  );
}

/** Una de las dos formas de conectar el grupo, con lo que tiene cada una en palabras simples */
function Forma({
  id,
  titulo,
  resumen,
  dibujo,
  dibujoAncho = false,
  estado,
  compara,
  children,
}: {
  id: string;
  titulo: string;
  resumen: string;
  /** La Lottie de la forma (se reproduce una vez, al verse) */
  dibujo?: React.ReactNode;
  /** El dibujo es más ancho que alto */
  dibujoAncho?: boolean;
  estado?: React.ReactNode;
  /** [qué, cómo es]; mientras se usa (vinculando, vinculado) no hace falta y no sale */
  compara: [string, string][];
  children: React.ReactNode;
}) {
  return (
    <section className="wa-forma" aria-labelledby={id}>
      <div className="wa-forma__head">
        {dibujo && (
          <span className={`wa-forma__dibujo${dibujoAncho ? ' wa-forma__dibujo--ancho' : ''}`} aria-hidden="true">
            {dibujo}
          </span>
        )}
        <h3 className="lu-title" id={id} style={{ margin: 0 }}>
          {titulo}
        </h3>
        {estado}
      </div>
      <p className="lu-small" style={{ margin: 0 }}>
        {resumen}
      </p>
      {compara.length > 0 && (
        <dl className="wa-compara">
          {compara.map(([que, como]) => (
            <div key={que}>
              <dt>{que}</dt>
              <dd>{como}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="wa-forma__acciones">{children}</div>
    </section>
  );
}

/** Agregar a Mister Luks: el número propio de Luks, que la gente guarda y agrega a sus grupos */
function FormaMisterLuks({ telefono, conectado }: { telefono: string | null; conectado: boolean }) {
  const t = useT();
  const [qr, setQr] = useState<string | null>(null);
  const chat = telefono ? chatHref(telefono, t('Hola')) : null;

  // Desde un computador: el QR abre el chat en el celular
  useEffect(() => {
    if (!chat) return setQr(null);
    QRCode.toDataURL(chat, { margin: 1, width: 240 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [chat]);

  return (
    <Forma
      id="wa-mister"
      titulo={t('Agregar a Mister Luks')}
      resumen={t('El número de Luks: lo guardas como contacto y lo agregas al grupo, como a cualquiera.')}
      dibujo={<LottieSlot name="mister-luks" width={64} height={64} label="" alVerse />}
      estado={
        telefono ? null : (
          <Sticker tone="pendiente" size="sm" rotate={-3}>
            {t('Pronto')}
          </Sticker>
        )
      }
      compara={[
        [t('Qué haces'), t('Lo agregas al grupo, o le mandas el link del grupo por privado.')],
        [t('Qué ve Luks'), t('Solo los grupos donde lo agregues.')],
        [t('¿Responde en el grupo?'), t('Sí: confirma cada gasto («Anotado: …»).')],
        [t('Lo de antes'), t('Lee desde que lo agregan. Lo anterior, con el chat exportado (pronto).')],
        [t('Ideal si'), t('El grupo acepta a alguien más.')],
        [t('Ojo'), t('Si WhatsApp bloquea a Mister Luks, deja de leer todos sus grupos hasta que vuelva. Lo anotado no se pierde.')],
      ]}
    >
      {telefono && chat ? (
        <>
          <div className="wa-mister">
            <div className="wa-mister__txt">
              <span className="wa-num lu-num">{formatear(telefono)}</span>
              {conectado ? (
                <span className="lu-small lu-muted">{t('Aparece como «{nombre}».', { nombre: MISTER_LUKS.nombre })}</span>
              ) : (
                <ConnectionStatus state="error" sub={t('lo que manden se lee cuando vuelva')}>
                  {t('Desconectado ahora')}
                </ConnectionStatus>
              )}
            </div>
            {qr && (
              // biome-ignore lint/performance/noImgElement: es un QR generado en el navegador, no una imagen para optimizar
              <img className="wa-mister__qr" src={qr} alt={t('Código QR para abrir el chat con Mister Luks')} width={120} height={120} />
            )}
          </div>
          <div className="wa-row">
            <a className="lu-btn lu-btn--sm lu-btn--secondary" download="Mister Luks.vcf" href={vcardHref(telefono)}>
              {t('Guardar contacto')}
            </a>
            <a className="lu-btn lu-btn--sm lu-btn--secondary" href={chat} target="_blank" rel="noopener noreferrer">
              {t('Abrir chat con Mister Luks')}
            </a>
            <a className="lu-btn lu-btn--sm lu-btn--ghost" href={archivosGuia(t.idioma).pdf} download>
              {t('Descargar el instructivo')}
            </a>
          </div>
        </>
      ) : (
        <p className="lu-small lu-muted" style={{ margin: 0 }}>
          {t('Mister Luks está por llegar. Mientras tanto, vincula tu WhatsApp: Luks lee el grupo desde ahí.')}
        </p>
      )}
    </Forma>
  );
}

/** Vincular mi WhatsApp: Luks lee los grupos desde el WhatsApp de la persona, como un WhatsApp Web más (también en /grupos) */
export function FormaMiWhatsapp({ otrosLectores }: { otrosLectores: string[] }) {
  const t = useT();
  const [supabase] = useState(() => createClient());
  const queryClient = useQueryClient();
  const [aviso, setAviso] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [telefono, setTelefono] = useState<string | null>(null);
  const [escribio, setEscribio] = useState(false);
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

  const enUso = l?.status === 'connected' || l?.status === 'connecting';
  // Si se vinculó mientras miraba (escaneó el QR o puso el código): chispas
  const recienVinculado = useRecien(l?.status === 'connected');
  const tarjeta = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (recienVinculado) lanzarChispas({ clientX: 0, clientY: 0, currentTarget: tarjeta.current });
  }, [recienVinculado]);
  const compara: [string, string][] = enUso
    ? []
    : [
        [t('Qué haces'), t('Escaneas un QR o escribes un código de 8 letras, como en WhatsApp Web.')],
        [t('Qué ve Luks'), t('Tus grupos, pero solo guarda los que conectes a una cuenta.')],
        [t('¿Responde en el grupo?'), t('No. Luks nunca escribe desde tu número: lo anotado lo ves en la app.')],
        [t('Lo de antes'), t('Lee desde que conectas el grupo. Lo anterior, con el chat exportado o pidiéndole una parte a WhatsApp (pronto).')],
        [t('Ideal si'), t('El grupo no deja agregar a nadie, o no quieren a alguien más en el grupo.')],
        [t('Ojo'), t('No es una conexión oficial de WhatsApp: podría restringir tu cuenta.')],
      ];

  let cuerpo: React.ReactNode;
  if (l?.status === 'connected') {
    cuerpo = (
      <div className="wa-vincular" ref={tarjeta}>
        <ConnectionStatus
          state={l.alive === false ? 'error' : 'conectado'}
          sub={
            l.alive === false
              ? t('sin señal: el servidor de Luks puede estar apagado')
              : l.connected_at
                ? t('desde el {dia}', { dia: dia(l.connected_at, t) })
                : undefined
          }
        >
          {l.stopping ? t('Desvinculando…') : `${t('Vinculado')}${l.phone ? ` (${formatear(l.phone)})` : ''}`}
        </ConnectionStatus>
        <p className="lu-small lu-muted" style={{ margin: 0 }}>
          {t('Luks lee los grupos que conectes desde «Tus grupos de WhatsApp» (o con «luks» y el código). Nunca escribe desde tu número.')}
        </p>
        <Link href="/grupos" className="lu-btn lu-btn--secondary lu-btn--sm">
          {t('Ver tus grupos de WhatsApp')}
        </Link>
        {!l.stopping && (
          <Button size="sm" variant="ghost" onClick={() => setCerrar(true)}>
            {t('Desvincular mi WhatsApp')}
          </Button>
        )}
        <ConfirmDialog open={cerrar} onOpenChange={setCerrar} title={t('¿Desvincular tu WhatsApp?')} confirmLabel={t('Desvincular')} onConfirm={desvincular}>
          {t('Luks deja de leer los grupos desde tu número. Si un grupo solo estaba conectado así, hay que agregar a Mister Luks o vincular otro WhatsApp.')}
        </ConfirmDialog>
      </div>
    );
  } else if (l?.status === 'connecting') {
    cuerpo = (
      <div className="wa-vincular" aria-live="polite">
        {l.code ? (
          <>
            <div className="wa-code lu-num">
              {l.code.slice(0, 4)}-{l.code.slice(4)}
            </div>
            <CopyButton text={l.code} label={t('Copiar código')} variant="primary" />
            <ol className="wa-howto lu-small">
              <li>
                {rico(t('Abre WhatsApp → {vinculados} → {vincular}.'), {
                  vinculados: <b>{t('Dispositivos vinculados')}</b>,
                  vincular: <b>{t('Vincular un dispositivo')}</b>,
                })}
              </li>
              <li>
                {rico(t('Abajo, toca {numero} (o abre la notificación que te manda WhatsApp).'), {
                  numero: <b>{t('Vincular con el número de teléfono')}</b>,
                })}
              </li>
              <li>{t('Escribe o pega el código.')}</li>
            </ol>
            <p className="lu-small lu-muted" style={{ margin: 0 }}>
              {t('El código cambia cada 2 o 3 minutos. Si WhatsApp dice que no sirve, vuelve aquí y usa el nuevo.')}
            </p>
          </>
        ) : (
          <p className="lu-small" style={{ margin: 0 }}>
            {rico(t('Desde otro celular o con la cámara de tu WhatsApp: {vinculados} → {vincular}, y escanea este código:'), {
              vinculados: <b>{t('Dispositivos vinculados')}</b>,
              vincular: <b>{t('Vincular un dispositivo')}</b>,
            })}
          </p>
        )}
        {l.code ? null : qrImg ? (
          // biome-ignore lint/performance/noImgElement: es un QR generado en el navegador, no una imagen para optimizar
          <img className="wa-qr" src={qrImg} alt={t('Código QR para vincular tu WhatsApp con Luks')} width={240} height={240} />
        ) : (
          <p className="lu-small lu-muted" style={{ margin: 0 }}>
            {t('Preparando el código…')} {l.alive === false ? t('Si no aparece en unos segundos, el servidor de Luks puede estar apagado.') : ''}
          </p>
        )}
        <Button size="sm" variant="ghost" onClick={desvincular}>
          {t('Cancelar')}
        </Button>
      </div>
    );
  } else {
    cuerpo = (
      <>
        {otrosLectores.length > 0 && (
          <p className="lu-small lu-muted" style={{ margin: 0 }}>
            {otrosLectores.length > 1
              ? t('Ya lo tienen vinculado {nombres}: si alguno está en el grupo, no hace falta nada más.', { nombres: listaNombres(otrosLectores, t) })
              : t('Ya lo tiene vinculado {nombres}: si está en el grupo, no hace falta nada más.', { nombres: listaNombres(otrosLectores, t) })}
          </p>
        )}
        {l?.status === 'disconnected' && l.disconnect_reason && (
          <p className="lu-small lu-muted" style={{ margin: 0 }}>
            {t('La última vez: {razon}', { razon: t(l.disconnect_reason) })}
          </p>
        )}
        {abierto ? (
          <>
            <label className="lu-label" htmlFor="wa-numero">
              {t('Tu número de WhatsApp')}
            </label>
            <CampoTelefono
              id="wa-numero"
              describedBy="wa-numero-ayuda"
              onNumero={(n, e) => {
                setTelefono(n);
                setEscribio(e);
              }}
            />
            <p className="lu-small lu-muted" id="wa-numero-ayuda" style={{ margin: 0 }}>
              {escribio && !telefono
                ? t('Escribe el número completo. Si es de otro país, elígelo primero (o escríbelo con + y su indicativo).')
                : telefono
                  ? t('Te damos un código de 8 letras para {numero}: sirve desde este mismo celular.', { numero: formatear(telefono) ?? telefono })
                  : t('Desde este celular: escribe tu número y te damos un código de 8 letras. Desde un computador: usa el QR.')}
            </p>
            <div className="wa-row">
              <Button size="sm" onClick={() => pedir(true)} disabled={!telefono}>
                {t('Pedir código')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => pedir(false)}>
                {t('Mostrar QR')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAbierto(false)}>
                {t('Cancelar')}
              </Button>
            </div>
          </>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setAviso(true)}>
            {t('Vincular mi WhatsApp')}
          </Button>
        )}
        {/* Antes de vincular, el riesgo: no es una conexión oficial */}
        <ConfirmDialog
          open={aviso}
          onOpenChange={setAviso}
          title={t('Antes de vincular tu WhatsApp')}
          confirmLabel={t('Entiendo, vincular')}
          danger={false}
          onConfirm={() => {
            setAviso(false);
            setAbierto(true);
          }}
        >
          {t(
            'Luks entra como un dispositivo vinculado más, igual que WhatsApp Web, pero no es una conexión oficial de WhatsApp: WhatsApp podría restringir tu cuenta. Luks nunca escribe desde tu número y de tus grupos solo guarda los que conectes a una cuenta.',
          )}
        </ConfirmDialog>
      </>
    );
  }

  return (
    <Forma
      id="wa-mio"
      titulo={t('Vincular mi WhatsApp')}
      resumen={t('Luks lee el grupo desde tu WhatsApp, como un WhatsApp Web más. No hay que agregar a nadie.')}
      dibujo={
        l?.status === 'connected' ? (
          <LottieSlot key="vinculado" name="whatsapp-conectado" width={64} height={64} label="" />
        ) : (
          <LottieSlot key="vincular" name="vincular-whatsapp" width={88} height={88} label="" alVerse />
        )
      }
      dibujoAncho={l?.status !== 'connected'}
      compara={compara}
    >
      {cuerpo}
      {error && (
        <p className="lu-error" role="alert">
          {error}
        </p>
      )}
    </Forma>
  );
}
