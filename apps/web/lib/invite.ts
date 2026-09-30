/* Links y mensajes de invitación. El link corto es /e/CODIGO (como en el kit:
   lucas.co/e/PASEO-7K2Q) y lleva a /unirse con el código ya puesto. */

export function inviteLink(origin: string, code: string) {
  return `${origin}/e/${code}`;
}

/** El link sin protocolo, para mostrarlo: 'lucas.co/e/PASEO-7K2Q' */
export function displayLink(link: string) {
  return link.replace(/^https?:\/\//, '');
}

export function inviteMessage({ accountName, code, link, name }: { accountName: string; code: string; link: string; name?: string }) {
  const saludo = name ? `${name}, entra` : 'Entren';
  return `${saludo} a «${accountName}» en Lucas para ver y dividir los gastos. Código: ${code} · ${link}`;
}

/** Abre WhatsApp con el mensaje listo; con número, directo a esa persona. */
export function whatsappUrl(text: string, phone?: string) {
  const to = phone ? phone.replace(/\D/g, '') : '';
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

/** Texto bajo el código: 'Vence el 5 oct · sirve para 10 personas más' */
export function inviteHint(inv: { expires_at: string | null; max_uses: number | null; uses: number; role: string }, formatDay: (d: string) => string) {
  const partes = [
    inv.expires_at ? `Vence el ${formatDay(inv.expires_at)}` : 'No vence',
    inv.max_uses == null
      ? 'sin límite de personas'
      : inv.max_uses - inv.uses === 1
        ? 'sirve para 1 persona más'
        : `sirve para ${inv.max_uses - inv.uses} personas más`,
  ];
  if (inv.role === 'admin') partes.push('entran como admin');
  return partes.join(' · ');
}

/** ¿El código todavía sirve? (no revocado, no vencido, con cupo) */
export function isInviteActive(inv: { revoked_at: string | null; expires_at: string | null; max_uses: number | null; uses: number }, now = new Date()) {
  if (inv.revoked_at) return false;
  if (inv.expires_at && new Date(inv.expires_at) <= now) return false;
  if (inv.max_uses != null && inv.uses >= inv.max_uses) return false;
  return true;
}
