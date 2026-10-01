/* Variables de entorno del connector (ver .env.example). Falla al arrancar,
   con un mensaje claro, si falta algo obligatorio. */

export class ConfigError extends Error {}

export interface Config {
  supabaseUrl: string;
  supabaseKey: string;
  /** 32 bytes para cifrar las credenciales de WhatsApp (AES-256-GCM) */
  sessionKey: Buffer;
  sentryDsn: string | null;
  sentryEnvironment: string;
  logLevel: string;
  healthPort: number;
  /** Cada cuánto se revisan las sesiones pedidas desde la web o la CLI */
  syncIntervalMs: number;
  replies: {
    enabled: boolean;
    pollIntervalMs: number;
    /** Mínimo entre dos mensajes de Luks en el mismo grupo */
    minIntervalMs: number;
    maxPerHourPerGroup: number;
    maxPerHourTotal: number;
    /** Cuántos gastos caben en un mismo mensaje de confirmación */
    batchMax: number;
  };
  media: {
    maxDownloadBytes: number;
    /** Límite del bucket «evidencias» */
    maxUploadBytes: number;
    maxSide: number;
    jpegQuality: number;
  };
  /** La cola está atascada si lo más viejo lleva más que esto (segundos) */
  queueStaleAfterS: number;
}

const int = (env: NodeJS.ProcessEnv, name: string, fallback: number) => {
  const v = env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new ConfigError(`${name} tiene que ser un número (llegó «${v}»)`);
  return n;
};

const bool = (env: NodeJS.ProcessEnv, name: string, fallback: boolean) => {
  const v = env[name]?.trim().toLowerCase();
  if (!v) return fallback;
  return ['1', 'true', 'si', 'sí', 'yes', 'on'].includes(v);
};

export function parseSessionKey(raw: string | undefined): Buffer {
  if (!raw?.trim()) {
    throw new ConfigError('Falta SESSION_ENCRYPTION_KEY. Genérala con: openssl rand -base64 32');
  }
  const key = Buffer.from(raw.trim(), 'base64');
  if (key.length !== 32) {
    throw new ConfigError(`SESSION_ENCRYPTION_KEY tiene que ser de 32 bytes en base64 (tiene ${key.length}). Genérala con: openssl rand -base64 32`);
  }
  return key;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/+$/, '');
  if (!supabaseUrl || supabaseUrl.includes('tu-proyecto')) throw new ConfigError('Falta SUPABASE_URL (Project Settings → Data API → Project URL)');
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseKey || supabaseKey.includes('xxxx')) {
    throw new ConfigError('Falta SUPABASE_SERVICE_ROLE_KEY (Project Settings → API Keys → Secret keys)');
  }
  const dsn = env.SENTRY_DSN?.trim();

  return {
    supabaseUrl,
    supabaseKey,
    sessionKey: parseSessionKey(env.SESSION_ENCRYPTION_KEY),
    sentryDsn: dsn ? dsn : null,
    sentryEnvironment: env.SENTRY_ENVIRONMENT?.trim() || 'production',
    logLevel: env.LOG_LEVEL?.trim().toLowerCase() || 'info',
    healthPort: int(env, 'HEALTH_PORT', 8080),
    syncIntervalMs: int(env, 'SYNC_INTERVAL_S', 5) * 1000,
    replies: {
      enabled: bool(env, 'GROUP_REPLIES', true),
      pollIntervalMs: int(env, 'REPLY_POLL_S', 5) * 1000,
      minIntervalMs: int(env, 'REPLY_MIN_INTERVAL_S', 20) * 1000,
      maxPerHourPerGroup: int(env, 'REPLY_MAX_PER_HOUR_GROUP', 20),
      maxPerHourTotal: int(env, 'REPLY_MAX_PER_HOUR', 60),
      batchMax: int(env, 'REPLY_BATCH_MAX', 5),
    },
    media: {
      maxDownloadBytes: int(env, 'MEDIA_MAX_DOWNLOAD_MB', 25) * 1024 * 1024,
      maxUploadBytes: int(env, 'MEDIA_MAX_UPLOAD_MB', 6) * 1024 * 1024,
      maxSide: int(env, 'IMAGE_MAX_SIDE', 1600),
      jpegQuality: int(env, 'IMAGE_QUALITY', 80),
    },
    queueStaleAfterS: int(env, 'QUEUE_STALE_AFTER_S', 900),
  };
}
