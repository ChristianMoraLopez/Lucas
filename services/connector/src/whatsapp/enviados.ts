import { proto } from 'baileys';
import type { Logger } from '../log.js';
import type { Store } from '../store.js';

/* Lo que manda una sesión, para reenviarlo cuando el celular de quien lo
   recibe no lo pudo descifrar y lo pide otra vez («Esperando el mensaje»).
   Baileys solo lo guarda cinco minutos y en memoria; aquí queda en memoria un
   día y en la base (migración 560), así sirve aunque el connector se reinicie. */

const UN_DIA = 24 * 60 * 60 * 1000;
const MAXIMO = 1000;

export class MensajesEnviados {
  readonly #memoria = new Map<string, { mensaje: proto.IMessage; hasta: number }>();

  constructor(
    private readonly store: Pick<Store, 'guardarEnviado' | 'mensajeEnviado'>,
    private readonly log: Logger,
    private readonly ahora: () => number = Date.now,
  ) {}

  /** Lo recuerda (en memoria ya; en la base sin esperar: si falla, sigue) */
  guardar(waId: string | null | undefined, chatId: string, mensaje: proto.IMessage | null | undefined) {
    if (!waId || !mensaje) return;
    this.#memoria.delete(waId);
    this.#memoria.set(waId, { mensaje, hasta: this.ahora() + UN_DIA });
    // El más viejo sale primero
    while (this.#memoria.size > MAXIMO) this.#memoria.delete(this.#memoria.keys().next().value as string);
    const base64 = Buffer.from(proto.Message.encode(mensaje).finish()).toString('base64');
    this.store.guardarEnviado(waId, chatId, base64).catch((e) => this.log.warn({ err: (e as Error).message }, 'No se pudo guardar lo enviado'));
  }

  /** Para reenviarlo: de la memoria o de la base; undefined si ya no está */
  async buscar(waId: string | null | undefined): Promise<proto.IMessage | undefined> {
    if (!waId) return undefined;
    const aqui = this.#memoria.get(waId);
    if (aqui && aqui.hasta > this.ahora()) return aqui.mensaje;
    try {
      const base64 = await this.store.mensajeEnviado(waId);
      return base64 ? proto.Message.decode(Buffer.from(base64, 'base64')) : undefined;
    } catch (e) {
      this.log.warn({ err: (e as Error).message }, 'No se pudo leer lo enviado para reenviarlo');
      return undefined;
    }
  }
}
