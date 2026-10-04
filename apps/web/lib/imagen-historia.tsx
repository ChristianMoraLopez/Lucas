import { ImageResponse } from 'next/og';
import { formatCOP } from '@/components/lucas-core';
import { formatRange, monthName } from '@/lib/dates';
import { C, cargar, FUENTES, inicial, limpio, TONOS } from '@/lib/imagen-base';
import { MARCA, transfersFor } from '@/lib/share';
import { asTone, type SharedOverview } from '@/lib/types';

/*
 * Historias de Instagram (1080×1920): recomendar Luks y las cuentas de un
 * paseo. Lo importante queda entre los 230 px de arriba y los 250 de abajo,
 * donde Instagram pone el perfil y la caja de respuesta.
 */

const ANCHO = 1080;
const ALTO = 1920;
const MORADO_CLARO = '#7E4DF0';
const MORADO_OSCURO = '#5527D2';

const logoSrc = (logo: Buffer) => `data:image/svg+xml;base64,${logo.toString('base64')}`;

/** «Esto se hizo en mrluks.com», como en las demás imágenes de Luks */
function Publicidad({ grande = false }: { grande?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: grande ? '20px 40px' : '16px 34px',
        borderRadius: 60,
        background: C.tinta,
        color: C.papel,
        fontSize: grande ? 38 : 32,
        fontWeight: 600,
      }}
    >
      Esto se hizo en
      <span style={{ fontWeight: 800, color: C.amarillo }}>{MARCA}</span>
    </div>
  );
}

/** Recomendar Luks: para las cuentas del grupo y para los gastos personales */
export async function historiaLuks({ cache }: { cache: string }) {
  const [figtree600, figtree800, bricolage800, logo] = await cargar();
  const pasos = ['Le mandas el recibo al grupo de WhatsApp', 'Luks anota el gasto y lo divide', 'Y te dice quién le paga a quién'];

  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: ANCHO,
        height: ALTO,
        padding: '230px 84px 260px',
        background: C.morado,
        color: '#FFFFFF',
        fontFamily: 'Figtree',
        position: 'relative',
      }}
    >
      <div style={{ position: 'absolute', right: -280, top: -220, width: 780, height: 780, borderRadius: 780, background: MORADO_CLARO }} />
      <div style={{ position: 'absolute', left: -420, bottom: -360, width: 960, height: 960, borderRadius: 960, background: MORADO_OSCURO }} />
      {/* Monedas */}
      <div style={{ position: 'absolute', right: 100, top: 236, width: 112, height: 112, borderRadius: 112, background: C.amarillo }} />
      <div style={{ position: 'absolute', right: 228, top: 304, width: 56, height: 56, borderRadius: 56, background: '#2BD48A' }} />

      {/* flexShrink 0: si algo no cabe, que se note en vez de encimarse */}
      <div style={{ display: 'flex', flexShrink: 0 }}>
        <div style={{ display: 'flex', padding: '24px 36px', borderRadius: 40, background: '#FFFFFF' }}>
          {/* biome-ignore lint/performance/noImgElement: es una imagen generada (next/og), no una página */}
          <img src={logoSrc(logo)} width={244} height={80} alt="" />
        </div>
      </div>

      <div style={{ display: 'flex', flexShrink: 0, fontFamily: 'Bricolage', fontSize: 88, lineHeight: 1.04, marginTop: 56 }}>
        Cuentas claras, sin hacer cuentas.
      </div>

      <div style={{ display: 'flex', flexShrink: 0, flexDirection: 'column', gap: 22, marginTop: 52 }}>
        {pasos.map((p, i) => (
          <div
            key={p}
            style={{ display: 'flex', alignItems: 'center', gap: 28, padding: '28px 34px', borderRadius: 38, background: '#FFFFFF', color: C.tinta }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 78,
                height: 78,
                flex: 'none',
                borderRadius: 78,
                background: C.amarillo,
                fontFamily: 'Bricolage',
                fontSize: 42,
              }}
            >
              {i + 1}
            </div>
            <div style={{ display: 'flex', fontSize: 38, fontWeight: 800, lineHeight: 1.15 }}>{p}</div>
          </div>
        ))}
      </div>

      {/* El uso personal, como un sticker */}
      <div
        style={{
          display: 'flex',
          flexShrink: 0,
          flexDirection: 'column',
          gap: 10,
          marginTop: 44,
          padding: '32px 38px',
          borderRadius: 36,
          background: C.amarillo,
          color: C.tinta,
          transform: 'rotate(-2deg)',
        }}
      >
        <div style={{ display: 'flex', fontFamily: 'Bricolage', fontSize: 48 }}>¿Y tus gastos?</div>
        <div style={{ display: 'flex', fontSize: 33, fontWeight: 600, lineHeight: 1.25 }}>
          Arma un grupo de WhatsApp contigo mismo y Luks, mándate tus facturas y quedan organizadas por categoría.
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1 }} />
      <div style={{ display: 'flex', flexShrink: 0, flexDirection: 'column', alignItems: 'center', gap: 18 }}>
        <div style={{ display: 'flex', fontSize: 38, fontWeight: 800 }}>Es gratis</div>
        <div
          style={{
            display: 'flex',
            padding: '18px 52px 24px',
            borderRadius: 70,
            background: C.tinta,
            color: C.amarillo,
            fontFamily: 'Bricolage',
            fontSize: 92,
            transform: 'rotate(-3deg)',
          }}
        >
          {MARCA}
        </div>
      </div>
    </div>,
    { width: ANCHO, height: ALTO, fonts: FUENTES(figtree600, figtree800, bricolage800), headers: { 'Cache-Control': cache } },
  );
}

/** Las cuentas de un paseo (o de un mes del hogar): cuánto fue y quién le paga a quién */
export async function historiaCuentas(d: SharedOverview, { cache }: { cache: string }) {
  const [figtree600, figtree800, bricolage800, logo] = await cargar();
  const people = new Map(d.people.map((p) => [p.id, p]));
  const nombre = (id: string, max = 16) => limpio(people.get(id)?.name ?? 'Alguien', max);
  const tono = (id: string) => TONOS[asTone(people.get(id)?.tone, people.get(id)?.name ?? '')];
  const evento = d.account.type === 'evento';
  const total = d.people.reduce((s, p) => s + p.paid, 0);
  const partes = new Set(d.people.map((p) => p.share));
  const porCabeza = partes.size === 1 && total > 0 ? d.people[0].share : null;
  const todas = transfersFor(d);
  const pagadas = todas.filter((t) => t.paid_at).length;
  const caben = todas.length > 5 ? 4 : 5;
  const periodo = evento
    ? `Evento${d.account.starts_on ? ` · ${formatRange(d.account.starts_on, d.account.ends_on)}` : ''}`
    : `${monthName(d.month as string)} ${(d.month as string).slice(0, 4)}`;

  const avatar = (id: string) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 66,
        height: 66,
        flex: 'none',
        borderRadius: 66,
        background: tono(id),
        color: C.tinta,
        fontFamily: 'Bricolage',
        fontSize: 28,
      }}
    >
      {inicial(nombre(id))}
    </div>
  );

  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: ANCHO,
        height: ALTO,
        padding: '224px 72px 250px',
        background: C.papel,
        color: C.tinta,
        fontFamily: 'Figtree',
        position: 'relative',
      }}
    >
      <div style={{ position: 'absolute', left: -220, top: -260, width: 640, height: 640, borderRadius: 640, background: C.verdeSuave }} />
      <div style={{ position: 'absolute', right: -300, bottom: -320, width: 820, height: 820, borderRadius: 820, background: C.moradoSuave }} />

      {/* biome-ignore lint/performance/noImgElement: es una imagen generada (next/og), no una página */}
      <img src={logoSrc(logo)} width={228} height={75} alt="" />

      <div style={{ display: 'flex', fontSize: 30, fontWeight: 800, letterSpacing: 2, color: C.tinta2, textTransform: 'uppercase', marginTop: 44 }}>
        {periodo}
      </div>
      <div style={{ display: 'flex', fontFamily: 'Bricolage', fontSize: 88, lineHeight: 1.04, marginTop: 8 }}>{limpio(d.account.name, 30)}</div>

      <div
        style={{ display: 'flex', flexDirection: 'column', marginTop: 40, padding: '38px 46px 42px', borderRadius: 44, background: C.verde, color: '#FFFFFF' }}
      >
        <div style={{ display: 'flex', fontSize: 36, fontWeight: 800, opacity: 0.92 }}>Gastaron</div>
        <div style={{ display: 'flex', fontFamily: 'Bricolage', fontSize: 124, lineHeight: 1, marginTop: 10 }}>{formatCOP(total)}</div>
        <div style={{ display: 'flex', fontSize: 34, marginTop: 18 }}>
          entre {d.people.length} · {porCabeza ? `${formatCOP(porCabeza)} cada uno` : 'cada quien su parte'}
        </div>
      </div>

      <div style={{ display: 'flex', fontFamily: 'Bricolage', fontSize: 50, marginTop: 52 }}>¿Quién le paga a quién?</div>
      {d.settlement && todas.length > 0 && (
        <div style={{ display: 'flex', fontSize: 30, fontWeight: 800, color: C.verde, marginTop: 4 }}>
          {pagadas === todas.length ? 'Todo pagado: quedaron a mano' : `${pagadas} de ${todas.length} pagadas`}
        </div>
      )}
      {todas.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 24 }}>
          <div style={{ display: 'flex', fontFamily: 'Bricolage', fontSize: 56, color: C.verde }}>Nadie le debe a nadie</div>
          <div style={{ display: 'flex', fontSize: 34, color: C.tinta2, marginTop: 8 }}>Cada quien puso lo que le tocaba.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 14 }}>
          {todas.slice(0, caben).map((t, i) => (
            <div
              key={`${t.from}-${t.to}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                height: 104,
                borderTop: i ? `3px solid ${C.borde}` : 'none',
                opacity: t.paid_at ? 0.5 : 1,
              }}
            >
              {avatar(t.from)}
              <svg width="40" height="20" viewBox="0 0 40 16" aria-hidden="true">
                <path d="M2 8h32M28 3l6 5-6 5" fill="none" stroke={C.tinta2} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {avatar(t.to)}
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginLeft: 8 }}>
                <div style={{ display: 'flex', fontSize: 34, fontWeight: 800 }}>{nombre(t.from)}</div>
                <div style={{ display: 'flex', fontSize: 28, color: C.tinta2 }}>{`${t.paid_at ? 'le pagó' : 'le paga'} a ${nombre(t.to)}`}</div>
              </div>
              <div style={{ display: 'flex', fontFamily: 'Bricolage', fontSize: 46, textDecoration: t.paid_at ? 'line-through' : 'none' }}>
                {formatCOP(t.amount)}
              </div>
            </div>
          ))}
          {todas.length > caben && (
            <div style={{ display: 'flex', fontSize: 32, fontWeight: 800, color: C.morado, marginTop: 10 }}>+{todas.length - caben} más en el link</div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flex: 1 }} />
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Publicidad grande />
      </div>
    </div>,
    { width: ANCHO, height: ALTO, fonts: FUENTES(figtree600, figtree800, bricolage800), headers: { 'Cache-Control': cache } },
  );
}
