/*
 * Chepito en GIF para WhatsApp: public/brand/chepito-{hola,cobra}-{es,en}.mp4
 * y su primer cuadro en .jpg (la miniatura que se ve antes de bajarlo).
 * WhatsApp no muestra Lottie: los GIF se mandan como un .mp4 mudo que se repite
 * (gifPlayback), con el aviso de cobro como pie de foto.
 *
 * · chepito-hola: el primer aviso. Saluda con el sombrero y se queda quieto.
 * · chepito-cobra: los recordatorios. Muestra la cuenta y golpea el piso con el pie.
 *
 * Sale de las mismas animaciones de public/lottie (scripts/lottie-chepito.py).
 * Necesita Chrome o Edge (CHROME_PATH para otro) y ffmpeg:
 *
 *   node apps/web/scripts/chepito-gif.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const WEB = join(import.meta.dirname, '..');
const SALIDA = join(WEB, 'public', 'brand');
// dotlottie-web queda al lado de dotlottie-react, en el mismo node_modules (pnpm); como en copy-lottie-wasm.mjs
const react = dirname(dirname(realpathSync(fileURLToPath(import.meta.resolve('@lottiefiles/dotlottie-react', join(WEB, 'package.json'))))));
const DOTLOTTIE = join(react, '..', 'dotlottie-web', 'dist');

const LADO = 480;
const FPS = 30;
/** [animación, desde, hasta]: los cuadros de cada tramo, uno detrás del otro, y vuelve a empezar */
const GIFS = {
  // Sin el salto con que aparece (cuadros 0 a 11): así el bucle no parpadea
  'chepito-hola': {
    tramos: [
      ['chepito-saluda', 12, 74],
      ['chepito', 0, 89],
    ],
    titulo: { es: '¡Hola! Soy Chepito', en: 'Hi! I’m Chepito' },
  },
  'chepito-cobra': {
    tramos: [
      ['chepito-cobra', 0, 59],
      ['chepito-cobra', 0, 59],
    ],
    titulo: { es: 'Chepito otra vez', en: 'Chepito again' },
  },
};
const PIE = { es: 'trabajo para Mister Luks', en: 'I work for Mister Luks' };

const PAGINA = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<script type="module">
import { DotLottie } from './dotlottie.js';
DotLottie.setWasmUrl(new URL('./player.wasm', location.href).href);
const cache = new Map();
async function animacion(nombre) {
  if (cache.has(nombre)) return cache.get(nombre);
  const c = document.createElement('canvas'); c.width = c.height = 720;
  const dl = new DotLottie({ canvas: c, src: './lottie/' + nombre + '.lottie', autoplay: false, loop: false, backgroundColor: '#00000000' });
  await new Promise((ok, mal) => { dl.addEventListener('load', ok); dl.addEventListener('loadError', mal); });
  cache.set(nombre, { c, dl });
  return { c, dl };
}
const carta = document.createElement('canvas'); carta.width = carta.height = ${LADO};
window.cuadro = async (nombre, f, titulo, pie) => {
  const { c, dl } = await animacion(nombre);
  dl.setFrame(f);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const g = carta.getContext('2d');
  g.fillStyle = '#FFF6EC'; g.fillRect(0, 0, ${LADO}, ${LADO});
  g.fillStyle = '#FBDDD8'; g.beginPath(); g.arc(240, 176, 150, 0, Math.PI * 2); g.fill();
  g.drawImage(c, 64, -4, 352, 352);
  g.textAlign = 'center';
  g.fillStyle = '#1C1433'; g.font = '800 42px Inter, sans-serif'; g.fillText(titulo, 240, 400);
  g.fillStyle = '#A8182F'; g.font = '600 25px Inter, sans-serif'; g.fillText(pie, 240, 440);
  return carta.toDataURL('image/png');
};
window.listo = true;
</script>`;

const ARCHIVOS = {
  '/': ['text/html', () => PAGINA],
  '/dotlottie.js': ['text/javascript', () => readFileSync(join(DOTLOTTIE, 'index.js'))],
  '/player.wasm': ['application/wasm', () => readFileSync(join(DOTLOTTIE, 'dotlottie-player.wasm'))],
};

function servir() {
  const server = createServer((req, res) => {
    const ruta = new URL(req.url, 'http://x').pathname;
    const lottie = ruta.match(/^\/lottie\/([a-z-]+)\.lottie$/);
    if (lottie) {
      res.writeHead(200, { 'content-type': 'application/zip' });
      return res.end(readFileSync(join(WEB, 'public', 'lottie', `${lottie[1]}.lottie`)));
    }
    const archivo = ARCHIVOS[ruta];
    if (!archivo) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': archivo[0] });
    res.end(archivo[1]());
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

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

const server = await servir();
const browser = await navegador();
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.listo === true);
  await page.evaluate(() => document.fonts.load('800 42px Inter'));
  for (const [nombre, { tramos, titulo }] of Object.entries(GIFS)) {
    for (const idioma of ['es', 'en']) {
      const cuadros = await mkdtemp(join(tmpdir(), 'chepito-'));
      let n = 0;
      for (const [animacion, desde, hasta] of tramos) {
        for (let f = desde; f <= hasta; f++) {
          const png = await page.evaluate(([a, f, t, p]) => window.cuadro(a, f, t, p), [animacion, f, titulo[idioma], PIE[idioma]]);
          writeFileSync(join(cuadros, `${String(n++).padStart(4, '0')}.png`), Buffer.from(png.split(',')[1], 'base64'));
        }
      }
      const destino = join(SALIDA, `${nombre}-${idioma}`);
      // H.264 sin audio, como los GIF de WhatsApp; faststart para que empiece a verse mientras baja
      execFileSync('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-framerate',
        String(FPS),
        '-i',
        join(cuadros, '%04d.png'),
        '-c:v',
        'libx264',
        '-profile:v',
        'main',
        '-pix_fmt',
        'yuv420p',
        '-crf',
        '26',
        '-preset',
        'veryslow',
        '-movflags',
        '+faststart',
        '-an',
        `${destino}.mp4`,
      ]);
      // La miniatura: el cuadro donde se le ve mejor (con el sombrero arriba, o mostrando la cuenta)
      execFileSync('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-i',
        join(cuadros, nombre === 'chepito-hola' ? '0014.png' : '0010.png'),
        '-q:v',
        '3',
        `${destino}.jpg`,
      ]);
      await rm(cuadros, { recursive: true });
      console.log(`${destino}.mp4 (${n} cuadros)`);
    }
  }
} finally {
  await browser.close();
  server.close();
}
