'use client';

import Link from 'next/link';
import { useT } from '@/components/idioma';
import { LottieSlot } from '@/components/lucas-ui';

/**
 * La tarjeta grande del Resumen mientras la cuenta no tiene grupo de WhatsApp.
 * Es lo primero que hay que hacer: sin el grupo, Luks no se entera de nada.
 */
export function WhatsappHero({ accountId }: { accountId: string }) {
  const t = useT();
  return (
    <section className="wa-hero" aria-labelledby="wa-hero-t">
      <div className="wa-hero__txt">
        <span className="wa-hero__kicker">{t('El motor de Luks')}</span>
        <h2 id="wa-hero-t" className="lu-title">
          {t('Conecta el grupo de WhatsApp')}
        </h2>
        <p className="lu-small" style={{ margin: 0 }}>
          {t('Lo que manden al grupo, fotos de recibos, PDFs o «almuerzo 45 lucas, pagó Mafe», se anota solo. Y la gente del grupo queda en la cuenta.')}
        </p>
        <ol className="wa-hero__steps lu-small">
          <li>{t('Luks entra al grupo, o lee desde tu WhatsApp')}</li>
          <li>{t('Escriben «luks» y el código de la cuenta')}</li>
          <li>{t('Listo: todo llega a Revisar')}</li>
        </ol>
        <Link href={`/c/${accountId}/whatsapp`} className="lu-btn lu-btn--primary">
          {t('Conectar ahora')}
        </Link>
      </div>
      <LottieSlot name="conectando-whatsapp" width={112} height={112} />
    </section>
  );
}
