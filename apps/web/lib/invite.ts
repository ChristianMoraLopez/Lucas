import { crearT, type T } from '@/lib/i18n';

/* Links y mensajes de invitación. El link corto es /e/CODIGO (como en el kit:
   luks.co/e/PASEO-7K2Q) y lleva a /unirse con el código ya puesto. */

export function inviteLink(origin: string, code: string) {
  return `${origin}/e/${code}`;
}

/** El link sin protocolo, para mostrarlo: 'luks.co/e/PASEO-7K2Q' */
export function displayLink(link: string) {
  return link.replace(/^https?:\/\//, '');
}

const ES = crearT('es');

export function inviteMessage({ accountName, code, link, name, t = ES }: { accountName: string; code: string; link: string; name?: string; t?: T }) {
  const vars = { nombre: name ?? '', cuenta: accountName, codigo: code, link };
  return name
    ? t('{nombre}, entra a «{cuenta}» en Luks para ver y dividir los gastos. Código: {codigo} · {link}', vars)
    : t('Entren a «{cuenta}» en Luks para ver y dividir los gastos. Código: {codigo} · {link}', vars);
}

/** Abre WhatsApp con el mensaje listo; con número, directo a esa persona. */
export function whatsappUrl(text: string, phone?: string) {
  const to = phone ? phone.replace(/\D/g, '') : '';
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

/** Texto bajo el código: 'Vence el 5 oct · sirve para 10 personas más' */
export function inviteHint(
  inv: { expires_at: string | null; max_uses: number | null; uses: number; role: string },
  formatDay: (d: string) => string,
  t: T = ES,
) {
  const partes = [
    inv.expires_at ? t('Vence el {dia}', { dia: formatDay(inv.expires_at) }) : t('No vence'),
    inv.max_uses == null
      ? t('sin límite de personas')
      : inv.max_uses - inv.uses === 1
        ? t('sirve para 1 persona más')
        : t('sirve para {n} personas más', { n: inv.max_uses - inv.uses }),
  ];
  if (inv.role === 'admin') partes.push(t('entran como admin'));
  return partes.join(' · ');
}

/** ¿El código todavía sirve? (no revocado, no vencido, con cupo) */
export function isInviteActive(inv: { revoked_at: string | null; expires_at: string | null; max_uses: number | null; uses: number }, now = new Date()) {
  if (inv.revoked_at) return false;
  if (inv.expires_at && new Date(inv.expires_at) <= now) return false;
  if (inv.max_uses != null && inv.uses >= inv.max_uses) return false;
  return true;
}
