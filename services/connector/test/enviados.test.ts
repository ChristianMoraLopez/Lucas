import { proto } from 'baileys';
import { describe, expect, it } from 'vitest';
import { MensajesEnviados } from '../src/whatsapp/enviados.js';
import { FakeStore, silentLog } from './fakes.js';

// «Esperando el mensaje»: lo que mandó Mister Luks se puede reenviar aunque pasen horas o se reinicie (migración 560)

const TEXTO: proto.IMessage = { extendedTextMessage: { text: '💸 Ya liquidamos «Nochita». Falta por pagar…' } };

describe('lo que mandó, para reenviarlo', () => {
  it('lo encuentra en memoria y, pasado un día o tras reiniciar, en la base', async () => {
    const store = new FakeStore();
    let reloj = 1_000;
    const enviados = new MensajesEnviados(store, silentLog, () => reloj);
    enviados.guardar('3EB0ABC123', '120363@g.us', TEXTO);
    await Promise.resolve();
    expect(await enviados.buscar('3EB0ABC123')).toEqual(TEXTO);
    expect(store.enviados.has('3EB0ABC123')).toBe(true);

    // Un día después ya no está en memoria: sale de la base, igual
    reloj += 25 * 60 * 60 * 1000;
    const deLaBase = await enviados.buscar('3EB0ABC123');
    expect(proto.Message.toObject(deLaBase as proto.Message)).toEqual(proto.Message.toObject(proto.Message.fromObject(TEXTO)));

    // Otro connector (se reinició): también
    const otro = new MensajesEnviados(store, silentLog);
    expect((await otro.buscar('3EB0ABC123'))?.extendedTextMessage?.text).toBe(TEXTO.extendedTextMessage?.text);
    expect(await otro.buscar('NO-ESTA')).toBeUndefined();
    expect(await otro.buscar(null)).toBeUndefined();
  });

  it('si la base falla, no se cae: solo no lo puede reenviar', async () => {
    const store = new FakeStore();
    store.guardarEnviado = async () => {
      throw new Error('sin red');
    };
    store.mensajeEnviado = async () => {
      throw new Error('sin red');
    };
    const enviados = new MensajesEnviados(store, silentLog);
    enviados.guardar('3EB0DEF456', 'chat', TEXTO);
    expect(await enviados.buscar('3EB0DEF456')).toEqual(TEXTO);
    expect(await enviados.buscar('OTRO123456')).toBeUndefined();
  });
});
