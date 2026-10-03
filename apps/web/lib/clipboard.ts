/** Copia al portapapeles; si el navegador no deja (p. ej. dentro de otra app), con el método viejo */
export async function copiar(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/**
 * Copia un texto que todavía se está armando (p. ej. falta crear el link). El
 * celular solo deja copiar justo después del toque: con ClipboardItem la
 * copia queda pedida en el toque y el texto llega después.
 */
export async function copiarLuego(texto: Promise<string>) {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': texto.then((t) => new Blob([t], { type: 'text/plain' })) })]);
      return true;
    } catch {
      // Sigue con la copia normal
    }
  }
  return copiar(await texto);
}
