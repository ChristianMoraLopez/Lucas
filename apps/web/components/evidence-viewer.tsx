'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Avatar, type Tone } from '@/components/lucas-ui';
import { PhotoViewer } from '@/components/photo-viewer';
import type { MessageKind } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

const KIND_TEXT: Record<MessageKind, string> = { photo: 'mandó una foto', pdf: 'mandó un PDF', text: 'escribió' };

/**
 * La evidencia de un gasto tal como llegó: foto (se abre a pantalla completa), PDF o mensaje.
 * Mismo marco que Evidence del kit (clases lu-evi); los archivos salen del
 * bucket privado con una URL firmada que vence en una hora.
 */
export function EvidenceViewer({
  kind,
  path,
  text,
  fileName,
  sender,
  senderTone,
  when,
  source,
}: {
  kind: MessageKind | null;
  path: string | null;
  text: string | null;
  fileName: string | null;
  sender: string;
  senderTone?: Tone;
  when: string;
  source: 'whatsapp' | 'web' | 'import';
}) {
  const [supabase] = useState(() => createClient());
  const signed = useQuery({
    queryKey: ['evidencia', path],
    enabled: Boolean(path),
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('evidencias').createSignedUrl(path as string, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
  });

  const efectivo = kind ?? (path ? (path.endsWith('.pdf') ? 'pdf' : 'photo') : 'text');

  return (
    <figure className="lu-evi">
      <figcaption className="lu-evi__from">
        <Avatar name={sender} tone={senderTone} size="sm" />
        <span style={{ display: 'grid' }}>
          <b>{sender}</b>
          <span>
            {KIND_TEXT[efectivo]} · {when} · {source === 'whatsapp' ? 'por WhatsApp' : 'desde la web'}
          </span>
        </span>
      </figcaption>

      {efectivo === 'text' && (
        <div className="lu-evi__chat">
          <div className="lu-evi__msg lu-evi__msg--target" style={{ '--c': 'var(--morado)' } as React.CSSProperties}>
            <span className="who">{sender}</span>
            {text || 'Sin texto'}
          </div>
        </div>
      )}

      {efectivo === 'photo' &&
        (signed.data ? (
          <PhotoPreview src={signed.data} />
        ) : (
          <div className="lu-evi__photo ev-missing">
            <span>{signed.isError ? 'La foto no está disponible' : 'Cargando la foto…'}</span>
          </div>
        ))}

      {efectivo === 'pdf' && (
        <div className="lu-evi__pdf">
          {signed.data ? (
            <object data={signed.data} type="application/pdf" className="ev-pdf" aria-label={fileName ?? 'PDF'}>
              <p className="lu-small lu-muted">Tu navegador no muestra el PDF aquí.</p>
            </object>
          ) : (
            <p className="lu-small lu-muted" style={{ margin: 0 }}>
              {signed.isError ? 'El PDF no está disponible' : 'Cargando el PDF…'}
            </p>
          )}
          <div className="lu-evi__file">
            <span>{fileName ?? 'documento.pdf'}</span>
            {signed.data && (
              <a href={signed.data} target="_blank" rel="noreferrer" className="ev-open">
                Abrir
              </a>
            )}
          </div>
        </div>
      )}
    </figure>
  );
}

/** La foto entera en su recuadro; al tocarla se abre a pantalla completa (PhotoViewer). */
function PhotoPreview({ src }: { src: string }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <>
      <button type="button" className="lu-evi__photo ev-photo" onClick={() => setAbierta(true)} aria-label="Ver la foto del recibo completa">
        {/* biome-ignore lint/performance/noImgElement: URL firmada de Storage que vence; next/image no aporta aquí */}
        <img src={src} alt="Foto del recibo" draggable={false} />
        <span className="ev-hint">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
          Ver completa
        </span>
      </button>
      {abierta && <PhotoViewer src={src} alt="Foto del recibo" onClose={() => setAbierta(false)} />}
    </>
  );
}
