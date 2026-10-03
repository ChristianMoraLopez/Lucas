import Link from 'next/link';
import { LottieSlot } from '@/components/lucas-ui';

/**
 * La tarjeta grande del Resumen mientras la cuenta no tiene grupo de WhatsApp.
 * Es lo primero que hay que hacer: sin el grupo, Luks no se entera de nada.
 */
export function WhatsappHero({ accountId }: { accountId: string }) {
  return (
    <section className="wa-hero" aria-labelledby="wa-hero-t">
      <div className="wa-hero__txt">
        <span className="wa-hero__kicker">El motor de Luks</span>
        <h2 id="wa-hero-t" className="lu-title">
          Conecta el grupo de WhatsApp
        </h2>
        <p className="lu-small" style={{ margin: 0 }}>
          Lo que manden al grupo, fotos de recibos, PDFs o «almuerzo 45 lucas, pagó Mafe», se anota solo. Y la gente del grupo queda en la cuenta.
        </p>
        <ol className="wa-hero__steps lu-small">
          <li>Luks entra al grupo, o lee desde tu WhatsApp</li>
          <li>Escriben «luks» y el código de la cuenta</li>
          <li>Listo: todo llega a Revisar</li>
        </ol>
        <Link href={`/c/${accountId}/whatsapp`} className="lu-btn lu-btn--primary">
          Conectar ahora
        </Link>
      </div>
      <LottieSlot name="conectando-whatsapp" width={112} height={112} />
    </section>
  );
}
