/* Compresión de fotos en el navegador antes de subirlas a Storage: el plan
   gratuito de Supabase tiene poco espacio, y una foto de celular de 4 MB baja
   a ~200–400 KB sin perder lo que el OCR necesita leer. */

export const MAX_SIDE = 1600;
export const MAX_PDF_BYTES = 6 * 1024 * 1024;

/** Medidas finales: el lado largo queda en `max` como mucho, sin agrandar. */
export function fitWithin(width: number, height: number, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Extensión según el tipo que de verdad quedó (Safari no sabe escribir WebP). */
export function extensionFor(mime: string) {
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/png') return 'png';
  if (mime === 'application/pdf') return 'pdf';
  return 'jpg';
}

/** Ruta en el bucket: {cuenta}/{AAAA-MM}/{uuid}.{ext}. La primera carpeta es la cuenta (así lo exige RLS). */
export function evidencePath(accountId: string, ext: string, now = new Date(), id = crypto.randomUUID()) {
  const mes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `${accountId}/${mes}/${id}.${ext}`;
}

/**
 * Reduce la foto a 1600 px de lado y la guarda en WebP (calidad media); si el
 * navegador no sabe hacer WebP, en JPEG. Respeta la orientación de la cámara.
 */
export async function compressImage(file: File, max = MAX_SIDE): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { width, height } = fitWithin(bitmap.width, bitmap.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Tu navegador no pudo procesar la foto');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const toBlob = (type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const webp = await toBlob('image/webp', 0.72);
  if (webp && webp.type === 'image/webp') return webp;
  const jpeg = await toBlob('image/jpeg', 0.75);
  if (!jpeg) throw new Error('Tu navegador no pudo comprimir la foto');
  return jpeg;
}
