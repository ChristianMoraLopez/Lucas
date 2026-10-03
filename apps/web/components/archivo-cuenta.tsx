'use client';

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Button, ICONS, LottieSlot } from '@/components/lucas-ui';
import { borrarCuenta, nombreCoincide } from '@/lib/borrar-cuenta';
import { humanError } from '@/lib/errors';
import { plural } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

/* Una cuenta cerrada se archiva (sale del inicio de quien la archiva, con
   todo guardado) o se borra del todo (solo el titular, para todos). */

async function cambiarArchivo(accountId: string, archivar: boolean) {
  const { error } = await createClient().rpc('set_account_archived', { p_account_id: accountId, p_archived: archivar });
  if (error) throw error;
}

/**
 * Al final de una cuenta cerrada (Liquidar): archivarla, sacarla del archivo y,
 * si es del titular, borrarla del todo. Al archivar, la caja se cierra.
 */
export function FinDeCuenta({ accountId, accountName, archivada, titular }: { accountId: string; accountName: string; archivada: boolean; titular: boolean }) {
  const router = useRouter();
  const [estado, setEstado] = useState<'quieto' | 'archivando' | 'archivada' | 'sacando'>('quieto');
  const [error, setError] = useState<string | null>(null);
  const yaArchivada = archivada || estado === 'archivada';

  const archivar = async (si: boolean) => {
    setError(null);
    setEstado(si ? 'archivando' : 'sacando');
    try {
      await cambiarArchivo(accountId, si);
      setEstado(si ? 'archivada' : 'quieto');
      router.refresh();
    } catch (e) {
      setEstado('quieto');
      setError(humanError(e as { message?: string }));
    }
  };

  return (
    <div className="fa">
      {estado === 'archivada' ? (
        <div className="fa-listo" role="status">
          <LottieSlot name="archivar" width={84} height={84} label="" />
          <div>
            <b>Archivada.</b> Ya no sale en tu inicio: la encuentras abajo, en «Archivadas», con todo guardado.
            <div className="fa-acts">
              <Link href="/" className="lu-btn lu-btn--sm lu-btn--primary">
                Ir al inicio
              </Link>
              <Button size="sm" variant="ghost" onClick={() => archivar(false)}>
                Deshacer
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="fa-acts">
          {yaArchivada ? (
            <Button size="sm" variant="secondary" className="fa-boton" onClick={() => archivar(false)} disabled={estado !== 'quieto'}>
              {ICONS.desarchivar}
              {estado === 'sacando' ? 'Sacando…' : 'Sacar del archivo'}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" className="fa-boton" onClick={() => archivar(true)} disabled={estado !== 'quieto'}>
              {ICONS.archivo}
              {estado === 'archivando' ? 'Archivando…' : 'Archivar'}
            </Button>
          )}
          {titular && <BorrarCuenta accountId={accountId} accountName={accountName} />}
        </div>
      )}
      {!yaArchivada && estado === 'quieto' && (
        <p className="lu-small lu-muted fa-nota">Archivarla la quita de tu inicio sin borrar nada. Los demás la siguen viendo.</p>
      )}
      {error && (
        <p className="lu-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * «Borrar del todo…»: pide escribir el nombre de la cuenta; borra las fotos y
 * los PDF (con su avance) y después la cuenta. La papelera se abre al confirmar.
 */
export function BorrarCuenta({ accountId, accountName, compacto = false }: { accountId: string; accountName: string; compacto?: boolean }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [escrito, setEscrito] = useState('');
  const [fase, setFase] = useState<'pregunta' | 'borrando' | 'listo'>('pregunta');
  const [avance, setAvance] = useState<{ hechos: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vuelta, setVuelta] = useState(0);
  const coincide = nombreCoincide(escrito, accountName);
  const reloj = useRef<number | null>(null);
  useEffect(() => () => window.clearTimeout(reloj.current ?? undefined), []);

  const borrar = async () => {
    if (!coincide || fase !== 'pregunta') return;
    setError(null);
    setFase('borrando');
    setVuelta((v) => v + 1); // la papelera vuelve a abrirse
    try {
      await borrarCuenta(createClient(), accountId, escrito, (hechos, total) => setAvance({ hechos, total }));
      setFase('listo');
      setVuelta((v) => v + 1);
      reloj.current = window.setTimeout(() => {
        router.replace('/');
        router.refresh();
      }, 1900);
    } catch (e) {
      setFase('pregunta');
      setError(humanError(e as { message?: string }));
    }
  };

  const cerrar = (open: boolean) => {
    if (fase !== 'pregunta') return; // mientras borra no se cierra
    setAbierto(open);
    if (!open) {
      setEscrito('');
      setError(null);
      setAvance(null);
    }
  };

  let texto: ReactNode;
  if (fase === 'listo') texto = <b>Listo: «{accountName}» se borró.</b>;
  else if (fase === 'borrando')
    texto =
      avance && avance.total > 0 && avance.hechos < avance.total
        ? `Borrando fotos y PDF… ${avance.hechos} de ${avance.total}`
        : avance && avance.hechos >= avance.total
          ? 'Borrando la cuenta…'
          : 'Buscando las fotos y los PDF…';

  return (
    <AlertDialog.Root open={abierto} onOpenChange={cerrar}>
      <AlertDialog.Trigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className={compacto ? 'fa-borrar fa-borrar--compacto' : 'fa-borrar'}
          aria-label={compacto ? `Borrar «${accountName}» del todo` : undefined}
        >
          {ICONS.basura}
          {compacto ? null : 'Borrar del todo…'}
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="lu-dialog__overlay" />
        <AlertDialog.Content className="lu-dialog fb" aria-busy={fase === 'borrando'}>
          <span className="fb-lottie" aria-hidden="true">
            <LottieSlot key={vuelta} name="borrar" width={92} height={92} label="" />
          </span>
          <AlertDialog.Title className="lu-title">{fase === 'listo' ? 'Borrada' : `¿Borrar «${accountName}» del todo?`}</AlertDialog.Title>
          {fase === 'pregunta' ? (
            <>
              <AlertDialog.Description className="lu-dialog__text" asChild>
                <div>
                  Se borra para todos y no se puede deshacer: los gastos, las fotos y los PDF, la liquidación, las personas y el link público. Luks deja de leer
                  su grupo de WhatsApp.
                  <span className="fb-alt">Si solo quieres que no salga en tu inicio, mejor archívala.</span>
                </div>
              </AlertDialog.Description>
              <label className="lu-label" htmlFor={`borrar-${accountId}`}>
                Para confirmar, escribe <b>{accountName}</b>
              </label>
              <input
                id={`borrar-${accountId}`}
                className="fb-input"
                value={escrito}
                onChange={(e) => setEscrito(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && borrar()}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={accountName}
              />
              {error && (
                <p className="lu-field-error" role="alert">
                  {error}
                </p>
              )}
              <div className="lu-dialog__btns">
                <AlertDialog.Cancel asChild>
                  <Button variant="secondary" size="sm">
                    Cancelar
                  </Button>
                </AlertDialog.Cancel>
                <Button size="sm" variant="secondary" className="lu-btn--danger" disabled={!coincide} onClick={borrar}>
                  Borrar para siempre
                </Button>
              </div>
            </>
          ) : (
            <AlertDialog.Description className="lu-dialog__text fb-estado" role="status">
              {texto}
              {fase === 'borrando' && avance && avance.total > 0 && (
                <span className="fb-barra" aria-hidden="true">
                  <span className="fb-barra__lleno" style={{ width: `${Math.round((avance.hechos / avance.total) * 100)}%` }} />
                </span>
              )}
              {fase === 'listo' && <span className="lu-small lu-muted">Volviendo al inicio…</span>}
            </AlertDialog.Description>
          )}
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/**
 * Una fila del inicio con su botón de archivar (o de sacar del archivo). Al
 * tocarlo, la fila se va hacia la caja antes de que la lista se actualice.
 */
export function FilaArchivable({
  accountId,
  accountName,
  archivada,
  titular,
  orden,
  children,
}: {
  accountId: string;
  accountName: string;
  archivada: boolean;
  titular: boolean;
  /** Su lugar en la lista (entran escalonadas) */
  orden?: number;
  children: ReactNode;
}) {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mover = async () => {
    setError(null);
    setSaliendo(true);
    const espera = new Promise((r) => window.setTimeout(r, 260));
    try {
      await Promise.all([cambiarArchivo(accountId, !archivada), espera]);
      router.refresh();
    } catch (e) {
      setSaliendo(false);
      setError(humanError(e as { message?: string }));
    }
  };

  const etiqueta = archivada ? `Sacar «${accountName}» del archivo` : `Archivar «${accountName}»`;
  return (
    <div
      className={`ap-fila${saliendo ? (archivada ? ' is-volviendo' : ' is-archivando') : ''}`}
      style={orden == null ? undefined : ({ '--i': orden } as React.CSSProperties)}
    >
      {children}
      <span className="ap-fila__acts">
        <button type="button" className="ap-fila__btn" onClick={mover} disabled={saliendo} aria-label={etiqueta} title={etiqueta}>
          {archivada ? ICONS.desarchivar : ICONS.archivo}
        </button>
        {archivada && titular && <BorrarCuenta accountId={accountId} accountName={accountName} compacto />}
      </span>
      {error && (
        <p className="lu-field-error ap-fila__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** «Archivadas · 3»: se abre para verlas. La caja se cierra cada vez que llega una. */
export function Archivadas({ cantidad, children }: { cantidad: number; children: ReactNode }) {
  return (
    <details className="ap-archivo">
      <summary>
        <span className="ap-archivo__caja" aria-hidden="true">
          <LottieSlot key={cantidad} name="archivar" width={34} height={34} label="" alVerse />
        </span>
        <span className="lu-label">Archivadas</span>
        <span className="ap-archivo__n">{plural(cantidad, 'cuenta', 'cuentas')}</span>
      </summary>
      <div className="ap-archivo__lista">{children}</div>
    </details>
  );
}
