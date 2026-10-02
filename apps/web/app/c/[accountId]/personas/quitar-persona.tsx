'use client';

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useId, useState } from 'react';
import { Button } from '@/components/lucas-ui';
import { type PersonRow, plural } from '@/lib/types';

/**
 * Quitar a alguien de la cuenta, de una de dos formas:
 *   · Sacar (solo si tiene usuario): deja de ver la cuenta; su nombre y sus
 *     gastos se quedan, por si vuelve a entrar con un código.
 *   · Eliminar: se borra, y lo que pagó y su parte de cada gasto pasan a otra
 *     persona (delete_person). Si era la misma persona repetida, también su
 *     WhatsApp.
 */
export function QuitarPersona({
  persona,
  otras,
  busy,
  onClose,
  onSacar,
  onEliminar,
}: {
  persona: PersonRow;
  /** A quiénes se les pueden pasar sus gastos */
  otras: PersonRow[];
  busy: boolean;
  onClose: () => void;
  onSacar: () => void;
  onEliminar: (a: string, whatsapp: boolean) => void;
}) {
  const conUsuario = Boolean(persona.user_id);
  const [modo, setModo] = useState<'sacar' | 'eliminar'>(conUsuario ? 'sacar' : 'eliminar');
  const [a, setA] = useState('');
  const [whatsapp, setWhatsapp] = useState(false);
  const id = useId();
  const destino = otras.find((o) => o.person_id === a)?.display_name;

  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="lu-dialog__overlay" />
        <AlertDialog.Content className="lu-dialog qp">
          <AlertDialog.Title className="lu-title">¿Quitar a {persona.display_name}?</AlertDialog.Title>

          {conUsuario ? (
            <AlertDialog.Description className="lu-sr">
              Elige si solo sale de la cuenta o si se elimina y sus gastos pasan a otra persona.
            </AlertDialog.Description>
          ) : null}
          {conUsuario ? (
            <fieldset className="qp-modos">
              <legend className="lu-sr">Cómo quitarlo</legend>
              <label className={`qp-modo${modo === 'sacar' ? ' is-on' : ''}`}>
                <input type="radio" name={`${id}-modo`} checked={modo === 'sacar'} onChange={() => setModo('sacar')} />
                <span className="qp-modo__txt">
                  <b>Sacar de la cuenta</b>
                  <span className="lu-small lu-muted">Deja de ver la cuenta. Su nombre y sus gastos se quedan, por si vuelve a entrar con un código.</span>
                </span>
              </label>
              <label className={`qp-modo${modo === 'eliminar' ? ' is-on' : ''}`}>
                <input type="radio" name={`${id}-modo`} checked={modo === 'eliminar'} onChange={() => setModo('eliminar')} />
                <span className="qp-modo__txt">
                  <b>Eliminar y pasar sus gastos a otra persona</b>
                  <span className="lu-small lu-muted">Se borra de la cuenta. Lo que pagó y su parte de cada gasto pasan a quien elijas.</span>
                </span>
              </label>
            </fieldset>
          ) : (
            <AlertDialog.Description className="lu-dialog__text">
              Se borra de la cuenta. Lo que pagó y su parte de cada gasto pasan a quien elijas; los totales no cambian.
            </AlertDialog.Description>
          )}

          {modo === 'eliminar' && (
            <div className="qp-a">
              <label htmlFor={`${id}-a`} className="lu-label">
                Sus gastos pasan a
              </label>
              <select id={`${id}-a`} value={a} onChange={(e) => setA(e.target.value)} className="qp-sel">
                <option value="">Elige a alguien…</option>
                {otras.map((o) => (
                  <option key={o.person_id} value={o.person_id as string}>
                    {o.display_name}
                  </option>
                ))}
              </select>
              <span className="lu-small lu-muted">
                {persona.paid_count ? `Pagó ${plural(persona.paid_count, 'gasto', 'gastos')}` : 'No ha pagado ningún gasto'}
                {destino ? `; desde ahora quedan a nombre de ${destino}.` : '.'}
              </span>
              {persona.wa_last4 && (
                <label className="qp-check">
                  <input type="checkbox" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} />
                  <span className="lu-small">
                    Era la misma persona repetida: su WhatsApp (••• {persona.wa_last4}) también pasa{destino ? ` a ${destino}` : ''}
                  </span>
                </label>
              )}
            </div>
          )}

          <div className="lu-dialog__btns">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary" size="sm">
                Cancelar
              </Button>
            </AlertDialog.Cancel>
            <Button
              size="sm"
              variant="secondary"
              className="lu-btn--danger"
              disabled={busy || (modo === 'eliminar' && !a)}
              onClick={(e) => {
                e.preventDefault();
                if (modo === 'sacar') onSacar();
                else onEliminar(a, whatsapp);
              }}
            >
              {busy ? 'Un momento…' : modo === 'sacar' ? 'Sacar' : 'Eliminar'}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
