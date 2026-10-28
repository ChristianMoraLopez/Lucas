import { describe, expect, it } from 'vitest';
import { contestarEliminar, esEliminar } from '../src/eliminar.js';
import { esMensajeDeLuks } from '../src/text.js';

describe('esEliminar', () => {
  it.each([
    'elimina este gasto',
    'Elimina este gasto',
    'bórralo',
    'borra eso',
    'quita ese recibo',
    'anula esta factura',
    'eliminar',
    'porfa elimina este gasto',
    'delete this expense',
    'remove it',
  ])('«%s» pide eliminar', (t) => {
    expect(esEliminar(t)).toBe(true);
  });

  it.each(['cuánto llevamos', 'elimina a Santi del grupo', 'borra la cuenta de la casa y empieza otra', 'saca 20 lucas del cajero', 'taxi 45 lucas', ''])(
    '«%s» no',
    (t) => {
      expect(esEliminar(t)).toBe(false);
    },
  );
});

describe('lo que contesta Mister Luks', () => {
  const ok = {
    ok: true as const,
    language: 'es' as const,
    currency: 'COP' as const,
    account_id: 'a',
    account_name: 'Paseo',
    name: 'Santiago Ricaurte',
    gastos: [{ merchant: 'Arepas Doña Rosa', total: 5000 }],
  };

  it('eliminado: qué y de dónde, con la firma (para no anotarse como gasto)', () => {
    const body = contestarEliminar(ok, 'es');
    expect(body).toContain('🗑️ Listo, Santiago: eliminé *Arepas Doña Rosa* ($5.000) de «Paseo». Si fue un error, mándenlo otra vez.');
    expect(esMensajeDeLuks(body)).toBe(true);
  });

  it('en inglés', () => {
    expect(contestarEliminar({ ...ok, language: 'en' }, 'en')).toContain('🗑️ Done, Santiago: I deleted *Arepas Doña Rosa*');
  });

  it('sin cita explica cómo; sin permiso dice quién puede', () => {
    expect(contestarEliminar({ ok: false, reason: 'sin_cita' }, 'es')).toContain('dale *Responder* y escríbeme «luks elimina este gasto»');
    expect(contestarEliminar({ ok: false, reason: 'no_puedes', account_name: 'Paseo', name: 'Mafe' }, 'es')).toBe(
      '🙅 Mafe, ese gasto lo puede eliminar quien lo mandó, quien lo pagó o quien administra «Paseo».',
    );
    expect(contestarEliminar({ ok: false, reason: 'liquidado', account_name: 'Paseo' }, 'es')).toContain('«Paseo» ya se liquidó');
  });
});
