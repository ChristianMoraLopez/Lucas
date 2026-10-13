'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, type MouseEvent, useState } from 'react';
import { lanzarChispas } from '@/components/chispas';
import { useT } from '@/components/idioma';
import { Avatar, Button, Field, LottieSlot } from '@/components/lucas-ui';
import { useRegion } from '@/components/region';
import { Segmento } from '@/components/segmento';
import { humanError } from '@/lib/errors';
import { IDIOMAS, NOMBRE_IDIOMA } from '@/lib/i18n';
import { chatHref, MISTER_LUKS } from '@/lib/mister-luks';
import { MONEDAS, NOMBRE_MONEDA } from '@/lib/moneda';
import { REGION } from '@/lib/region';
import { type GrupoVista, plural } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

const TIPOS = [
  { id: 'hogar', title: 'Hogar', text: 'Los gastos de todos los meses: mercado, servicios, arriendo. Con presupuesto mensual.' },
  { id: 'evento', title: 'Evento', text: 'Un paseo, una vaca, un cumpleaños. Tiene inicio y fin, y al final se liquida.' },
] as const;

/** Escribirle «luks soy yo» a Mister Luks (por privado): le manda el link para unir su número */
function SoyYo() {
  const t = useT();
  return (
    <a className="lu-btn lu-btn--secondary lu-btn--sm" href={chatHref(MISTER_LUKS.telefono, 'luks soy yo')} target="_blank" rel="noopener noreferrer">
      {t('Escribirle «luks soy yo»')}
    </a>
  );
}

/**
 * Crear la cuenta de un grupo de WhatsApp, o conectarlo a una cuenta que
 * administro, sin código: desde el link /g/ que manda Mister Luks, desde
 * «Nuevo grupo detectado» o desde los grupos de mi WhatsApp vinculado. Con
 * Mister Luks ya se sabe quién está en el grupo (nombre y últimos 4 números);
 * con el WhatsApp vinculado se lee al conectarlo.
 *
 * Si quien la crea está en el grupo pero Luks no reconoce su número, se le
 * pide «luks soy yo»: así no queda dos veces (la de su usuario y la del grupo).
 * Puede hacerlo antes o después: al verificar el número, las dos se unen.
 */
export function ConectarGrupo({ vista, token, miNombre }: { vista: GrupoVista; token: string | null; miNombre: string }) {
  const t = useT();
  const router = useRouter();
  const region = useRegion();
  const [supabase] = useState(() => createClient());
  const cuentas = vista.accounts ?? [];
  const [modo, setModo] = useState<'nueva' | 'existente'>('nueva');
  const [nombre, setNombre] = useState(vista.name ?? '');
  const [tipo, setTipo] = useState<'hogar' | 'evento'>('evento');
  const [inicio, setInicio] = useState('');
  const [fin, setFin] = useState('');
  const [yo, setYo] = useState(miNombre);
  const [moneda, setMoneda] = useState<string>(REGION[region].moneda);
  const [idioma, setIdioma] = useState<string>(t.idioma);
  const [cuenta, setCuenta] = useState(cuentas[0]?.id ?? '');
  const [estado, setEstado] = useState<{ busy?: boolean; error?: string }>({});

  const miembros = vista.members ?? [];
  const conocidos = miembros.filter((m) => m.user && !m.me).length;
  const ir = (id: string, e: { clientX: number; clientY: number; currentTarget: Element | null }) => {
    lanzarChispas(e);
    router.push(`/c/${id}/resumen`);
    router.refresh();
  };

  const crear = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const boton = (e.nativeEvent as SubmitEvent).submitter;
    const r = boton?.getBoundingClientRect();
    const chispas = { clientX: r ? r.left + r.width / 2 : 0, clientY: r ? r.top + r.height / 2 : 0, currentTarget: null };
    if (modo === 'nueva') {
      if (!nombre.trim()) return setEstado({ error: t('Ponle un nombre a la cuenta') });
      if (!yo.trim()) return setEstado({ error: t('Escribe cómo te dicen') });
      if (tipo === 'evento' && inicio && fin && fin < inicio) return setEstado({ error: t('La fecha de fin no puede ser antes de la de inicio') });
    } else if (!cuenta) {
      return setEstado({ error: t('Elige la cuenta') });
    }
    setEstado({ busy: true });
    const { data, error } =
      modo === 'nueva'
        ? await supabase.rpc('create_account_from_group', {
            p_group_id: vista.group_id,
            p_token: token,
            p_name: nombre.trim(),
            p_type: tipo,
            p_starts_on: tipo === 'evento' && inicio ? inicio : null,
            p_ends_on: tipo === 'evento' && fin ? fin : null,
            p_display_name: yo.trim(),
            p_currency: moneda,
            p_language: idioma,
          })
        : await supabase.rpc('link_group_to_account', { p_group_id: vista.group_id, p_token: token, p_account_id: cuenta });
    if (error) return setEstado({ error: humanError(error) });
    ir(data as string, chispas);
  };

  // Ya tiene cuenta y no estoy: entro si mi número verificado está en el grupo
  const entrar = async (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setEstado({ busy: true });
    const { data, error } = await supabase.rpc('create_account_from_group', {
      p_group_id: vista.group_id,
      p_token: token,
      p_name: null,
      p_type: 'hogar',
    });
    if (error) return setEstado({ error: humanError(error) });
    ir(data as string, { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, currentTarget: null });
  };

  const cabeza = (
    <div className="gr-cabeza">
      <LottieSlot name={vista.mister_luks ? 'mister-luks' : 'whatsapp-conectado'} width={96} height={96} label="" />
      <div className="gr-cabeza__txt">
        <span className="lu-label">{t('Grupo de WhatsApp')}</span>
        <h1 className="lu-display gr-nombre">{vista.name || t('Grupo sin nombre')}</h1>
        <p className="lu-small lu-muted" style={{ margin: 0 }}>
          {[
            vista.member_count ? plural(vista.member_count, t('persona'), t('personas')) : null,
            vista.via === 'mi_whatsapp' ? t('desde tu WhatsApp vinculado') : vista.mister_luks ? t('Mister Luks está en el grupo') : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
    </div>
  );

  if (vista.linked) {
    const l = vista.linked;
    return (
      <div className="nc gr">
        {cabeza}
        <div className="gr-aviso">
          <p style={{ margin: 0 }}>
            {l.member
              ? t('Este grupo ya está conectado a «{cuenta}».', { cuenta: l.account_name })
              : t('Este grupo ya tiene cuenta: «{cuenta}».', { cuenta: l.account_name })}
          </p>
          {!l.member && (
            <p className="lu-small lu-muted" style={{ margin: 0 }}>
              {vista.in_group
                ? t('Tu número está en el grupo: entras como tu persona de ahí.')
                : t('Para entrar, escribe «luks soy yo» en el grupo y abre el link que te manda Mister Luks. Así quedas como tu persona del grupo.')}
            </p>
          )}
        </div>
        {estado.error && (
          <p className="lu-error" role="alert" style={{ margin: 0 }}>
            {estado.error}
          </p>
        )}
        <div className="vf-btns" style={{ justifyContent: 'flex-start' }}>
          {l.member && l.account_id ? (
            <Link href={`/c/${l.account_id}/resumen`} className="lu-btn lu-btn--primary">
              {t('Ir a la cuenta')}
            </Link>
          ) : vista.in_group ? (
            <Button onClick={entrar} disabled={estado.busy}>
              {estado.busy ? t('Un momento…') : t('Entrar a la cuenta')}
            </Button>
          ) : (
            <SoyYo />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="nc gr">
      {cabeza}

      {miembros.length > 0 ? (
        <section className="gr-gente" aria-label={t('Quiénes están en el grupo')}>
          <ul className="gr-lista">
            {miembros.map((m) => (
              <li key={`${m.name}-${m.last4}`} className="gr-persona">
                <Avatar name={m.name} size="sm" registered={m.user} />
                <span className="gr-persona__nombre">{m.name}</span>
                <span className="lu-small lu-muted lu-num">••• {m.last4}</span>
                {m.me ? <span className="lu-role lu-role--admin">{t('Tú')}</span> : m.user ? <span className="lu-role">{t('Usa Luks')}</span> : null}
              </li>
            ))}
          </ul>
          <p className="lu-small lu-muted" style={{ margin: 0 }}>
            {conocidos
              ? t('Cada uno queda como persona de la cuenta. Los que ya usan Luks la ven de una vez.')
              : t('Cada uno queda como persona de la cuenta. Nadie más tiene que registrarse.')}
          </p>
        </section>
      ) : (
        vista.via === 'mi_whatsapp' && (
          <p className="lu-small lu-muted" style={{ margin: 0 }}>
            {t('Apenas lo conectes, Luks lee quiénes están en el grupo y cada uno queda como persona de la cuenta.')}
          </p>
        )
      )}

      {vista.in_group ? (
        <p className="lu-small gr-ok">{t('✓ Tu número está en el grupo: en la cuenta quedas como tu persona de ahí, no dos veces.')}</p>
      ) : (
        vista.mister_luks && (
          <div className="gr-aviso">
            <p style={{ margin: 0 }}>
              <b>{t('¿Estás en el grupo?')}</b>{' '}
              {t(
                'Para que no quedes dos veces (con tu usuario y con tu WhatsApp), escribe «luks soy yo» en el grupo o por privado a Mister Luks y abre el link que te llega. Puedes hacerlo antes o después de crear la cuenta.',
              )}
            </p>
            <SoyYo />
          </div>
        )
      )}

      <form onSubmit={crear} noValidate>
        {cuentas.length > 0 && (
          <Segmento
            label={t('Qué hacer con el grupo')}
            value={modo}
            onChange={(v) => {
              setModo(v);
              setEstado({});
            }}
            opciones={[
              { value: 'nueva', label: t('Crear una cuenta nueva') },
              { value: 'existente', label: t('Conectarlo a una mía') },
            ]}
          />
        )}

        {modo === 'nueva' ? (
          <>
            <div className="lu-field">
              <span className="lu-label" id="gr-tipo">
                {t('Tipo de cuenta')}
              </span>
              <div className="nc-types" role="radiogroup" aria-labelledby="gr-tipo">
                {TIPOS.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    role="radio"
                    aria-checked={tipo === x.id}
                    className={`nc-type nc-type--${x.id}${tipo === x.id ? ' is-on' : ''}`}
                    onClick={() => setTipo(x.id)}
                  >
                    <b>{t(x.title)}</b>
                    <span>{t(x.text)}</span>
                  </button>
                ))}
              </div>
            </div>
            <Field label={t('Nombre de la cuenta')} id="gr-nombre" value={nombre} onChange={setNombre} />
            {tipo === 'evento' && (
              <div className="nc-dates">
                <Field label={t('Empieza')} id="gr-inicio" num>
                  <input id="gr-inicio" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
                </Field>
                <Field label={t('Termina')} id="gr-fin" num>
                  <input id="gr-fin" type="date" value={fin} min={inicio || undefined} onChange={(e) => setFin(e.target.value)} />
                </Field>
              </div>
            )}
            <Field label={t('¿Cómo te dicen en el grupo?')} id="gr-yo" value={yo} onChange={setYo} />
            <div className="nc-dates">
              <Field label={t('Moneda')} id="gr-moneda">
                <select id="gr-moneda" value={moneda} onChange={(e) => setMoneda(e.target.value)}>
                  {MONEDAS.map((m) => (
                    <option key={m} value={m}>
                      {t(NOMBRE_MONEDA[m])} ({m})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('Luks responde en el grupo en')} id="gr-idioma">
                <select id="gr-idioma" value={idioma} onChange={(e) => setIdioma(e.target.value)}>
                  {IDIOMAS.map((i) => (
                    <option key={i} value={i}>
                      {NOMBRE_IDIOMA[i]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <span className="lu-small lu-muted nc-nota">
              {t('Luks anota lo que se escriba en el grupo desde que lo conectes. Lo de antes, más adelante con el chat exportado.')}
            </span>
          </>
        ) : (
          <Field label={t('Cuenta')} id="gr-cuenta">
            <select id="gr-cuenta" value={cuenta} onChange={(e) => setCuenta(e.target.value)}>
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.type === 'evento' ? t('Evento') : t('Hogar')}
                </option>
              ))}
            </select>
          </Field>
        )}

        {estado.error && (
          <p className="lu-error" role="alert" style={{ margin: 0 }}>
            {estado.error}
          </p>
        )}
        <div className="nc-go">
          <Button type="submit" disabled={estado.busy}>
            {estado.busy ? t('Un momento…') : modo === 'nueva' ? t('Crear la cuenta') : t('Conectar el grupo')}
          </Button>
          {vista.mister_luks && <span className="lu-small lu-muted">{t('Mister Luks lo cuenta en el grupo.')}</span>}
        </div>
      </form>
    </div>
  );
}
