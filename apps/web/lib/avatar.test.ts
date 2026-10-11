import { describe, expect, it } from 'vitest';
import { caraUri } from './avatar';

describe('la carita de cada persona (blobatar)', () => {
  it('es una imagen SVG y siempre la misma para el mismo nombre', () => {
    const uri = caraUri('Valentina', 'naranja');
    expect(uri.startsWith('data:image/svg+xml')).toBe(true);
    expect(caraUri('Valentina', 'naranja')).toBe(uri);
  });

  it('cambia con el nombre, con el tono y si la persona aún no tiene cuenta', () => {
    const uri = caraUri('Valentina', 'naranja');
    expect(caraUri('Mateo', 'naranja')).not.toBe(uri);
    expect(caraUri('Valentina', 'azul')).not.toBe(uri);
    expect(caraUri('Valentina', 'naranja', false)).not.toBe(uri);
  });

  it('no se rompe con emojis ni con un nombre vacío', () => {
    expect(caraUri('Juli 🌻', 'rosa').startsWith('data:image/svg+xml')).toBe(true);
    expect(caraUri('', 'morado').startsWith('data:image/svg+xml')).toBe(true);
  });
});
