/// <reference lib="webworker" />
// Service worker de Lucas (Serwist). Lo construye app/serwist/[path]/route.ts
// con esbuild: Turbopack todavía no admite plugins de webpack.
import { defaultCache } from '@serwist/turbopack/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  // Sin conexión, cualquier página que no esté en caché muestra /sin-conexion
  fallbacks: {
    entries: [{ url: '/sin-conexion', matcher: ({ request }) => request.destination === 'document' }],
  },
});

serwist.addEventListeners();
