// Copia el WASM del reproductor de Lottie a public/lottie para servirlo desde
// la propia app (sin CDN: la PWA también funciona sin conexión). Se corre antes
// de dev y build, así siempre coincide con la versión instalada.
import { copyFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// .../node_modules/@lottiefiles/dotlottie-react/dist/index.js → su carpeta real (pnpm)
const react = dirname(dirname(realpathSync(fileURLToPath(import.meta.resolve('@lottiefiles/dotlottie-react')))));
// dotlottie-web queda al lado, en el mismo node_modules del paquete
const wasm = join(react, '..', 'dotlottie-web', 'dist', 'dotlottie-player.wasm');
if (!existsSync(wasm)) throw new Error(`No encontré el WASM de dotlottie-web en ${wasm}`);

mkdirSync('public/lottie', { recursive: true });
copyFileSync(wasm, 'public/lottie/dotlottie-player.wasm');
