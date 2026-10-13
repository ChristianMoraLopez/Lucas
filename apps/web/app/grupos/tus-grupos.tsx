'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { FormaMiWhatsapp } from '@/app/c/[accountId]/whatsapp/whatsapp-screen';
import { Cargando } from '@/components/cargando';
import { useT } from '@/components/idioma';
import { type GrupoDetectado, type GrupoMio, type MyWhatsappLink, plural } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';

/** Con muchos grupos, un buscador */
const CON_BUSCADOR = 8;

export function TusGrupos({ detectados }: { detectados: GrupoDetectado[] }) {
  const t = useT();
  const [supabase] = useState(() => createClient());
  const [busca, setBusca] = useState('');

  const link = useQuery({
    queryKey: ['mi-whatsapp'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_whatsapp_link');
      if (error) throw error;
      return (data as MyWhatsappLink | null) ?? null;
    },
  });
  const vinculado = link.data?.status === 'connected';
  const grupos = useQuery({
    queryKey: ['mis-grupos-whatsapp'],
    enabled: vinculado,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_whatsapp_groups');
      if (error) throw error;
      return (data ?? []) as GrupoMio[];
    },
    // Recién vinculado, los grupos llegan en unos segundos
    refetchInterval: (q) => (q.state.data?.length ? false : 4000),
  });

  const q = busca.trim().toLowerCase();
  const visibles = (grupos.data ?? []).filter((g) => !q || (g.name ?? '').toLowerCase().includes(q));

  return (
    <>
      {detectados.length > 0 && (
        <section className="gr-seccion" aria-labelledby="gr-ml">
          <h2 className="lu-label" id="gr-ml">
            {t('Con Mister Luks')}
          </h2>
          <ul className="gr-filas">
            {detectados.map((g) => (
              <li key={g.group_id}>
                <Link href={`/grupos/${g.group_id}`} className="gr-fila">
                  <span className="gr-fila__txt">
                    <b>{g.name || t('Grupo sin nombre')}</b>
                    <span className="lu-small lu-muted">
                      {plural(g.member_count, t('persona'), t('personas'))}
                      {g.names.length ? ` · ${g.names.join(', ')}` : ''}
                    </span>
                  </span>
                  <span className="lu-small gr-fila__accion">{t('Crear la cuenta')} ›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="gr-seccion" aria-labelledby="gr-mio">
        <h2 className="lu-label" id="gr-mio">
          {t('Desde tu WhatsApp')}
        </h2>
        {link.isPending ? (
          <Cargando />
        ) : !vinculado ? (
          <FormaMiWhatsapp otrosLectores={[]} />
        ) : grupos.isPending || !grupos.data?.length ? (
          <p className="lu-small lu-muted" style={{ margin: 0 }} aria-live="polite">
            {grupos.isPending ? t('Trayendo tus grupos…') : t('Todavía no vemos grupos en tu WhatsApp. Si acabas de vincularlo, llegan en unos segundos.')}
          </p>
        ) : (
          <>
            {grupos.data.length > CON_BUSCADOR && (
              <input
                className="gr-buscar"
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder={t('Buscar un grupo')}
                aria-label={t('Buscar un grupo')}
              />
            )}
            <ul className="gr-filas">
              {visibles.map((g) => (
                <li key={g.group_id}>
                  {g.account_id ? (
                    <Link href={`/c/${g.account_id}/resumen`} className="gr-fila">
                      <span className="gr-fila__txt">
                        <b>{g.name || t('Grupo sin nombre')}</b>
                        <span className="lu-small lu-muted">{t('Conectado a «{cuenta}»', { cuenta: g.account_name ?? '' })}</span>
                      </span>
                      <span className="lu-small gr-fila__accion">{t('Ver')} ›</span>
                    </Link>
                  ) : g.linked_elsewhere ? (
                    <div className="gr-fila gr-fila--quieta">
                      <span className="gr-fila__txt">
                        <b>{g.name || t('Grupo sin nombre')}</b>
                        <span className="lu-small lu-muted">{t('Ya es de una cuenta en la que no estás')}</span>
                      </span>
                    </div>
                  ) : (
                    <Link href={`/grupos/${g.group_id}`} className="gr-fila">
                      <span className="gr-fila__txt">
                        <b>{g.name || t('Grupo sin nombre')}</b>
                        <span className="lu-small lu-muted">{g.mister_luks ? t('Sin cuenta · Mister Luks está ahí') : t('Sin cuenta')}</span>
                      </span>
                      <span className="lu-small gr-fila__accion">{t('Conectar')} ›</span>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            {q && !visibles.length && (
              <p className="lu-small lu-muted" style={{ margin: 0 }}>
                {t('Ningún grupo se llama así.')}
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}
