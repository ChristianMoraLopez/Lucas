import type { Metadata } from 'next';
import Link from 'next/link';
import QRCode from 'qrcode';
import { IdiomaProvider } from '@/components/idioma';
import { LogoLink } from '@/components/logo-link';
import { Avatar, Logo, LottieSlot, Sticker } from '@/components/lucas-ui';
import { MenuPrincipal } from '@/components/menu-principal';
import { crearT, esIdioma, type T } from '@/lib/i18n';
import { rico } from '@/lib/i18n/rico';
import { getIdioma } from '@/lib/i18n/server';
import { archivosGuia, chatHref, MISTER_LUKS, vcardHref } from '@/lib/mister-luks';
import { formatear } from '@/lib/telefono';

/*
 * La guía de Mister Luks (mrluks.com/guia): qué es, cómo se agrega al grupo y
 * cómo se usa. La ve cualquiera, sin entrar. Con ?formato=imagen sale la
 * versión corta, vertical, que scripts/guia-archivos.mjs vuelve imagen (y la
 * página completa, PDF) para que Mister Luks la mande por WhatsApp.
 *
 * El idioma: el del link (?l=en), el que eligió quien la ve o el de su
 * navegador. Lo que todavía no hace Mister Luks lleva «Pronto»: al llegar
 * cada fase se quita de PRONTO y se vuelven a generar los archivos.
 */

type Seccion = 'que-es' | 'agregar' | 'anotar' | 'preguntar' | 'corregir' | 'desde-cuando' | 'consejos' | 'privacidad' | 'no-me-cuentes';
const PRONTO = new Set<Seccion>(['preguntar', 'corregir', 'desde-cuando', 'no-me-cuentes']);

const uno = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

async function idiomaDeLaGuia(l: string | undefined) {
  return crearT(esIdioma(l) ? l : await getIdioma());
}

export async function generateMetadata({ searchParams }: PageProps<'/guia'>): Promise<Metadata> {
  const t = await idiomaDeLaGuia(uno((await searchParams).l));
  const title = t('Guía de Mister Luks');
  const description = t('Agrega a Mister Luks al grupo de WhatsApp y manden los recibos: él anota los gastos y dice quién le paga a quién.');
  return { title, description, openGraph: { type: 'website', siteName: 'Luks', title, description } };
}

export default async function GuiaPage({ searchParams }: PageProps<'/guia'>) {
  const sp = await searchParams;
  const t = await idiomaDeLaGuia(uno(sp.l));
  const imagen = uno(sp.formato) === 'imagen';

  return <IdiomaProvider idioma={t.idioma}>{imagen ? <GuiaCorta t={t} /> : <GuiaCompleta t={t} />}</IdiomaProvider>;
}

function Pronto({ t }: { t: T }) {
  return (
    <Sticker tone="pendiente" size="sm" rotate={-3}>
      {t('Pronto')}
    </Sticker>
  );
}

/** Una conversación de ejemplo, como se ve en el grupo */
function Chat({ mensajes, t }: { mensajes: { de: string; texto: string }[]; t: T }) {
  return (
    <ul className="ml-chat" aria-label={t('Ejemplo en el grupo')}>
      {mensajes.map((m) => {
        const luks = m.de === MISTER_LUKS.nombre;
        return (
          <li key={m.texto} className={`ml-msg${luks ? ' ml-msg--luks' : ''}`}>
            {luks ? (
              <span className="ml-msg__luks" aria-hidden="true">
                {/* biome-ignore lint/performance/noImgElement: ícono SVG fijo, next/image no le aporta nada */}
                <img src="/brand/luks-icono-plano.svg" alt="" width={20} height={19} />
              </span>
            ) : (
              <Avatar name={m.de} size="xs" />
            )}
            <span className="ml-msg__burbuja">
              <b className="ml-msg__de">{m.de}</b>
              {m.texto}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Paso({ n, id, titulo, pronto, children }: { n: number; id: Seccion; titulo: string; pronto?: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="ml-paso lu-al-verse" id={id} aria-labelledby={`${id}-t`}>
      <h2 className="lu-title ml-paso__t" id={`${id}-t`}>
        <span className="ml-n" aria-hidden="true">
          {n}
        </span>
        {titulo}
        {pronto}
      </h2>
      {children}
    </li>
  );
}

async function GuiaCompleta({ t }: { t: T }) {
  const tel = MISTER_LUKS.telefono;
  const chat = chatHref(tel, t('Hola'));
  const qr = await QRCode.toDataURL(chat, { margin: 1, width: 360 });
  const archivos = archivosGuia(t.idioma);
  const pronto = (s: Seccion) => (PRONTO.has(s) ? <Pronto t={t} /> : null);
  const cita = (texto: string) => <q className="ml-cita">{texto}</q>;

  return (
    <div className="lu-app">
      <header className="lu-app__bar ml-bar">
        <LogoLink />
        <Link href="/" className="lu-btn lu-btn--sm lu-btn--secondary sh-bar-cta">
          {t('Abrir Luks')}
        </Link>
        <MenuPrincipal sesion={false} />
      </header>

      <main className="ml" lang={t.idioma}>
        <header className="ml-head">
          <span className="lu-label">{t('Guía de Mister Luks')}</span>
          <h1 className="lu-display">{t('Así funciona Mister Luks')}</h1>
          <p className="ml-lead">
            {t(
              'Es el número de WhatsApp de Luks. Lo agregan al grupo, mandan los recibos como siempre y él los anota: cuánto puso cada uno, cuánto le toca y quién le paga a quién.',
            )}
          </p>
        </header>

        <section className="ml-contacto" aria-labelledby="ml-contacto-t">
          <div className="ml-contacto__txt">
            <span className="ml-contacto__dibujo" aria-hidden="true">
              <LottieSlot name="mister-luks" width={72} height={72} label="" alVerse />
            </span>
            <h2 className="lu-label" id="ml-contacto-t" style={{ margin: 0 }}>
              {t('Guárdalo como contacto')}
            </h2>
            <span className="ml-tel lu-num">{formatear(tel)}</span>
            <span className="lu-small lu-muted">{t('Aparece como «{nombre}».', { nombre: MISTER_LUKS.nombre })}</span>
            <div className="wa-row ml-acciones">
              <a className="lu-btn lu-btn--sm lu-btn--primary" download="Mister Luks.vcf" href={vcardHref(tel)}>
                {t('Guardar contacto')}
              </a>
              <a className="lu-btn lu-btn--sm lu-btn--secondary" href={chat} target="_blank" rel="noopener noreferrer">
                {t('Abrir chat con Mister Luks')}
              </a>
            </div>
            <div className="wa-row ml-acciones">
              <a className="lu-btn lu-btn--sm lu-btn--ghost" href={archivos.pdf} download>
                {t('Descargar en PDF')}
              </a>
              <a className="lu-btn lu-btn--sm lu-btn--ghost" href={archivos.imagen} download>
                {t('Imagen para compartir')}
              </a>
            </div>
          </div>
          <figure className="ml-qr">
            {/* biome-ignore lint/performance/noImgElement: QR generado en el servidor como data: URI */}
            <img src={qr} alt={t('Código QR para abrir el chat con Mister Luks')} width={180} height={180} />
            <figcaption className="lu-small lu-muted">{t('Escanéalo con la cámara del celular')}</figcaption>
          </figure>
        </section>

        <ol className="ml-pasos">
          <Paso n={1} id="que-es" titulo={t('¿Qué es Mister Luks?')}>
            <p>
              {t(
                'Un contacto más del grupo, pero que lleva las cuentas. Lee las fotos de recibos, los PDFs y los mensajes con montos, y los vuelve gastos en mrluks.com, divididos entre el grupo.',
              )}
            </p>
            <p>{t('Solo escribe para confirmar lo que anotó y para responder cuando le preguntan. Nadie más tiene que instalar nada.')}</p>
          </Paso>

          <Paso n={2} id="agregar" titulo={t('Agrégalo al grupo')}>
            <ul className="ml-lista">
              <li>{t('Guarda el número como contacto y agrégalo al grupo como a cualquiera.')}</li>
              <li>
                {rico(t('¿No te deja agregarlo? Mándale por privado el link del grupo ({ruta}) y entra solo.'), {
                  ruta: <b>{t('Info del grupo → Invitar con enlace')}</b>,
                })}
              </li>
              <li>
                {rico(
                  t('{una} del grupo se registra en mrluks.com y conecta el grupo. Los demás no hacen nada: quedan en la cuenta con su nombre de WhatsApp.'),
                  {
                    una: <b>{t('Una sola persona')}</b>,
                  },
                )}
              </li>
            </ul>
            <p className="ml-nota">
              {t(
                '¿El grupo no acepta a nadie más? En mrluks.com también puedes vincular tu propio WhatsApp, como WhatsApp Web: Luks lee el grupo desde ahí sin agregar a nadie.',
              )}
            </p>
          </Paso>

          <Paso n={3} id="anotar" titulo={t('Manden los gastos')}>
            <ul className="ml-lista">
              <li>{t('La foto del recibo o la factura en PDF.')}</li>
              <li>{rico(t('O escrito: {a}, {b}.'), { a: cita(t('taxi 45 lucas')), b: cita(t('mercado 120.000')) })}</li>
              <li>{rico(t('Varias cosas en un mensaje se suman: {a}.'), { a: cita(t('hielo 8 mil, gaseosas 12 mil')) })}</li>
              <li>{rico(t('¿Pagó otra persona? {a}.'), { a: cita(t('la pagó Andrés')) })}</li>
              <li>{rico(t('¿No es entre todos? {a}.'), { a: cita(t('entre Vale y Caro')) })}</li>
            </ul>
            <Chat
              t={t}
              mensajes={[
                { de: 'Mafe', texto: t('taxi al aeropuerto 45 lucas, la pagó Andrés') },
                { de: MISTER_LUKS.nombre, texto: t('✅ Anotado: Taxi · $45.000 · pagó Andrés.') },
                { de: 'Santi', texto: t('pizza 60 mil, entre Vale y Caro') },
                { de: MISTER_LUKS.nombre, texto: t('✅ Anotado: Pizza · $60.000 · entre 2.') },
              ]}
            />
          </Paso>

          <Paso n={4} id="preguntar" titulo={t('Pregúntenle')} pronto={pronto('preguntar')}>
            <ul className="ml-lista">
              <li>
                {rico(t('Escribe @ y elige a Mister Luks: {a}, {b} o {c}.'), {
                  a: cita(t('@Mister Luks cuánto llevamos')),
                  b: cita(t('quién le debe a quién')),
                  c: cita(t('cuánto debo')),
                })}
              </li>
              <li>
                {t('Lo del grupo lo responde ahí mismo. Lo tuyo («cuánto debo», «mis gastos») te pregunta si lo quieres por privado o aquí, y se acuerda.')}
              </li>
              <li>{rico(t('Para cambiarlo: {a} o {b}.'), { a: cita(t('@Mister Luks mándame al privado')), b: cita(t('@Mister Luks dímelo aquí')) })}</li>
            </ul>
          </Paso>

          <Paso n={5} id="corregir" titulo={t('Corrijan respondiendo su mensaje')} pronto={pronto('corregir')}>
            <ul className="ml-lista">
              <li>
                {rico(t('Mantén presionada la confirmación de Mister Luks, toca Responder y escribe {a}, {b} o {c}.'), {
                  a: cita(t('lo pagó Andrés')),
                  b: cita(t('entre Vale y Caro')),
                  c: cita(t('borrar')),
                })}
              </li>
              <li>{t('Para borrar te pide un «sí». Puede corregir quien mandó el recibo o un admin de la cuenta.')}</li>
              <li>{t('Todo también se corrige en mrluks.com.')}</li>
            </ul>
          </Paso>

          <Paso n={6} id="desde-cuando" titulo={t('¿Desde cuándo anoto?')} pronto={pronto('desde-cuando')}>
            <p>
              {t('Al conectar el grupo, Mister Luks pregunta: «1 Desde ahora · 2 Todo el chat». Cualquiera del grupo responde, y lo pueden cambiar después:')}
            </p>
            <p>{rico(t('{a} o {b}.'), { a: cita(t('@Mister Luks desde ya')), b: cita(t('@Mister Luks lee todo')) })}</p>
            <p>
              {t(
                'Mister Luks no puede leer lo que mandaron antes de que lo agregaran. Para traerlo, exporten el chat y mándenle el .zip (por privado o en el grupo), o súbanlo en mrluks.com. Mientras llega, anota lo nuevo.',
              )}
            </p>
            <ul className="ml-lista">
              <li>{rico(t('Android: {ruta}.'), { ruta: <b>{t('⋮ → Más → Exportar chat → Incluir archivos')}</b> })}</li>
              <li>{rico(t('iPhone: {ruta}.'), { ruta: <b>{t('nombre del grupo → Exportar chat → Adjuntar archivos')}</b> })}</li>
            </ul>
          </Paso>

          <Paso n={7} id="consejos" titulo={t('Consejos')}>
            <ul className="ml-lista">
              <li>{t('Nada de fotos de «ver una vez»: Mister Luks no las puede abrir.')}</li>
              <li>{t('Fotos nítidas, derechas y con el total a la vista.')}</li>
              <li>{t('PDF de máximo 6 MB.')}</li>
              <li>{t('Si en el grupo solo los admins envían mensajes, Mister Luks lee igual, pero para confirmar tiene que ser admin.')}</li>
            </ul>
          </Paso>

          <Paso n={8} id="privacidad" titulo={t('Privacidad')}>
            <ul className="ml-lista">
              <li>{t('Mister Luks solo guarda lo que parece un gasto: fotos, PDFs y mensajes con montos. La charla del grupo no sale de WhatsApp.')}</li>
              <li>{t('Los gastos solo los ven las personas de la cuenta.')}</li>
              <li>
                {rico(t('¿Prefieres que no te cuente? Escribe {a} y deja de anotar lo que tú mandes.'), { a: cita(t('@Mister Luks no me cuentes')) })}{' '}
                {pronto('no-me-cuentes')}
              </li>
              <li>{t('Puedes borrar tu usuario y tus datos cuando quieras, desde tu perfil en mrluks.com.')}</li>
            </ul>
          </Paso>
        </ol>

        <footer className="ml-pie">
          <p className="lu-small" style={{ margin: 0 }}>
            {rico(t('¿Dudas? Escríbele {ayuda} a Mister Luks y te manda esta guía.'), { ayuda: cita(t('ayuda')) })}
          </p>
          <Link href="/" className="lu-btn lu-btn--primary">
            {t('Abrir Luks')}
          </Link>
        </footer>
      </main>
    </div>
  );
}

/** La versión corta y vertical: se lee en el chat sin abrir nada (1080 px de ancho) */
function GuiaCorta({ t }: { t: T }) {
  const pronto = (s: Seccion) => (PRONTO.has(s) ? <Pronto t={t} /> : null);
  const filas: { id: Seccion; titulo: string; texto: string }[] = [
    { id: 'que-es', titulo: t('Qué es'), texto: t('El número de Luks: lee el grupo y anota los gastos.') },
    {
      id: 'agregar',
      titulo: t('Agrégalo'),
      texto: t('Al grupo, o mándale el link del grupo por privado. Una persona se registra en mrluks.com; los demás, nada.'),
    },
    { id: 'anotar', titulo: t('Manden los gastos'), texto: t('Fotos, PDFs o «taxi 45 lucas». «la pagó Andrés» · «entre Vale y Caro».') },
    { id: 'preguntar', titulo: t('Pregúntenle'), texto: t('@Mister Luks cuánto llevamos · quién le debe a quién · cuánto debo.') },
    { id: 'corregir', titulo: t('Corrijan'), texto: t('Respondan su mensaje: «lo pagó Andrés» o «borrar».') },
    { id: 'desde-cuando', titulo: t('Lo de antes'), texto: t('Exporten el chat y mándenle el .zip.') },
    { id: 'consejos', titulo: t('Consejos'), texto: t('Nada de «ver una vez». Fotos nítidas. PDF de máximo 6 MB.') },
    { id: 'privacidad', titulo: t('Privacidad'), texto: t('La charla del grupo no se guarda: solo los gastos.') },
  ];
  return (
    <main className="ml-img" lang={t.idioma}>
      <header className="ml-img__head">
        <Logo size={22} />
        <span className="lu-label">{t('Guía de Mister Luks')}</span>
        <span className="ml-img__nombre">{MISTER_LUKS.nombre}</span>
        <span className="ml-img__tel lu-num">{formatear(MISTER_LUKS.telefono)}</span>
        <span className="ml-img__sub">{t('Guárdalo y agrégalo al grupo de WhatsApp')}</span>
      </header>
      <ol className="ml-img__filas">
        {filas.map((f, i) => (
          <li key={f.id} className="ml-img__fila">
            <span className="ml-n" aria-hidden="true">
              {i + 1}
            </span>
            <span className="ml-img__txt">
              <b>
                {f.titulo}
                {pronto(f.id)}
              </b>
              <span>{f.texto}</span>
            </span>
          </li>
        ))}
      </ol>
      <footer className="ml-img__pie">
        {rico(t('Guía completa: {url} · ¿Dudas? Escríbele {ayuda}'), { url: <b>mrluks.com/guia</b>, ayuda: <b>{t('«ayuda»')}</b> })}
      </footer>
    </main>
  );
}
