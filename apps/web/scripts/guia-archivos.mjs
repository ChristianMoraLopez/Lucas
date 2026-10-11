/*
 * La guía de Mister Luks en imagen vertical y en PDF, en español e inglés,
 * sacadas de la página /guia: public/guia/luks-guia-{es,en}.{png,pdf}.
 * Mister Luks las manda por WhatsApp (la imagen se ve sin abrir nada).
 *
 * Necesita la web corriendo y Chrome o Edge instalados (playwright-core usa
 * el navegador del sistema; CHROME_PATH para otro):
 *
 *   pnpm --filter web build && pnpm --filter web start
 *   node apps/web/scripts/guia-archivos.mjs [http://localhost:3000]
 *
 * Se vuelve a correr cuando cambia el texto de app/guia/page.tsx.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const BASE = (process.argv[2] ?? process.env.GUIA_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const SALIDA = join(import.meta.dirname, '..', 'public', 'guia');
const IDIOMAS = ['es', 'en'];

// Lo que no es de la guía: el aviso de conexión lenta y, en desarrollo, el botón de Next
const SIN_RUIDO = 'nextjs-portal, .lu-red, .lu-navbar { display: none !important; }';

async function navegador() {
  if (process.env.CHROME_PATH) return chromium.launch({ executablePath: process.env.CHROME_PATH });
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel });
    } catch {
      // se prueba el siguiente
    }
  }
  throw new Error('No encontré Chrome ni Edge. Instala uno o indica cuál con CHROME_PATH.');
}

async function abrir(browser, ruta, opciones) {
  // Tema de día y sin la animación de inicio (prefers-reduced-motion)
  const ctx = await browser.newContext({ colorScheme: 'light', reducedMotion: 'reduce', ...opciones });
  const page = await ctx.newPage();
  const res = await page.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' });
  if (!res?.ok()) throw new Error(`${ruta}: respondió ${res?.status()}`);
  await page.addStyleTag({ content: SIN_RUIDO });
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}

const browser = await navegador();
try {
  await mkdir(SALIDA, { recursive: true });
  for (const l of IDIOMAS) {
    // 540 px de ancho al doble: una imagen de 1080 px, nítida en el celular
    const img = await abrir(browser, `/guia?formato=imagen&l=${l}`, { viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
    const png = join(SALIDA, `luks-guia-${l}.png`);
    await img.page.locator('.ml-img').screenshot({ path: png, animations: 'disabled' });
    await img.ctx.close();

    const doc = await abrir(browser, `/guia?l=${l}`, { viewport: { width: 800, height: 1100 } });
    await doc.page.emulateMedia({ media: 'print' });
    const pdf = join(SALIDA, `luks-guia-${l}.pdf`);
    await doc.page.pdf({ path: pdf, format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' } });
    await doc.ctx.close();
    console.log(`Listo: ${png} y ${pdf}`);
  }
} finally {
  await browser.close();
}
