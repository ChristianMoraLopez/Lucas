'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useT } from '@/components/idioma';
import { Button } from '@/components/lucas-ui';
import { Segmento } from '@/components/segmento';
import { formatDay, todayInBogota } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import type { T } from '@/lib/i18n';
import { type HistoriaCuenta, type ImportacionChat, plural } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

/** Hasta el límite del bucket «importaciones» */
const MAX_MB = 50;

const dia = (iso: string, t: T) => formatDay(todayInBogota(new Date(iso)), undefined, t.idioma);

/** «Chat de WhatsApp con Paseo.zip» → «Chat_de_WhatsApp_con_Paseo.zip» (para la ruta en Storage) */
const nombreSeguro = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'chat.zip';

/**
 * ¿Desde cuándo anota Luks en cada grupo? Desde que se conectó, o todo el chat.
 * Luks no alcanza a ver lo que se escribió antes de llegar al grupo, así que
 * «todo el chat» es subir aquí el chat exportado (o mandárselo a Mister Luks).
 * Quien administra lo cambia, sube el chat y deshace una importación; el resto
 * lo ve. Si Mister Luks está en el grupo, cuenta allá quién lo decidió.
 */
export function DesdeCuando({ accountId, closed }: { accountId: string; closed: boolean }) {
  const t = useT();
  const [supabase] = useState(() => createClient());
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [deshacer, setDeshacer] = useState<ImportacionChat | null>(null);

  const historia = useQuery({
    queryKey: ['historia', accountId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('account_history', { p_account_id: accountId });
      if (error) throw error;
      return data as HistoriaCuenta;
    },
    // Mientras el worker lee un chat, se revisa seguido
    refetchInterval: (q) => (q.state.data?.imports.some((i) => i.status === 'queued' || i.status === 'processing') ? 4000 : false),
  });
  const refrescar = () => queryClient.invalidateQueries({ queryKey: ['historia', accountId] });

  const h = historia.data;
  if (!h?.groups.length) return null;
  const puede = h.is_admin && !closed;

  const elegir = async (groupId: string, modo: 'desde_ya' | 'todo') => {
    setError(null);
    const { error } = await supabase.rpc('set_group_history', { p_group_id: groupId, p_mode: modo });
    if (error) return setError(humanError(error));
    refrescar();
  };

  const subir = async (groupId: string, e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    setError(null);
    if (archivo.size > MAX_MB * 1024 * 1024) {
      return setError(t('Ese archivo pesa más de {mb} MB. Expórtalo sin archivos (Exportar chat → Sin archivos) y súbelo otra vez.', { mb: MAX_MB }));
    }
    if (!/\.(zip|txt)$/i.test(archivo.name)) {
      return setError(t('Sube el .zip o el .txt que da «Exportar chat» de WhatsApp.'));
    }
    setSubiendo(groupId);
    const path = `${accountId}/${Date.now()}-${nombreSeguro(archivo.name)}`;
    const zip = /\.zip$/i.test(archivo.name);
    const { error: subida } = await supabase.storage
      .from('importaciones')
      .upload(path, archivo, { contentType: zip ? 'application/zip' : 'text/plain', upsert: false });
    if (subida) {
      setSubiendo(null);
      return setError(humanError(subida));
    }
    const { error } = await supabase.rpc('request_chat_import', {
      p_account_id: accountId,
      p_group_id: groupId,
      p_path: path,
      p_file_name: archivo.name.slice(0, 200),
    });
    setSubiendo(null);
    if (error) return setError(humanError(error));
    refrescar();
  };

  const confirmarDeshacer = async () => {
    if (!deshacer) return;
    setError(null);
    const { error } = await supabase.rpc('undo_chat_import', { p_import_id: deshacer.id });
    setDeshacer(null);
    if (error) return setError(humanError(error));
    refrescar();
    // Los gastos de la cuenta cambiaron
    queryClient.invalidateQueries();
  };

  return (
    <section className="wa-card dc" id="desde-cuando" aria-labelledby="dc-t">
      <h2 className="lu-label" id="dc-t" style={{ margin: 0 }}>
        {t('¿Desde cuándo anota Luks?')}
      </h2>
      {h.groups.map((g) => {
        const modo = g.history === 'todo' ? 'todo' : 'desde_ya';
        return (
          <div className="dc-grupo" key={g.group_id}>
            {h.groups.length > 1 && <b className="dc-grupo__nombre">{g.name || t('el grupo')}</b>}
            {puede ? (
              <Segmento
                label={t('Desde cuándo anota Luks en {grupo}', { grupo: g.name || t('el grupo') })}
                value={modo}
                onChange={(v) => elegir(g.group_id, v)}
                opciones={[
                  { value: 'desde_ya', label: t('Desde que se conectó') },
                  { value: 'todo', label: t('Todo el chat') },
                ]}
              />
            ) : (
              <p style={{ margin: 0 }}>{modo === 'todo' ? t('Todo el chat') : t('Desde que se conectó')}</p>
            )}
            <p className="lu-small lu-muted" style={{ margin: 0 }}>
              {g.history === 'pendiente'
                ? t('Nadie ha respondido todavía: Luks anota desde el {dia}.', { dia: dia(g.ingest_from, t) })
                : g.history_by
                  ? t('Lo decidió {quien} el {dia}.', { quien: g.history_by, dia: dia(g.history_at ?? g.ingest_from, t) })
                  : null}{' '}
              {modo === 'todo'
                ? t('Lo de antes del {dia} entra con el chat exportado: Luks no alcanza a ver lo que se escribió antes de llegar.', {
                    dia: dia(g.ingest_from, t),
                  })
                : ''}
            </p>
            {modo === 'todo' && puede && (
              <div className="dc-subir">
                <ol className="dc-pasos lu-small">
                  <li>{t('En el grupo de WhatsApp: Info del grupo → Más → Exportar chat → Incluir archivos.')}</li>
                  <li>{t('Te queda un .zip (o un .txt): súbelo aquí. Hasta {mb} MB.', { mb: MAX_MB })}</li>
                  <li>
                    {g.mister_luks
                      ? t('También se lo pueden mandar a Mister Luks en el grupo o por privado.')
                      : t('Luks lee solo lo que parece gasto, y cada uno queda por revisar.')}
                  </li>
                </ol>
                <label className={`lu-btn lu-btn--primary lu-btn--sm dc-archivo${subiendo ? ' is-busy' : ''}`}>
                  {subiendo === g.group_id ? t('Subiendo…') : t('Subir el chat exportado')}
                  <input type="file" accept=".zip,.txt,application/zip,text/plain" onChange={(e) => subir(g.group_id, e)} disabled={subiendo !== null} />
                </label>
              </div>
            )}
          </div>
        );
      })}

      {h.imports.length > 0 && (
        <div className="dc-imports">
          <span className="lu-label">{t('Chats importados')}</span>
          <ul>
            {h.imports.map((i) => (
              <li key={i.id} className={`dc-import dc-import--${i.status}`}>
                <span className="dc-import__txt">
                  <b>{i.file_name || t('Chat exportado')}</b>
                  <span className="lu-small lu-muted">
                    {i.source === 'whatsapp' ? t('por WhatsApp') : t('desde la app')}
                    {i.requested_name ? ` · ${i.requested_name}` : ''} · {dia(i.created_at, t)}
                  </span>
                  <span className="lu-small">{estadoDe(i, t)}</span>
                </span>
                {h.is_admin && (i.status === 'done' || i.status === 'failed') && i.messages > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setDeshacer(i)}>
                    {t('Deshacer')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className="lu-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}

      <ConfirmDialog
        open={deshacer !== null}
        onOpenChange={(o) => !o && setDeshacer(null)}
        title={t('¿Deshacer esta importación?')}
        confirmLabel={t('Deshacer')}
        onConfirm={confirmarDeshacer}
      >
        {deshacer &&
          t('Se borran {gastos} y {mensajes} que trajo este chat. Lo que llegó en vivo al grupo no se toca.', {
            gastos: plural(deshacer.expenses, t('gasto'), t('gastos')),
            mensajes: plural(deshacer.messages, t('mensaje'), t('mensajes')),
          })}
      </ConfirmDialog>
    </section>
  );
}

function estadoDe(i: ImportacionChat, t: T): string {
  switch (i.status) {
    case 'queued':
      return t('En la cola: Luks lo lee en un momento.');
    case 'processing':
      return t('Luks lo está leyendo…');
    case 'failed':
      return i.error ? t(i.error) : t('No se pudo leer.');
    case 'undone':
      return t('Deshecha.');
    default: {
      const n = i.stats.inserted ?? 0;
      if (!n) return t('No traía gastos de antes del {dia}.', { dia: dia(i.before, t) });
      return t('{mensajes} de antes del {dia} · {gastos} ya en Luks', {
        mensajes: plural(n, t('mensaje con gasto'), t('mensajes con gastos')),
        dia: dia(i.before, t),
        gastos: plural(i.expenses, t('gasto'), t('gastos')),
      });
    }
  }
}
