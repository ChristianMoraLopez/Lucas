import type { Logger } from './log.js';
import { INTENCIONES, type Intencion } from './text.js';

/* Qwen (el mismo Ollama del worker) solo clasifica las preguntas que las
   reglas fijas no entendieron: dice cuál de las intenciones es, nunca da
   números (esos salen de la base). Si no responde a tiempo, no hay respuesta. */

/** Clasifica lo que le dicen a Mister Luks (sin su nombre ni la mención) */
export type Clasificador = (texto: string) => Promise<Intencion | null>;

export interface OllamaOptions {
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

const INSTRUCCIONES = `Clasificas mensajes que la gente le escribe a Mister Luks, el que lleva las cuentas de un grupo de WhatsApp. Responde solo la intención:
- total: cuánto han gastado en total
- deudas: quién le debe a quién, cómo van las cuentas del grupo
- mi_saldo: cuánto debe o le deben a quien escribe
- mis_gastos: qué ha pagado quien escribe
- privado: quiere que le respondan por privado
- aqui: quiere que le respondan en el grupo
- no_me_cuentes: no quiere que le anoten más lo que mande
- cuentame: quiere que le vuelvan a anotar lo que mande
- ninguna: cualquier otra cosa (un saludo, una broma, un gasto)
Los mensajes pueden estar en español o en inglés.`;

export function clasificadorOllama(o: OllamaOptions, log: Logger): Clasificador {
  return async (texto) => {
    const t = texto.trim().slice(0, 300);
    if (!t) return null;
    try {
      const r = await fetch(`${o.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(o.timeoutMs),
        body: JSON.stringify({
          model: o.model,
          stream: false,
          keep_alive: '30m',
          format: { type: 'object', properties: { intencion: { type: 'string', enum: [...INTENCIONES, 'ninguna'] } }, required: ['intencion'] },
          options: { temperature: 0, num_predict: 24 },
          messages: [
            { role: 'system', content: INSTRUCCIONES },
            { role: 'user', content: t },
          ],
        }),
      });
      if (!r.ok) throw new Error(`Ollama respondió ${r.status}`);
      const body = (await r.json()) as { message?: { content?: string } };
      const v = (JSON.parse(body.message?.content ?? '{}') as { intencion?: string }).intencion;
      return INTENCIONES.find((i) => i === v) ?? null;
    } catch (e) {
      log.warn({ err: (e as Error).message }, 'Qwen no clasificó la pregunta');
      return null;
    }
  };
}
