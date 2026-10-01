import { type AuthenticationCreds, type AuthenticationState, BufferJSON, initAuthCreds, proto, type SignalDataTypeMap, type SignalKeyStore } from 'baileys';
import type { SessionCipher } from '../crypto.js';
import type { KeyItem, Store } from '../store.js';

/*
 * Las credenciales de una sesión de Baileys guardadas en Postgres en vez de en
 * archivos: las «creds» en whatsapp_connections.session_ciphertext y cada llave
 * de Signal en whatsapp_session_keys, todo cifrado con AES-256-GCM. El
 * contexto del cifrado ata cada valor a su sesión y a su llave.
 */
export async function useDbAuthState(
  store: Store,
  cipher: SessionCipher,
  sessionId: string,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const ctx = (name: string) => `${sessionId}:${name}`;
  const leer = (encoded: string, name: string) => JSON.parse(cipher.decrypt(encoded, ctx(name)).toString('utf8'), BufferJSON.reviver);
  const cifrar = (value: unknown, name: string) => cipher.encrypt(JSON.stringify(value, BufferJSON.replacer), ctx(name));

  const guardadas = await store.getCreds(sessionId);
  const creds: AuthenticationCreds = guardadas ? leer(guardadas, 'creds') : initAuthCreds();

  const keys: SignalKeyStore = {
    async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
      const filas = await store.getKeys(sessionId, type, ids);
      const out: { [id: string]: SignalDataTypeMap[T] } = {};
      for (const id of ids) {
        const encoded = filas[id];
        if (!encoded) continue;
        let value = leer(encoded, `${type}:${id}`);
        if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
        out[id] = value;
      }
      return out;
    },
    async set(data) {
      const items: KeyItem[] = [];
      for (const type of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
        for (const [id, value] of Object.entries(data[type] ?? {})) {
          items.push({ t: type, i: id, v: value ? cifrar(value, `${type}:${id}`) : null });
        }
      }
      if (items.length) await store.setKeys(sessionId, items);
    },
  };

  return {
    state: { creds, keys },
    saveCreds: () => store.saveCreds(sessionId, cifrar(creds, 'creds')),
  };
}
