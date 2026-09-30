import { describe, expect, it } from 'vitest';
import { CODE_RE, formatCOP, formatCode, lucas } from '@/components/lucas-core';
import { callbackUrl, nextFromRedirectTo, safeNext } from './auth';
import { eventMoment, formatDay, formatRange, monthName } from './dates';
import { displayLink, inviteHint, inviteLink, inviteMessage, isInviteActive, whatsappUrl } from './invite';

describe('formatCOP / lucas', () => {
  it('pesos con punto de miles y sin decimales', () => {
    expect(formatCOP(84300)).toBe('$84.300');
    expect(formatCOP(4816000)).toBe('$4.816.000');
    expect(formatCOP(0)).toBe('$0');
    expect(formatCOP(1234.6)).toBe('$1.235');
  });
  it('negativos con signo menos y positivos con + si se pide', () => {
    expect(formatCOP(-280000)).toBe('−$280.000');
    expect(formatCOP(132500, { sign: true })).toBe('+$132.500');
  });
  it('la forma hablada', () => {
    expect(lucas(602000)).toBe('602 lucas');
    expect(lucas(132500)).toBe('132,5 lucas');
    expect(lucas(1200000)).toBe('1,2 palos');
    expect(lucas(2000000)).toBe('2 palos');
  });
});

describe('códigos de invitación', () => {
  it('formatea mientras se escribe', () => {
    expect(formatCode('paseo')).toBe('PASEO');
    expect(formatCode('paseo-7k')).toBe('PASEO-7K');
    expect(formatCode('paseo-7k2q9')).toBe('PASEO-7K2Q');
  });
  it('saca el código de un link pegado', () => {
    expect(formatCode('https://lucas.co/e/PASEO-7K2Q')).toBe('PASEO-7K2Q');
    expect(formatCode('Entren a Lucas: lucas.co/e/paseo-7k2q')).toBe('PASEO-7K2Q');
  });
  it('reconoce un código completo', () => {
    expect(CODE_RE.test('PASEO-7K2Q')).toBe(true);
    expect(CODE_RE.test('CUMPLEAN-AB23')).toBe(true);
    expect(CODE_RE.test('PA-7K2Q')).toBe(false);
    expect(CODE_RE.test('PASEO-7K2')).toBe(false);
  });
});

describe('safeNext: a dónde volver después de entrar', () => {
  it('acepta rutas internas', () => {
    expect(safeNext('/e/PASEO-7K2Q')).toBe('/e/PASEO-7K2Q');
    expect(safeNext('/unirse?codigo=PASEO-7K2Q')).toBe('/unirse?codigo=PASEO-7K2Q');
  });
  it('rechaza redirecciones a otros sitios', () => {
    expect(safeNext('https://malo.com')).toBe('/');
    expect(safeNext('//malo.com')).toBe('/');
    expect(safeNext('/\\malo.com')).toBe('/');
    expect(safeNext('/ok\n/x')).toBe('/');
  });
  it('no deja volver al login ni a las rutas de auth', () => {
    expect(safeNext('/login')).toBe('/');
    expect(safeNext('/auth/callback?code=1')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
  it('saca next del redirect_to de los correos, solo si es del mismo sitio', () => {
    const origin = 'https://lucas.co';
    expect(nextFromRedirectTo('https://lucas.co/auth/callback?next=/e/PASEO-7K2Q', origin)).toBe('/e/PASEO-7K2Q');
    expect(nextFromRedirectTo('https://malo.com/auth/callback?next=/x', origin)).toBeNull();
    expect(nextFromRedirectTo('no es url', origin)).toBeNull();
  });
  it('arma la URL de vuelta con next codificado', () => {
    expect(callbackUrl('http://localhost:3000', '/e/PASEO-7K2Q')).toBe('http://localhost:3000/auth/callback?next=%2Fe%2FPASEO-7K2Q');
  });
});

describe('fechas en español', () => {
  it('días y rangos', () => {
    expect(formatDay('2026-10-05', '2026-09-30')).toBe('5 oct');
    expect(formatDay('2027-01-02', '2026-09-30')).toBe('2 ene 2027');
    expect(formatRange('2026-09-24', '2026-09-28')).toBe('24 – 28 sep 2026');
    expect(formatRange('2026-09-30', '2026-10-02')).toBe('30 sep – 2 oct 2026');
    expect(formatRange('2026-12-28', '2027-01-03')).toBe('28 dic 2026 – 3 ene 2027');
    expect(formatRange('2026-09-24', null)).toBe('24 sep 2026');
    expect(formatRange(null, null)).toBeNull();
    expect(monthName('2026-09-30')).toBe('Septiembre');
  });
  it('en qué va un evento', () => {
    expect(eventMoment('2026-09-24', '2026-09-28', '2026-09-29')).toBe('Terminó ayer');
    expect(eventMoment('2026-09-24', '2026-09-28', '2026-10-02')).toBe('Terminó hace 4 días');
    expect(eventMoment('2026-10-10', '2026-10-12', '2026-10-09')).toBe('Empieza mañana');
    expect(eventMoment('2026-09-24', '2026-09-28', '2026-09-25')).toBe('Va en el día 2');
    expect(eventMoment(null, null, '2026-09-25')).toBe('En curso');
  });
});

describe('invitaciones', () => {
  const inv = { expires_at: '2026-10-05T12:00:00Z', max_uses: 16, uses: 6, role: 'member', revoked_at: null };
  it('link, texto y WhatsApp', () => {
    const link = inviteLink('https://lucas.co', 'PASEO-7K2Q');
    expect(link).toBe('https://lucas.co/e/PASEO-7K2Q');
    expect(displayLink(link)).toBe('lucas.co/e/PASEO-7K2Q');
    expect(inviteMessage({ accountName: 'Paseo Santa Marta', code: 'PASEO-7K2Q', link, name: 'Caro' })).toContain('Caro, entra a «Paseo Santa Marta»');
    expect(whatsappUrl('hola parce', '+57 300 222 4471')).toBe('https://wa.me/573002224471?text=hola%20parce');
  });
  it('el texto bajo el código', () => {
    expect(inviteHint(inv, () => '5 oct')).toBe('Vence el 5 oct · sirve para 10 personas más');
    expect(inviteHint({ ...inv, expires_at: null, max_uses: null, role: 'admin' }, () => '')).toBe('No vence · sin límite de personas · entran como admin');
  });
  it('cuándo un código ya no sirve', () => {
    const now = new Date('2026-09-30T12:00:00Z');
    expect(isInviteActive(inv, now)).toBe(true);
    expect(isInviteActive({ ...inv, uses: 16 }, now)).toBe(false);
    expect(isInviteActive({ ...inv, expires_at: '2026-09-29T00:00:00Z' }, now)).toBe(false);
    expect(isInviteActive({ ...inv, revoked_at: '2026-09-29T00:00:00Z' }, now)).toBe(false);
  });
});

describe('compresión de fotos', async () => {
  const { evidencePath, extensionFor, fitWithin } = await import('./compress');
  it('el lado largo queda en 1600 px sin agrandar las fotos pequeñas', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it('la extensión sigue al tipo que de verdad quedó', () => {
    expect(extensionFor('image/webp')).toBe('webp');
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('application/pdf')).toBe('pdf');
  });
  it('la ruta empieza por la cuenta (así lo exige RLS en Storage)', () => {
    expect(evidencePath('cuenta-1', 'webp', new Date(2026, 8, 30), 'abc')).toBe('cuenta-1/2026-09/abc.webp');
  });
});

describe('fechas de listas', async () => {
  const { formatDateCO, formatRecent } = await import('./dates');
  it('hoy, ayer o el día', () => {
    expect(formatRecent('2026-09-30', undefined, '2026-09-30')).toBe('Hoy');
    expect(formatRecent('2026-09-29', undefined, '2026-09-30')).toBe('Ayer');
    expect(formatRecent('2026-09-27', undefined, '2026-09-30')).toBe('27 sep');
    expect(formatDateCO('2026-09-28')).toBe('28/09/2026');
  });
});
