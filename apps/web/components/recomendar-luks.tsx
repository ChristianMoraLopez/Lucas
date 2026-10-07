'use client';

import { useEffect, useState } from 'react';
import { HistoriaInstagram } from '@/components/historia-instagram';
import { useT } from '@/components/idioma';
import { Button, ICONS, LottieSlot } from '@/components/lucas-ui';
import { copiar } from '@/lib/clipboard';
import { whatsappUrl } from '@/lib/invite';
import { recomendacionMessage } from '@/lib/share';

/**
 * «Recomienda Luks»: el link de mrluks.com con un mensaje listo, por WhatsApp,
 * copiado o con el menú de compartir del celular.
 */
export function RecomendarLuks() {
  const t = useT();
  const { texto, url } = recomendacionMessage(t);
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
        {t('¿A quién le sirve Luks?')}
      </h2>
      <p className="lu-small" style={{ margin: 0 }}>
        {t(
          'Al amigo que siempre termina haciendo las cuentas del paseo, a los roomies, a la familia. Y a quien quiera ordenar sus gastos: un grupo de WhatsApp consigo mismo, donde se manda sus facturas, y Luks las organiza por categoría. Mándales Luks: es gratis.',
        )}
      </p>
      <div className="ap-share__acts">
        <a className="lu-btn lu-btn--sm lu-btn--primary ap-share__wa" href={whatsappUrl(texto)} target="_blank" rel="noreferrer">
          {ICONS.whatsapp}
          {t('Mandar por WhatsApp')}
        </a>
        <HistoriaInstagram src="/historia" archivo="luks-historia.png" enlace={url} textoEnlace="mrluks.com" />
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            setCopiado((await copiar(url)) ? 'si' : 'no');
            setTimeout(() => setCopiado(null), 2200);
          }}
        >
          {copiado === 'si' ? t('¡Link copiado!') : copiado === 'no' ? t('Cópialo: {link}', { link: 'mrluks.com' }) : t('Copiar link')}
        </Button>
        {nativo && (
          <Button size="sm" variant="ghost" onClick={compartir}>
            {t('Más opciones')}
          </Button>
        )}
      </div>
    </section>
  );
}
