'use client';

import { useEffect, useState } from 'react';
import { Button, ICONS, LottieSlot } from '@/components/lucas-ui';
import { copiar } from '@/lib/clipboard';
import { whatsappUrl } from '@/lib/invite';
import { recomendacionMessage } from '@/lib/share';

/**
 * «Recomienda Luks»: el link de mrluks.com con un mensaje listo, por WhatsApp,
 * copiado o con el menú de compartir del celular.
 */
export function RecomendarLuks() {
  const { texto, url } = recomendacionMessage();
  const [copiado, setCopiado] = useState<'si' | 'no' | null>(null);
  // El menú de compartir del sistema solo existe en el navegador (y no en todos)
  const [nativo, setNativo] = useState(false);
  useEffect(() => setNativo(typeof navigator !== 'undefined' && typeof navigator.share === 'function'), []);

  const compartir = async () => {
    try {
      await navigator.share({ title: 'Luks', text: texto, url });
    } catch {
      // Lo cerraron sin compartir: no pasa nada
    }
  };

  return (
    <section className="ap-share" aria-labelledby="ap-share-t">
      <span className="ap-share__lottie" aria-hidden="true">
        <LottieSlot name="transferencia" width={72} height={72} label="" alVerse />
      </span>
      <span className="ap-share__url">mrluks.com</span>
      <h2 id="ap-share-t" className="lu-title" style={{ margin: 0 }}>
        ¿A quién le sirve Luks?
      </h2>
      <p className="lu-small" style={{ margin: 0 }}>
        Al amigo que siempre termina haciendo las cuentas del paseo, a los roomies, a la familia. Mándales Luks: es gratis.
      </p>
      <div className="ap-share__acts">
        <a className="lu-btn lu-btn--sm lu-btn--primary ap-share__wa" href={whatsappUrl(texto)} target="_blank" rel="noreferrer">
          {ICONS.whatsapp}
          Mandar por WhatsApp
        </a>
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            setCopiado((await copiar(url)) ? 'si' : 'no');
            setTimeout(() => setCopiado(null), 2200);
          }}
        >
          {copiado === 'si' ? '¡Link copiado!' : copiado === 'no' ? 'Cópialo: mrluks.com' : 'Copiar link'}
        </Button>
        {nativo && (
          <Button size="sm" variant="ghost" onClick={compartir}>
            Más opciones
          </Button>
        )}
      </div>
    </section>
  );
}
