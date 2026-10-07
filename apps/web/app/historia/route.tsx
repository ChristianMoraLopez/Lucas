import { getT } from '@/lib/i18n/server';
import { historiaLuks } from '@/lib/imagen-historia';

/* La historia de Instagram para recomendar Luks (1080×1920), en el idioma de quien la pide. */
export async function GET() {
  // Varía con la cookie del idioma: se guarda solo en el navegador de cada quien
  return historiaLuks({ t: await getT(), cache: 'private, max-age=86400' });
}
