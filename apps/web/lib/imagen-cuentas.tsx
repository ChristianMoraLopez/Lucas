import { ImageResponse } from 'next/og';
import { formatCOP } from '@/components/lucas-core';
import { formatRange, monthName } from '@/lib/dates';
import { C, cargar, FUENTES, inicial, limpio, TONOS } from '@/lib/imagen-base';
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

export async function imagenCuentas(d: SharedOverview, { personId = null, cache }: { personId?: string | null; cache: string }) {
  const [figtree600, figtree800, bricolage800, logo] = await cargar();
  const people = new Map(d.people.map((p) => [p.id, p]));
  const nombre = (id: string) => limpio(people.get(id)?.name ?? 'Alguien', 18);
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
    ? `Evento${d.account.starts_on ? ` · ${formatRange(d.account.starts_on, d.account.ends_on)}` : ''}`
    : `${monthName(d.month as string)} ${(d.month as string).slice(0, 4)}`;

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
          Esto se hizo en
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
            <div style={{ display: 'flex', fontSize: 24, fontWeight: 800, opacity: 0.92 }}>{yo ? `${limpio(yo.name, 18)}, te toca` : 'Gastaron'}</div>
            <div style={{ display: 'flex', fontFamily: 'Bricolage', fontSize: 84, lineHeight: 1, marginTop: 8 }}>{formatCOP(yo ? yo.share : total)}</div>
            <div style={{ display: 'flex', fontSize: 24, marginTop: 14 }}>
              {yo
                ? `Puso ${formatCOP(yo.paid)}${porCabeza ? ' · igual que a todos' : ''}`
                : `entre ${d.people.length} · ${porCabeza ? `${formatCOP(porCabeza)} cada uno` : 'cada quien su parte'}`}
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
          <div style={{ display: 'flex', fontFamily: 'Bricolage', fontSize: 32 }}>{yo ? `Lo de ${limpio(yo.name, 16)}` : '¿Quién le paga a quién?'}</div>
          {contador && (
            <div style={{ display: 'flex', fontSize: 20, fontWeight: 800, color: C.verde }}>
              {pagadas === todas.length ? 'Todo pagado: quedaron a mano' : `${pagadas} de ${todas.length} pagadas`}
            </div>
          )}

          {filas.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
              <div style={{ display: 'flex', fontFamily: 'Bricolage', fontSize: 40, color: C.verde }}>{yo ? 'A paz y salvo' : 'Nadie le debe a nadie'}</div>
              <div style={{ display: 'flex', fontSize: 26, color: C.tinta2, marginTop: 8 }}>
                {yo ? 'No le debe a nadie y nadie le debe.' : 'Cada quien puso lo que le tocaba.'}
              </div>
            </div>
          ) : grande && yo ? (
            // Lo de una persona: a quién le paga (o quién le paga), en grande
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
              {filas.map((t, i) => (
                <div
                  key={`${t.from}-${t.to}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '18px 0',
                    borderTop: i ? `2px solid ${C.borde}` : 'none',
                    opacity: t.paid_at ? 0.5 : 1,
                  }}
                >
                  {avatar(t.from, 64)}
                  {flecha}
                  {avatar(t.to, 64)}
                  <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 10 }}>
                    <div style={{ display: 'flex', fontSize: 26, color: C.tinta2 }}>
                      {t.from === yo.id ? `${t.paid_at ? 'Le pagó' : 'Le paga'} a ${nombre(t.to)}` : `${nombre(t.from)} ${t.paid_at ? 'le pagó' : 'le paga'}`}
                    </div>
                    <div
                      style={{ display: 'flex', fontFamily: 'Bricolage', fontSize: 58, lineHeight: 1.05, textDecoration: t.paid_at ? 'line-through' : 'none' }}
                    >
                      {formatCOP(t.amount)}
                    </div>
                    {t.paid_at && <div style={{ display: 'flex', fontSize: 18, fontWeight: 800, color: C.verde, letterSpacing: 1 }}>PAGADO</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}>
              {filas.slice(0, caben).map((t, i) => (
                <div
                  key={`${t.from}-${t.to}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    height: 68,
                    borderTop: i ? `2px solid ${C.borde}` : 'none',
                    opacity: t.paid_at ? 0.5 : 1,
                  }}
                >
                  {avatar(t.from)}
                  {flecha}
                  {avatar(t.to)}
                  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginLeft: 6 }}>
                    <div style={{ display: 'flex', fontSize: 24, fontWeight: 800 }}>{nombre(t.from)}</div>
                    <div style={{ display: 'flex', fontSize: 20, color: C.tinta2 }}>
                      {t.paid_at ? `le pagó a ${nombre(t.to)}` : `le paga a ${nombre(t.to)}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <div
                      style={{
                        display: 'flex',
                        fontFamily: 'Bricolage',
                        fontSize: 32,
                        textDecoration: t.paid_at ? 'line-through' : 'none',
                      }}
                    >
                      {formatCOP(t.amount)}
                    </div>
                    {t.paid_at && <div style={{ display: 'flex', fontSize: 16, fontWeight: 800, color: C.verde, letterSpacing: 1 }}>PAGADO</div>}
                  </div>
                </div>
              ))}
              {filas.length > caben && (
                <div style={{ display: 'flex', fontSize: 22, fontWeight: 800, color: C.morado, marginTop: 8 }}>+{filas.length - caben} más en el link</div>
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
