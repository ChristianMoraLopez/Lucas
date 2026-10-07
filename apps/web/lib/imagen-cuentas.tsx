import { ImageResponse } from 'next/og';
import { formatRange, monthName } from '@/lib/dates';
import { crearT, type T } from '@/lib/i18n';
import { C, cargar, FUENTES, inicial, limpio, TONOS } from '@/lib/imagen-base';
import { dinero, type Moneda } from '@/lib/moneda';
import { MARCA, personView, transfersFor } from '@/lib/share';
import { asTone, type SharedOverview } from '@/lib/types';

/*
 * La imagen de las cuentas (1200×630): cuánto fue y quién le paga a quién, con
 * los colores de Luks. Es la vista previa del link /r/TOKEN en WhatsApp y la
 * que se ve en Liquidar antes de mandarlo. Con una persona, lo de ella.
 */

const ANCHO = 1200;
const ALTO = 630;

/** Lee el mes de ?mes=2026-09 (hogar): «2026-09-01», o null */
export function mesDe(searchParams: URLSearchParams) {
  const mes = searchParams.get('mes');
  return mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes) ? `${mes}-01` : null;
}

export async function imagenCuentas(
  d: SharedOverview,
  { personId = null, cache, t = crearT('es'), moneda = 'COP' }: { personId?: string | null; cache: string; t?: T; moneda?: Moneda },
) {
  const [figtree600, figtree800, bricolage800, logo] = await cargar();
  const formatCOP = (n: number) => dinero(n, moneda, t.idioma);
  const people = new Map(d.people.map((p) => [p.id, p]));
  const nombre = (id: string) => limpio(people.get(id)?.name ?? t('Alguien'), 18);
  const tono = (id: string) => TONOS[asTone(people.get(id)?.tone, people.get(id)?.name ?? '')];
  const evento = d.account.type === 'evento';
  const total = d.people.reduce((s, p) => s + p.paid, 0);
  const partes = new Set(d.people.map((p) => p.share));
  const porCabeza = partes.size === 1 && total > 0 ? d.people[0].share : null;
  const todas = transfersFor(d);
  const yo = d.people.find((p) => p.id === personId) ?? null;
  const vista = yo ? personView(yo.id, todas) : null;
  const filas = vista ? [...vista.debe, ...vista.recibe] : todas;
  const pagadas = todas.filter((t) => t.paid_at).length;
  // Liquidada: cuántas van pagadas, bajo el título (le quita espacio a una fila)
  const contador = !yo && Boolean(d.settlement) && todas.length > 0;
  const caben = filas.length > 5 || (contador && filas.length === 5) ? 4 : 5;
  const grande = Boolean(yo) && filas.length <= 2;

  const periodo = evento
    ? `${t('Evento')}${d.account.starts_on ? ` · ${formatRange(d.account.starts_on, d.account.ends_on, t.idioma)}` : ''}`
    : `${monthName(d.month as string, t.idioma)} ${(d.month as string).slice(0, 4)}`;

  const avatar = (id: string, size = 46) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: size,
        background: tono(id),
        color: C.tinta,
        fontFamily: 'Bricolage',
        fontSize: size * 0.42,
      }}
    >
      {inicial(nombre(id))}
    </div>
  );
  const flecha = (
    <svg width="30" height="16" viewBox="0 0 40 16" aria-hidden="true">
      <path d="M2 8h32M28 3l6 5-6 5" fill="none" stroke={C.tinta2} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: ANCHO,
        height: ALTO,
        padding: '44px 56px 48px',
        background: C.papel,
        color: C.tinta,
        fontFamily: 'Figtree',
        position: 'relative',
      }}
    >
      {/* Las manchas de color de la imagen de Luks */}
      <div style={{ position: 'absolute', left: -150, top: -190, width: 420, height: 420, borderRadius: 420, background: C.verdeSuave }} />
      <div style={{ position: 'absolute', right: -170, bottom: -230, width: 520, height: 520, borderRadius: 520, background: C.moradoSuave }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* biome-ignore lint/performance/noImgElement: es una imagen generada (next/og), no una página */}
        <img src={`data:image/svg+xml;base64,${logo.toString('base64')}`} width={171} height={56} alt="" />
        {/* La publicidad: «Esto se hizo en mrluks.com» */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 22px',
            borderRadius: 40,
            background: C.tinta,
            color: C.papel,
            fontSize: 22,
            fontWeight: 600,
          }}
        >
          {t('Esto se hizo en')}
          <span style={{ fontWeight: 800, color: C.amarillo }}>{MARCA}</span>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, gap: 36, marginTop: 28 }}>
        {/* Cuánto fue */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: 500 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: 22, fontWeight: 800, letterSpacing: 2, color: C.tinta2, textTransform: 'uppercase' }}>{periodo}</div>
            <div style={{ display: 'flex', fontFamily: 'Bricolage', fontSize: 58, lineHeight: 1.05, marginTop: 8 }}>{limpio(d.account.name, 34)}</div>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              padding: '26px 32px 28px',
              borderRadius: 32,
              background: yo ? C.morado : C.verde,
              color: '#FFFFFF',
            }}
          >
            <div style={{ display: 'flex', fontSize: 24, fontWeight: 800, opacity: 0.92 }}>
              {yo ? t('{nombre}, te toca', { nombre: limpio(yo.name, 18) }) : t('Gastaron')}
            </div>
            <div style={{ display: 'flex', fontFamily: 'Bricolage', fontSize: 84, lineHeight: 1, marginTop: 8 }}>{formatCOP(yo ? yo.share : total)}</div>
            <div style={{ display: 'flex', fontSize: 24, marginTop: 14 }}>
              {yo
                ? `${t('Puso {monto}', { monto: formatCOP(yo.paid) })}${porCabeza ? ` · ${t('igual que a todos')}` : ''}`
                : `${t('entre {n}', { n: d.people.length })} · ${porCabeza ? t('{monto} cada uno', { monto: formatCOP(porCabeza) }) : t('cada quien su parte')}`}
            </div>
          </div>
        </div>

        {/* Quién le paga a quién */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            padding: '26px 30px',
            borderRadius: 32,
            background: '#FFFFFF',
            border: `2px solid ${C.borde}`,
          }}
        >
          <div style={{ display: 'flex', fontFamily: 'Bricolage', fontSize: 32 }}>
            {yo ? t('Lo de {nombre}', { nombre: limpio(yo.name, 16) }) : t('¿Quién le paga a quién?')}
          </div>
          {contador && (
            <div style={{ display: 'flex', fontSize: 20, fontWeight: 800, color: C.verde }}>
              {pagadas === todas.length ? t('Todo pagado: quedaron a mano') : t('{n} de {total} pagadas', { n: pagadas, total: todas.length })}
            </div>
          )}

          {filas.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
              <div style={{ display: 'flex', fontFamily: 'Bricolage', fontSize: 40, color: C.verde }}>
                {yo ? t('A paz y salvo') : t('Nadie le debe a nadie')}
              </div>
              <div style={{ display: 'flex', fontSize: 26, color: C.tinta2, marginTop: 8 }}>
                {yo ? t('No le debe a nadie y nadie le debe.') : t('Cada quien puso lo que le tocaba.')}
              </div>
            </div>
          ) : grande && yo ? (
            // Lo de una persona: a quién le paga (o quién le paga), en grande
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
              {filas.map((x, i) => (
                <div
                  key={`${x.from}-${x.to}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '18px 0',
                    borderTop: i ? `2px solid ${C.borde}` : 'none',
                    opacity: x.paid_at ? 0.5 : 1,
                  }}
                >
                  {avatar(x.from, 64)}
                  {flecha}
                  {avatar(x.to, 64)}
                  <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 10 }}>
                    <div style={{ display: 'flex', fontSize: 26, color: C.tinta2 }}>
                      {x.from === yo.id
                        ? x.paid_at
                          ? t('Le pagó a {nombre}', { nombre: nombre(x.to) })
                          : t('Le paga a {nombre}', { nombre: nombre(x.to) })
                        : x.paid_at
                          ? t('{nombre} le pagó', { nombre: nombre(x.from) })
                          : t('{nombre} le paga', { nombre: nombre(x.from) })}
                    </div>
                    <div
                      style={{ display: 'flex', fontFamily: 'Bricolage', fontSize: 58, lineHeight: 1.05, textDecoration: x.paid_at ? 'line-through' : 'none' }}
                    >
                      {formatCOP(x.amount)}
                    </div>
                    {x.paid_at && <div style={{ display: 'flex', fontSize: 18, fontWeight: 800, color: C.verde, letterSpacing: 1 }}>{t('PAGADO')}</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}>
              {filas.slice(0, caben).map((x, i) => (
                <div
                  key={`${x.from}-${x.to}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    height: 68,
                    borderTop: i ? `2px solid ${C.borde}` : 'none',
                    opacity: x.paid_at ? 0.5 : 1,
                  }}
                >
                  {avatar(x.from)}
                  {flecha}
                  {avatar(x.to)}
                  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginLeft: 6 }}>
                    <div style={{ display: 'flex', fontSize: 24, fontWeight: 800 }}>{nombre(x.from)}</div>
                    <div style={{ display: 'flex', fontSize: 20, color: C.tinta2 }}>
                      {x.paid_at ? t('le pagó a {nombre}', { nombre: nombre(x.to) }) : t('le paga a {nombre}', { nombre: nombre(x.to) })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <div
                      style={{
                        display: 'flex',
                        fontFamily: 'Bricolage',
                        fontSize: 32,
                        textDecoration: x.paid_at ? 'line-through' : 'none',
                      }}
                    >
                      {formatCOP(x.amount)}
                    </div>
                    {x.paid_at && <div style={{ display: 'flex', fontSize: 16, fontWeight: 800, color: C.verde, letterSpacing: 1 }}>{t('PAGADO')}</div>}
                  </div>
                </div>
              ))}
              {filas.length > caben && (
                <div style={{ display: 'flex', fontSize: 22, fontWeight: 800, color: C.morado, marginTop: 8 }}>
                  {t('+{n} más en el link', { n: filas.length - caben })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    {
      width: ANCHO,
      height: ALTO,
      fonts: FUENTES(figtree600, figtree800, bricolage800),
      headers: { 'Cache-Control': cache },
    },
  );
}
