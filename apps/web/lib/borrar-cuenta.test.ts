import { describe, expect, it } from 'vitest';
import { archivosBajo, enTandas, nombreCoincide } from './borrar-cuenta';

describe('borrar una cuenta del todo', () => {
  it('el nombre escrito coincide sin importar mayúsculas ni espacios', () => {
    expect(nombreCoincide('  noche de   fiesta ', 'Noche de fiesta')).toBe(true);
    expect(nombreCoincide('Noche', 'Noche de fiesta')).toBe(false);
    expect(nombreCoincide('', 'Kara')).toBe(false);
  });

  it('encuentra los archivos de todas las subcarpetas', async () => {
    const arbol: Record<string, { name: string; id: string | null }[]> = {
      cuenta: [
        { name: 'whatsapp', id: null },
        { name: 'foto.webp', id: '1' },
      ],
      'cuenta/whatsapp': [{ name: '2026-10', id: null }],
      'cuenta/whatsapp/2026-10': [
        { name: 'a.jpg', id: '2' },
        { name: 'b.pdf', id: '3' },
      ],
    };
    const r = await archivosBajo('cuenta', async (c) => arbol[c] ?? []);
    expect(r.sort()).toEqual(['cuenta/foto.webp', 'cuenta/whatsapp/2026-10/a.jpg', 'cuenta/whatsapp/2026-10/b.pdf']);
  });

  it('borra en tandas de a 100', () => {
    const lista = Array.from({ length: 230 }, (_, i) => i);
    expect(enTandas(lista).map((t) => t.length)).toEqual([100, 100, 30]);
    expect(enTandas([])).toEqual([]);
  });
});
