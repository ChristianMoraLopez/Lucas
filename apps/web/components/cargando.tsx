import { LottieSlot } from '@/components/lucas-ui';

/** «Cargando…» con la pila de monedas; el texto queda para lectores de pantalla y sin animación. */
export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div className="lu-cargando" role="status">
      <LottieSlot name="cargando" width={56} height={56} label={texto} />
      <span className="lu-small lu-muted">{texto}</span>
    </div>
  );
}
