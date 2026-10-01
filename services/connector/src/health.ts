import { createServer, type Server } from 'node:http';
import type { Logger } from './log.js';
import type { SessionManager } from './manager.js';
import type { Store } from './store.js';

/*
 * Para Uptime Kuma (y el HEALTHCHECK de Docker), solo dentro de la red de
 * Docker:
 *
 *   GET /health/vivo  → el proceso responde
 *   GET /health       → 200 si el número contador está conectado, 503 si no
 *   GET /health/cola  → 200 si la cola del worker avanza, 503 si lo más viejo
 *                       lleva más de QUEUE_STALE_AFTER_S esperando
 */
export function startHealthServer(port: number, deps: { manager: SessionManager; store: Store; queueStaleAfterS: number; log: Logger }): Server {
  const server = createServer((req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };

    if (req.method !== 'GET') return json(405, { ok: false });
    const url = (req.url ?? '/').split('?')[0];

    if (url === '/health/vivo') return json(200, { ok: true });

    if (url === '/health') {
      const sesiones = deps.manager.snapshot();
      const contador = sesiones.find((s) => s.kind === 'contador');
      const ok = contador?.state === 'connected';
      return json(ok ? 200 : 503, {
        ok,
        contador: contador ? { state: contador.state, since: contador.since, groups: contador.groups } : 'sin vincular',
        personales: sesiones.filter((s) => s.kind === 'personal').map((s) => ({ state: s.state, since: s.since })),
      });
    }

    if (url === '/health/cola') {
      deps.store
        .queueHealth()
        .then((q) => {
          const ok = q.oldest_queued_s < deps.queueStaleAfterS;
          json(ok ? 200 : 503, { ok, ...q });
        })
        .catch((e: Error) => json(503, { ok: false, error: e.message }));
      return;
    }

    json(404, { ok: false });
  });
  server.listen(port, () => deps.log.info({ port }, 'Salud en /health, /health/cola y /health/vivo'));
  return server;
}
