import sharp from 'sharp';
import type { MediaKind } from './connector.js';

/* Lo que se sube a Storage: fotos comprimidas a JPEG (~1600 px, como hace la
   web) y PDFs tal cual. El bucket «evidencias» acepta hasta 6 MB. */

export class MediaRejected extends Error {}

export interface PreparedMedia {
  body: Buffer;
  contentType: 'image/jpeg' | 'application/pdf';
  ext: 'jpg' | 'pdf';
}

export interface MediaLimits {
  maxUploadBytes: number;
  maxSide: number;
  jpegQuality: number;
}

export async function prepareMedia(kind: MediaKind, raw: Buffer, limits: MediaLimits): Promise<PreparedMedia> {
  if (kind === 'pdf') {
    if (raw.subarray(0, 5).toString('latin1') !== '%PDF-') throw new MediaRejected('El archivo no es un PDF');
    if (raw.length > limits.maxUploadBytes)
      throw new MediaRejected(`El PDF pesa ${(raw.length / 1048576).toFixed(1)} MB (máximo ${limits.maxUploadBytes / 1048576} MB)`);
    return { body: raw, contentType: 'application/pdf', ext: 'pdf' };
  }

  let quality = limits.jpegQuality;
  let side = limits.maxSide;
  // Casi siempre basta una pasada; si una foto rara queda pesada, se baja la calidad
  for (let intento = 0; intento < 3; intento++) {
    let body: Buffer;
    try {
      body = await sharp(raw, { failOn: 'error', limitInputPixels: 80_000_000 })
        .rotate() // respeta la orientación de la cámara
        .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
    } catch (e) {
      throw new MediaRejected(`No se pudo leer la imagen: ${(e as Error).message}`);
    }
    if (body.length <= limits.maxUploadBytes) return { body, contentType: 'image/jpeg', ext: 'jpg' };
    quality = Math.max(50, quality - 15);
    side = Math.round(side * 0.8);
  }
  throw new MediaRejected('La imagen quedó demasiado pesada aun comprimida');
}
