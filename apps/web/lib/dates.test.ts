import { describe, expect, it } from 'vitest';
import { formatDay, formatWhen, monthName, todayInBogota } from './dates';

describe('fechas', () => {
  it('un instante es el día que era en Bogotá, esté donde esté el servidor', () => {
    // 2:30 a. m. en UTC del 4 de octubre = 9:30 p. m. del 3 en Bogotá
    expect(formatDay(new Date('2026-10-04T02:30:00Z'), '2026-10-04')).toBe('3 oct');
    expect(monthName(new Date('2026-11-01T03:00:00Z'))).toBe('Octubre');
    expect(todayInBogota(new Date('2026-01-01T04:59:00Z'))).toBe('2025-12-31');
  });

  it('las fechas de Postgres (AAAA-MM-DD) se leen tal cual', () => {
    expect(formatDay('2026-10-04', '2026-10-04')).toBe('4 oct');
    expect(formatDay('2025-12-31', '2026-10-04')).toBe('31 dic 2025');
  });

  it('la hora sale con espacios normales (igual en el servidor y en el navegador)', () => {
    expect(formatWhen('2026-10-04T02:48:00Z')).not.toMatch(/[\u00A0\u202F\u2009]/);
    expect(formatWhen('2026-10-04T02:48:00Z')).toMatch(/^3 de oct · 9:48 p\. m\.$/);
  });
});
