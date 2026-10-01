import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/*
 * Cifrado de las credenciales de WhatsApp antes de guardarlas en Postgres.
 * AES-256-GCM con un IV nuevo cada vez; el «contexto» (sesión + tipo + id de
 * la llave) va como dato autenticado, así una llave copiada a otra fila o a
 * otra sesión no descifra.
 *
 *   [1 byte versión][12 bytes IV][16 bytes tag][texto cifrado]  → base64
 */

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SessionCipher {
  readonly #key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error('La llave de cifrado tiene que ser de 32 bytes');
    this.#key = key;
  }

  encrypt(plain: Buffer | string, context: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const body = Buffer.concat([cipher.update(typeof plain === 'string' ? Buffer.from(plain, 'utf8') : plain), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]).toString('base64');
  }

  decrypt(encoded: string, context: string): Buffer {
    const raw = Buffer.from(encoded, 'base64');
    if (raw.length < 1 + IV_BYTES + TAG_BYTES || raw[0] !== VERSION) {
      throw new Error('Credencial cifrada con un formato desconocido');
    }
    const iv = raw.subarray(1, 1 + IV_BYTES);
    const tag = raw.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.#key, iv);
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(raw.subarray(1 + IV_BYTES + TAG_BYTES)), decipher.final()]);
  }
}
