import * as Sentry from '@sentry/node';
import { ConfigError, loadConfig } from './config.js';
import { SessionCipher } from './crypto.js';
import { startHealthServer } from './health.js';
import { Ingestor } from './ingest.js';
import { createLogger } from './log.js';
import { SessionManager } from './manager.js';
import { RateLimiter, ReplyLoop } from './replies.js';
import { SupabaseStore } from './store.js';
import { BaileysConnector } from './whatsapp/baileys.js';

/* Luks · connector de WhatsApp. Ver README.md de esta carpeta. */

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig();
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(`Configuración incompleta: ${e.message}`);
    process.exit(2);
  }
  throw e;
}

const log = createLogger(config.logLevel);

if (config.sentryDsn) {
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.sentryEnvironment,
    tracesSampleRate: 0,
    // Nada de lo que la gente escribe: solo el error y dónde pasó
    beforeSend(event) {
      delete event.request;
      delete event.user;
      if (event.extra) event.extra = Object.fromEntries(Object.entries(event.extra).filter(([k]) => ['session', 'kind', 'reason'].includes(k)));
      return event;
    },
  });
  log.info({ env: config.sentryEnvironment }, 'Sentry activo');
}

const store = new SupabaseStore(config.supabaseUrl, config.supabaseKey);
const cipher = new SessionCipher(config.sessionKey);
const limiter = new RateLimiter({
  minIntervalMs: config.replies.minIntervalMs,
  maxPerHourPerGroup: config.replies.maxPerHourPerGroup,
  maxPerHourTotal: config.replies.maxPerHourTotal,
});
const ingestor = new Ingestor(store, { ...config.media }, limiter, log);
const manager = new SessionManager(
  store,
  (session, handlers) => new BaileysConnector(session, handlers, { store, cipher, log }),
  ingestor,
  log,
  (message, extra) => {
    log.error(extra, message);
    if (config.sentryDsn) Sentry.captureMessage(message, { level: 'warning', extra });
  },
);
const replies = new ReplyLoop(store, limiter, manager.senderFor, { batchMax: config.replies.batchMax, maxWaitMs: 30 * 60_000 }, log);
const health = startHealthServer(config.healthPort, { manager, store, queueStaleAfterS: config.queueStaleAfterS, log });

/** Corre `fn` cada `ms`, sin solaparse consigo misma */
function cada(ms: number, nombre: string, fn: () => Promise<unknown>) {
  let corriendo = false;
  const tick = async () => {
    if (corriendo) return;
    corriendo = true;
    try {
      await fn();
    } catch (e) {
      log.error({ err: (e as Error).message, loop: nombre }, 'Falló una vuelta; se reintenta');
      if (config.sentryDsn) Sentry.captureException(e);
    } finally {
      corriendo = false;
    }
  };
  void tick();
  return setInterval(tick, ms);
}

const timers = [cada(config.syncIntervalMs, 'sesiones', () => manager.sync())];
if (config.replies.enabled) timers.push(cada(config.replies.pollIntervalMs, 'confirmaciones', () => replies.tick()));
log.info({ replies: config.replies.enabled }, 'Connector listo');

let apagando = false;
async function apagar(signal: string) {
  if (apagando) return;
  apagando = true;
  log.info({ signal }, 'Apagando: se cierran las sesiones sin desvincular');
  for (const t of timers) clearInterval(t);
  health.close();
  await manager.shutdown();
  if (config.sentryDsn) await Sentry.close(2000);
  process.exit(0);
}
process.on('SIGTERM', () => void apagar('SIGTERM'));
process.on('SIGINT', () => void apagar('SIGINT'));
process.on('unhandledRejection', (e) => {
  log.error({ err: (e as Error)?.message ?? String(e) }, 'Promesa sin atrapar');
  if (config.sentryDsn) Sentry.captureException(e);
});
