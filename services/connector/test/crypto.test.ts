import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseSessionKey } from '../src/config.js';
import { SessionCipher } from '../src/crypto.js';

const llave = randomBytes(32);

describe('cifrado de las credenciales', () => {
  const c = new SessionCipher(llave);

  it('ida y vuelta, con un IV distinto cada vez', () => {
    const a = c.encrypt('{"noiseKey":"…"}', 'sesion:creds');
    const b = c.encrypt('{"noiseKey":"…"}', 'sesion:creds');
    expect(a).not.toBe(b);
    expect(c.decrypt(a, 'sesion:creds').toString()).toBe('{"noiseKey":"…"}');
    expect(Buffer.from(a, 'base64').toString('latin1')).not.toContain('noiseKey');
  });

  it('no descifra en otro contexto (otra sesión u otra llave)', () => {
    const a = c.encrypt('secreto', 'sesion-1:pre-key:1');
    expect(() => c.decrypt(a, 'sesion-2:pre-key:1')).toThrow();
    expect(() => c.decrypt(a, 'sesion-1:pre-key:2')).toThrow();
  });

  it('detecta cambios y llaves equivocadas', () => {
    const a = Buffer.from(c.encrypt('secreto', 'x'), 'base64');
    a[a.length - 1] ^= 1;
    expect(() => c.decrypt(a.toString('base64'), 'x')).toThrow();
    expect(() => new SessionCipher(randomBytes(32)).decrypt(c.encrypt('secreto', 'x'), 'x')).toThrow();
    expect(() => c.decrypt(Buffer.from('basura').toString('base64'), 'x')).toThrow('formato');
  });
});

describe('configuración', () => {
  const base = {
    SUPABASE_URL: 'https://abc.supabase.co/',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_abc',
    SESSION_ENCRYPTION_KEY: llave.toString('base64'),
  };

  it('lee lo obligatorio y pone valores por defecto', () => {
    const c = loadConfig(base);
    expect(c.supabaseUrl).toBe('https://abc.supabase.co');
    expect(c.sessionKey.equals(llave)).toBe(true);
    expect(c.replies).toMatchObject({ enabled: true, minIntervalMs: 20_000, batchMax: 5 });
    expect(c.media.maxUploadBytes).toBe(6 * 1024 * 1024);
    expect(c.sentryDsn).toBeNull();
  });

  it('explica qué falta', () => {
    expect(() => loadConfig({ ...base, SUPABASE_URL: '' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_xxxxxxxx' })).toThrow('SUPABASE_SERVICE_ROLE_KEY');
    expect(() => parseSessionKey('')).toThrow('openssl rand -base64 32');
    expect(() => parseSessionKey(Buffer.from('corta').toString('base64'))).toThrow('32 bytes');
    expect(() => loadConfig({ ...base, REPLY_MIN_INTERVAL_S: 'mucho' })).toThrow('REPLY_MIN_INTERVAL_S');
  });

  it('las confirmaciones se pueden apagar', () => {
    expect(loadConfig({ ...base, GROUP_REPLIES: 'false' }).replies.enabled).toBe(false);
  });
});
