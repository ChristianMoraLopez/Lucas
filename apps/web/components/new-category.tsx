'use client';

import { useState } from 'react';
import { Button } from '@/components/lucas-ui';
import { humanError } from '@/lib/errors';
import type { AccountCategory } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

/**
 * Crear una categoría propia («Salud», «Mascotas»…) sin salir del gasto. La
 * descripción es lo que lee Laya para elegirla, y de ella salen las palabras
 * clave: «droguería, citas médicas, exámenes, EPS».
 */
export function NuevaCategoria({ accountId, onCreated, onCancel }: { accountId: string; onCreated: (c: AccountCategory) => void; onCancel: () => void }) {
  const [supabase] = useState(() => createClient());
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const crear = async () => {
    setBusy(true);
    setError(null);
    const { data: id, error } = await supabase.rpc('create_category', {
      p_account_id: accountId,
      p_name: nombre,
      p_description: descripcion || null,
    });
    if (error) {
      setBusy(false);
      return setError(humanError(error));
    }
    const { data, error: e2 } = await supabase.from('categories').select('id, name, letter, tone, description, is_default').eq('id', id).single();
    setBusy(false);
    if (e2) return setError(humanError(e2));
    onCreated(data as AccountCategory);
  };

  return (
    <div className="nc" role="group" aria-labelledby="nc-t">
      <span className="lu-label" id="nc-t">
        Nueva categoría
      </span>
      <input
        className="wa-input"
        aria-label="Nombre de la categoría"
        placeholder="Salud"
        maxLength={30}
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        // biome-ignore lint/a11y/noAutofocus: aparece porque la persona la acaba de pedir
        autoFocus
      />
      <input
        className="wa-input"
        aria-label="¿Qué entra en ella?"
        placeholder="¿Qué entra? Droguería, citas médicas, exámenes, EPS"
        maxLength={300}
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
      />
      <span className="lu-small lu-muted">Con la descripción, Luks aprende a ponerla sola en los próximos gastos.</span>
      {error && (
        <p className="lu-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <div className="wa-row">
        <Button size="sm" onClick={crear} disabled={busy || nombre.trim().length < 2}>
          {busy ? 'Creando…' : 'Crear categoría'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
