import pino, { type Logger } from 'pino';

/* Logs en JSON (los lee `docker compose logs`). Nunca el contenido de los
   mensajes ni números completos: solo ids, estados y tiempos. */

export type { Logger };

export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { svc: 'connector' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  });
}

/** «573001234567» → «57•••4567» para los logs */
export function maskWaId(id: string | null | undefined): string | null {
  if (!id) return null;
  if (id.startsWith('lid:')) return `lid:•••${id.slice(-4)}`;
  return id.length > 6 ? `${id.slice(0, 2)}•••${id.slice(-4)}` : '•••';
}
