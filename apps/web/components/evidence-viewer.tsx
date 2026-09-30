'use client';

import { useQuery } from '@tanstack/react-query';
import { type PointerEvent, useState } from 'react';
import { Avatar, type Tone } from '@/components/lucas-ui';
import type { MessageKind } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

const KIND_TEXT: Record<MessageKind, string> = { photo: 'mandó una foto', pdf: 'mandó un PDF', text: 'escribió' };

/**
 * La evidencia de un gasto tal como llegó: foto (con zoom), PDF o mensaje.
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
          <ZoomPhoto src={signed.data} />
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

/** Foto con zoom: un toque acerca al punto tocado y moverse recorre la foto. */
function ZoomPhoto({ src }: { src: string }) {
  const [zoom, setZoom] = useState(false);
  const [origin, setOrigin] = useState('50% 50%');

  const follow = (e: PointerEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    setOrigin(`${Math.min(100, Math.max(0, x))}% ${Math.min(100, Math.max(0, y))}%`);
  };

  return (
    <button
      type="button"
      className={`lu-evi__photo ev-photo${zoom ? ' is-zoom' : ''}`}
      onClick={(e) => {
        follow(e as unknown as PointerEvent<HTMLButtonElement>);
        setZoom((z) => !z);
      }}
      onPointerMove={(e) => zoom && follow(e)}
      aria-label={zoom ? 'Alejar la foto' : 'Acercar la foto'}
    >
      {/* biome-ignore lint/performance/noImgElement: URL firmada de Storage que vence; next/image no aporta aquí */}
      <img src={src} alt="Foto del recibo" style={{ transformOrigin: origin }} draggable={false} />
      <span className="ev-hint">{zoom ? 'Toca para alejar' : 'Toca para acercar'}</span>
    </button>
  );
}
