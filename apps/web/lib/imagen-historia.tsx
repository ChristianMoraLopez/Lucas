import { ImageResponse } from 'next/og';
import { crearT, type T } from '@/lib/i18n';
import { C, cargar, FUENTES } from '@/lib/imagen-base';
import { MARCA } from '@/lib/share';

/*
 * La historia de Instagram para recomendar Luks (1080×1920). Lo importante
 * queda entre los 230 px de arriba y los 250 de abajo, donde Instagram pone el
 * perfil y la caja de respuesta.
 */

const ANCHO = 1080;
const ALTO = 1920;
const MORADO_CLARO = '#7E4DF0';
const MORADO_OSCURO = '#5527D2';

const logoSrc = (logo: Buffer) => `data:image/svg+xml;base64,${logo.toString('base64')}`;

/** Recomendar Luks: para las cuentas del grupo y para los gastos personales */
export async function historiaLuks({ cache, t = crearT('es') }: { cache: string; t?: T }) {
  const [figtree600, figtree800, bricolage800, logo] = await cargar();
  const pasos = [t('Le mandas el recibo al grupo de WhatsApp'), t('Luks anota el gasto y lo divide'), t('Y te dice quién le paga a quién')];

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
        {t('Cuentas claras, sin hacer cuentas.')}
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
        <div style={{ display: 'flex', fontFamily: 'Bricolage', fontSize: 48 }}>{t('¿Y tus gastos?')}</div>
        <div style={{ display: 'flex', fontSize: 33, fontWeight: 600, lineHeight: 1.25 }}>
          {t('Arma un grupo de WhatsApp contigo mismo y Luks, mándate tus facturas y quedan organizadas por categoría.')}
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1 }} />
      <div style={{ display: 'flex', flexShrink: 0, flexDirection: 'column', alignItems: 'center', gap: 18 }}>
        <div style={{ display: 'flex', fontSize: 38, fontWeight: 800 }}>{t('Es gratis')}</div>
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
