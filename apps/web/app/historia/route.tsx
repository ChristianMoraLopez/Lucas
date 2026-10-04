import { historiaLuks } from '@/lib/imagen-historia';

/* La historia de Instagram para recomendar Luks (1080×1920). Es la misma para todos. */
export async function GET() {
  return historiaLuks({ cache: 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400' });
}
