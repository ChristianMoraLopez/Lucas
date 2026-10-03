'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/lucas-ui';
import { humanError } from '@/lib/errors';
import { createClient } from '@/utils/supabase/client';

/**
 * Cambiar el nombre de alguien en la cuenta: un alias para quien no tiene
 * usuario (lo pone quien administra), o el propio. A quien tiene usuario no
 * le cambia el nombre nadie más: lo elige esa persona.
 */
export function CambiarNombre({
  personId,
  actual,
  sinNombre,
  propio,
  onListo,
  onCerrar,
}: {
  personId: string;
  actual: string;
  /** Todavía se llama «WhatsApp 4567»: se pide el nombre desde cero */
  sinNombre: boolean;
  propio: boolean;
  onListo: () => void;
  onCerrar: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [nombre, setNombre] = useState(sinNombre ? '' : actual);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    const limpio = nombre.trim().replace(/\s+/g, ' ');
    if (!limpio) return setError('Escribe un nombre');
    if (limpio.length > 40) return setError('Máximo 40 letras');
    if (limpio === actual) return onCerrar();
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('rename_person', { p_person_id: personId, p_name: limpio });
    setBusy(false);
    if (error) return setError(humanError(error));
    onListo();
  };

  const id = `nombre-${personId}`;
  return (
    <form className="mb-nombre" onSubmit={guardar}>
      <label className="lu-label" htmlFor={id}>
        {propio ? 'Tu nombre en esta cuenta' : sinNombre ? `¿Cómo se llama ${actual}?` : `¿Cómo le dicen a ${actual}?`}
      </label>
      <input
        id={id}
        ref={input}
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCerrar()}
        maxLength={40}
        autoComplete="off"
        enterKeyHint="done"
        placeholder={propio ? 'Tu nombre' : 'Mafe, el primo Pipe…'}
        aria-describedby={`${id}-ayuda`}
      />
      <span className="lu-small lu-muted" id={`${id}-ayuda`}>
        {propio ? 'Así te ven los demás en esta cuenta.' : 'Así lo ven todos en la cuenta y ya no cambia con WhatsApp. Si entra a Luks, elige el suyo.'}
      </span>
      {error && (
        <p className="lu-field-error" role="alert">
          {error}
        </p>
      )}
      <div className="mb-btns">
        <Button size="sm" type="submit" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCerrar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
