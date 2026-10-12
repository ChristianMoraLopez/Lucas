'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type MouseEvent, useState } from 'react';
import { lanzarChispas } from '@/components/chispas';
import { useT } from '@/components/idioma';
import { Button, LottieSlot } from '@/components/lucas-ui';
import { humanError } from '@/lib/errors';
import { chatHref, MISTER_LUKS } from '@/lib/mister-luks';
import { plural, type VerificacionWhatsapp } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

interface Resultado {
  accounts: number;
  taken_in: string[];
  last4: string;
}

export function Verificar({ codigo, vista, correo }: { codigo: string; vista: VerificacionWhatsapp; correo: string | null }) {
  const t = useT();
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [estado, setEstado] = useState<{ busy?: boolean; error?: string; listo?: Resultado }>({});

  const confirmar = async (e: MouseEvent<HTMLButtonElement>) => {
    const boton = { clientX: e.clientX, clientY: e.clientY, currentTarget: e.currentTarget };
    setEstado({ busy: true });
    const { data, error } = await supabase.rpc('redeem_whatsapp_verification', { p_token: codigo });
    if (error) return setEstado({ error: humanError(error) });
    lanzarChispas(boton);
    setEstado({ listo: data as Resultado });
  };

  // Entró con otro usuario: sale y vuelve a este mismo link
  const otraCuenta = async () => {
    setEstado({ busy: true });
    await supabase.auth.signOut();
    router.push(`/login?next=${encodeURIComponent(`/v/${codigo}`)}`);
    router.refresh();
  };

  const otroLink = (
    <a className="lu-btn lu-btn--primary" href={chatHref(MISTER_LUKS.telefono, 'luks soy yo')} target="_blank" rel="noopener noreferrer">
      {t('Escribirle a Mister Luks')}
    </a>
  );
  const seguir = (
    <div className="vf-btns">
      <Link href="/" className="lu-btn lu-btn--primary">
        {t('Ir a mis cuentas')}
      </Link>
      <Link href="/perfil#pf-wa" className="lu-btn lu-btn--secondary">
        {t('Ver mi perfil')}
      </Link>
    </div>
  );

  if (estado.listo) {
    const r = estado.listo;
    return (
      <main className="vf">
        <LottieSlot name="whatsapp-conectado" width={140} height={140} />
        <h1 className="lu-display">{t('¡Listo! Este WhatsApp es tuyo')}</h1>
        <p className="vf-num">WhatsApp ••• {r.last4}</p>
        <p className="lu-small lu-muted vf-txt" role="status">
          {r.accounts
            ? t('Mister Luks ya te reconoce en los grupos, y lo que mandes desde ese número queda a tu nombre en {cuentas}.', {
                cuentas: plural(r.accounts, t('cuenta'), t('cuentas')),
              })
            : t('Mister Luks ya te reconoce en los grupos. Cuando entres a una cuenta, lo que mandes desde ese número queda a tu nombre.')}
        </p>
        {r.taken_in.length > 0 && (
          <p className="lu-small vf-aviso">
            {t('En {cuentas} ese número ya es de otra persona: pídele a quien administra que lo arregle en «Conectar WhatsApp».', {
              cuentas: r.taken_in.join(', '),
            })}
          </p>
        )}
        {seguir}
      </main>
    );
  }

  if (vista.status === 'invalid') {
    return (
      <main className="vf">
        <LottieSlot name="no-encontrado" width={140} height={140} />
        <h1 className="lu-display">{t('Este link no sirve')}</h1>
        <p className="lu-small lu-muted vf-txt">{t('Puede que se haya cortado al copiarlo. Escríbele «luks soy yo» a Mister Luks y te manda uno nuevo.')}</p>
        {otroLink}
      </main>
    );
  }

  if (vista.mine) {
    return (
      <main className="vf">
        <LottieSlot name="whatsapp-conectado" width={140} height={140} />
        <h1 className="lu-display">{t('Este WhatsApp ya es tuyo')}</h1>
        <p className="vf-num">WhatsApp ••• {vista.last4}</p>
        <p className="lu-small lu-muted vf-txt">{t('Ya está verificado en tu cuenta de Luks. No hace falta nada más.')}</p>
        {seguir}
      </main>
    );
  }

  if (vista.status !== 'ok') {
    return (
      <main className="vf">
        <LottieSlot name="error" width={140} height={140} />
        <h1 className="lu-display">{vista.status === 'used' ? t('Este link ya se usó') : t('Este link ya venció')}</h1>
        <p className="lu-small lu-muted vf-txt">
          {vista.status === 'used'
            ? t('Cada link sirve una sola vez. Si necesitas otro, escríbele «luks soy yo» a Mister Luks.')
            : t('Dura 30 minutos. Escríbele otra vez «luks soy yo» a Mister Luks y te manda uno nuevo.')}
        </p>
        {otroLink}
      </main>
    );
  }

  return (
    <main className="vf">
      <LottieSlot name="mister-luks" width={140} height={140} />
      <h1 className="lu-display">{t('¿Este WhatsApp es tuyo?')}</h1>
      <p className="vf-num">WhatsApp ••• {vista.last4}</p>
      <p className="lu-small lu-muted vf-txt">
        {t('Al confirmarlo, Mister Luks te reconoce en los grupos y lo que mandes desde ese número queda a tu nombre en tus cuentas.')}
      </p>
      {vista.other && (
        <p className="lu-small vf-aviso">{t('Este número está verificado en otro usuario de Luks. Si el teléfono es tuyo, al confirmarlo pasa al tuyo.')}</p>
      )}
      {estado.error && (
        <p className="lu-error" role="alert" style={{ margin: 0 }}>
          {estado.error}
        </p>
      )}
      <Button onClick={confirmar} disabled={estado.busy}>
        {estado.busy ? t('Confirmando…') : t('Sí, es mío')}
      </Button>
      {correo && (
        <p className="lu-small lu-muted vf-txt">
          {t('Entraste como {correo}.', { correo })}{' '}
          <button type="button" className="vf-otra" onClick={otraCuenta} disabled={estado.busy}>
            {t('¿No eres tú? Entra con tu usuario')}
          </button>
        </p>
      )}
    </main>
  );
}
