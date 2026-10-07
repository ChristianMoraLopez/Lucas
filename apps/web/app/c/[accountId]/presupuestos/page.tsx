import { getT } from '@/lib/i18n/server';
import { PlaceholderTab } from '../placeholder';

export default async function PresupuestosPage() {
  const t = await getT();
  return <PlaceholderTab title={t('Próximamente')} text={t('Aquí van los presupuestos por categoría para que la plata del mes alcance.')} />;
}
