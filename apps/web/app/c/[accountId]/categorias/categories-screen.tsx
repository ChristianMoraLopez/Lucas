'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Cargando } from '@/components/cargando';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useT } from '@/components/idioma';
import { nombreCategoria, type Tone } from '@/components/lucas-core';
import { Button, CategoryTag } from '@/components/lucas-ui';
import { NuevaCategoria } from '@/components/new-category';
import { humanError } from '@/lib/errors';
import { type AccountCategory, plural, type Role } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

/**
 * Las categorías de la cuenta. Las 8 de siempre no se renombran ni se borran
 * (Luks las conoce por su nombre), pero su descripción sí se ajusta; las
 * propias se crean, cambian y borran. La descripción es lo que lee Laya.
 */
export function CategoriesScreen({ accountId, myRole }: { accountId: string; myRole: Role }) {
  const t = useT();
  const [supabase] = useState(() => createClient());
  const queryClient = useQueryClient();
  const isAdmin = myRole !== 'member';
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cats = useQuery({
    queryKey: ['categorias', accountId],
    queryFn: async () => {
      const [c, usos] = await Promise.all([
        supabase
          .from('categories')
          .select('id, name, letter, tone, description, is_default')
          .eq('account_id', accountId)
          .order('is_default', { ascending: false })
          .order('name'),
        supabase.from('expenses').select('category_id').eq('account_id', accountId),
      ]);
      const err = c.error ?? usos.error;
      if (err) throw err;
      const cuenta = new Map<string, number>();
      for (const e of usos.data ?? []) if (e.category_id) cuenta.set(e.category_id, (cuenta.get(e.category_id) ?? 0) + 1);
      return { lista: c.data as AccountCategory[], usos: cuenta };
    },
  });
  const refrescar = () => queryClient.invalidateQueries({ queryKey: ['categorias', accountId] });

  return (
    <div className="cg">
      <header className="cg-head">
        <div>
          <h1 className="lu-display">{t('Categorías')}</h1>
          <p className="lu-small lu-muted" style={{ margin: '4px 0 0', maxWidth: '56ch' }}>
            {t('En qué se va la plata. Si algo no cabe en las de siempre, creen la suya: con una buena descripción, Luks la empieza a usar sola.')}
          </p>
        </div>
        <Link href={`/c/${accountId}/gastos`} className="lu-btn lu-btn--sm lu-btn--ghost">
          {t('← Gastos')}
        </Link>
      </header>

      {error && (
        <p className="lu-error" role="alert">
          {error}
        </p>
      )}
      {cats.isPending && <Cargando />}
      {cats.isError && (
        <p className="lu-error" role="alert">
          {humanError(cats.error)}
        </p>
      )}

      {cats.data && (
        <ul className="cg-list">
          {cats.data.lista.map((c) => (
            <Fila key={c.id} c={c} usos={cats.data.usos.get(c.id) ?? 0} isAdmin={isAdmin} onDone={refrescar} onError={setError} />
          ))}
        </ul>
      )}

      {isAdmin &&
        (creando ? (
          <NuevaCategoria
            accountId={accountId}
            onCancel={() => setCreando(false)}
            onCreated={() => {
              setCreando(false);
              refrescar();
            }}
          />
        ) : (
          <Button variant="secondary" onClick={() => setCreando(true)}>
            {t('+ Nueva categoría')}
          </Button>
        ))}
    </div>
  );
}

function Fila({ c, usos, isAdmin, onDone, onError }: { c: AccountCategory; usos: number; isAdmin: boolean; onDone: () => void; onError: (e: string) => void }) {
  const t = useT();
  const nombreVisible = nombreCategoria(c.name, t);
  const [supabase] = useState(() => createClient());
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(c.name);
  const [descripcion, setDescripcion] = useState(c.description ?? '');
  const [borrar, setBorrar] = useState(false);
  const [busy, setBusy] = useState(false);

  const guardar = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('update_category', {
      p_category_id: c.id,
      p_name: c.is_default ? null : nombre,
      p_description: descripcion,
    });
    setBusy(false);
    if (error) return onError(humanError(error));
    setEditando(false);
    onDone();
  };
  const eliminar = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('delete_category', { p_category_id: c.id });
    setBusy(false);
    setBorrar(false);
    if (error) return onError(humanError(error));
    onDone();
  };

  return (
    <li className="cg-row">
      <CategoryTag name={c.name} letter={c.letter} tone={c.tone as Tone} showName={false} size="lg" />
      {editando ? (
        <div className="cg-edit">
          {!c.is_default && <input className="wa-input" aria-label={t('Nombre')} maxLength={30} value={nombre} onChange={(e) => setNombre(e.target.value)} />}
          <input
            className="wa-input"
            aria-label={t('Qué entra en {nombre}', { nombre: nombreVisible })}
            placeholder={t('¿Qué entra en ella?')}
            maxLength={300}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
          <div className="wa-row">
            <Button size="sm" onClick={guardar} disabled={busy || (!c.is_default && nombre.trim().length < 2)}>
              {t('Guardar')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditando(false)} disabled={busy}>
              {t('Cancelar')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="cg-t">
          <b>
            {nombreVisible}
            {!c.is_default && <span className="cg-own">{t('propia')}</span>}
          </b>
          {/* Las descripciones de siempre también vienen en inglés (si nadie las cambió) */}
          <span className="lu-small lu-muted">{c.description ? (c.is_default ? t(c.description) : c.description) : t('Sin descripción')}</span>
          <span className="lu-small lu-muted">{plural(usos, t('gasto'), t('gastos'))}</span>
        </div>
      )}
      {isAdmin && !editando && (
        <div className="cg-acts">
          <Button size="sm" variant="ghost" onClick={() => setEditando(true)}>
            {t('Editar')}
          </Button>
          {!c.is_default && (
            <Button size="sm" variant="ghost" onClick={() => setBorrar(true)}>
              {t('Borrar')}
            </Button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={borrar}
        onOpenChange={setBorrar}
        title={t('¿Borrar «{nombre}»?', { nombre: nombreVisible })}
        confirmLabel={t('Borrar')}
        busy={busy}
        onConfirm={eliminar}
      >
        {usos ? `${usos === 1 ? t('Su gasto pasa a «Otros».') : t('Sus {n} gastos pasan a «Otros».', { n: usos })} ` : ''}
        {t('Luks olvida los comercios que tenía en esta categoría.')}
      </ConfirmDialog>
    </li>
  );
}
