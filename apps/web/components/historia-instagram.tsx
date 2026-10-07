'use client';

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useEffect, useState } from 'react';
import { lanzarChispas } from '@/components/chispas';
import { useT } from '@/components/idioma';
import { Button, ICONS } from '@/components/lucas-ui';
import { copiar } from '@/lib/clipboard';
import { rico } from '@/lib/i18n/rico';

/* Compartir en una historia de Instagram. Instagram no recibe historias desde
   una página: se arma la imagen vertical y se abre el menú de compartir del
   celular (ahí sale «Historia»); donde no se puede (computador), se descarga.
   El link se copia para pegarlo en el sticker de enlace. */

type Estado = 'quieto' | 'compartida' | 'descargada' | 'error';

/** ¿El navegador comparte archivos? (celulares sí; la mayoría de computadores no) */
function useCompartirArchivos() {
  const [puede, setPuede] = useState(false);
  useEffect(() => {
    try {
      const prueba = new File([new Blob(['x'], { type: 'image/png' })], 'prueba.png', { type: 'image/png' });
      setPuede(typeof navigator.share === 'function' && Boolean(navigator.canShare?.({ files: [prueba] })));
    } catch {
      setPuede(false);
    }
  }, []);
  return puede;
}

export function HistoriaInstagram({
  src,
  archivo,
  enlace,
  textoEnlace,
  variante = 'secondary',
}: {
  /** La imagen 1080×1920 (/historia o /r/TOKEN/historia) */
  src: string;
  /** Nombre del archivo al compartir o descargar */
  archivo: string;
  /** Lo que se copia para el sticker de enlace */
  enlace: string;
  /** Cómo se muestra el enlace (sin https://) */
  textoEnlace: string;
  variante?: 'primary' | 'secondary';
}) {
  const t = useT();
  const [abierto, setAbierto] = useState(false);
  const [imagen, setImagen] = useState<File | null>(null);
  const [cargada, setCargada] = useState(false);
  const [estado, setEstado] = useState<Estado>('quieto');
  const [copiado, setCopiado] = useState(false);
  const compartirArchivos = useCompartirArchivos();

  // Se baja al abrir: así, al tocar «Compartir», el menú abre al instante (si tarda, el celular no lo deja abrir)
  useEffect(() => {
    if (!abierto || imagen) return;
    let vivo = true;
    fetch(src)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => vivo && setImagen(new File([b], archivo, { type: b.type || 'image/png' })))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [abierto, imagen, src, archivo]);

  const copiarEnlace = async () => setCopiado(await copiar(enlace));

  const descargar = () => {
    const a = document.createElement('a');
    const url = imagen ? URL.createObjectURL(imagen) : src;
    a.href = url;
    a.download = archivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (imagen) window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    void copiarEnlace();
    setEstado('descargada');
  };

  const compartir = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const donde = { clientX: e.clientX, clientY: e.clientY, currentTarget: e.currentTarget };
    if (!imagen) return descargar();
    void copiarEnlace();
    try {
      await navigator.share({ files: [imagen] });
      setEstado('compartida');
      lanzarChispas(donde);
    } catch (err) {
      // Cerraron el menú sin elegir: no pasa nada
      if ((err as Error).name === 'AbortError') return;
      descargar();
    }
  };

  const cerrar = (open: boolean) => {
    setAbierto(open);
    if (!open) setEstado('quieto');
  };

  return (
    <AlertDialog.Root open={abierto} onOpenChange={cerrar}>
      <AlertDialog.Trigger asChild>
        <Button size="sm" variant={variante} className="hi-boton">
          {ICONS.instagram}
          {t('Historia de Instagram')}
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="lu-dialog__overlay" />
        <AlertDialog.Content className="lu-dialog hi">
          <AlertDialog.Title className="lu-title">{t('Para tu historia')}</AlertDialog.Title>
          <div className={`hi-vista${cargada ? ' is-lista' : ''}`}>
            {/* biome-ignore lint/performance/noImgElement: imagen generada en el servidor (next/og), sin optimizar */}
            <img src={src} alt={t('Vista previa de la historia')} width={1080} height={1920} onLoad={() => setCargada(true)} />
          </div>
          <AlertDialog.Description className="lu-dialog__text hi-texto">
            {compartirArchivos
              ? rico(t('Toca {compartir} y elige Instagram → {historia}. Luego agrega el sticker de enlace y pega {enlace}.'), {
                  compartir: <b>{t('Compartir')}</b>,
                  historia: <b>{t('Historia')}</b>,
                  enlace: <b>{textoEnlace}</b>,
                })
              : rico(t('Descárgala, pásala al celular y súbela a tu historia. Agrega el sticker de enlace con {enlace}.'), {
                  enlace: <b>{textoEnlace}</b>,
                })}
          </AlertDialog.Description>
          {estado !== 'quieto' && (
            <p className="hi-listo" role="status">
              {estado === 'compartida' ? t('¡Lista para tu historia!') : t('Se descargó la imagen.')}
              {copiado ? ` ${t('Copiamos {enlace} para el sticker.', { enlace: textoEnlace })}` : ''}
            </p>
          )}
          <div className="lu-dialog__btns hi-btns">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost" size="sm">
                {t('Cerrar')}
              </Button>
            </AlertDialog.Cancel>
            {compartirArchivos && (
              <Button variant="secondary" size="sm" onClick={descargar}>
                {t('Descargar')}
              </Button>
            )}
            <Button size="sm" onClick={compartirArchivos ? compartir : descargar} disabled={compartirArchivos && !imagen}>
              {compartirArchivos ? (imagen ? t('Compartir') : t('Preparando…')) : t('Descargar imagen')}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
