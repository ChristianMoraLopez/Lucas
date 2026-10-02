'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { formatCOP } from '@/components/lucas-core';
import { Segmento } from '@/components/segmento';
import { monthName } from '@/lib/dates';
import { plural } from '@/lib/types';

export interface Filtros {
  q: string;
  cat: string;
  quien: string;
  mes: string;
  ver: string;
}

/**
 * Buscar y filtrar los gastos: por comercio (sin importar tildes), categoría,
 * quién pagó, mes y «por revisar». Todo queda en la URL (?q=&cat=&quien=&mes=)
 * para volver atrás o compartir la búsqueda; la página filtra en el servidor.
 */
export function GastosFiltros({
  filtros,
  categorias,
  personas,
  meses,
  total,
  suma,
  tope,
}: {
  filtros: Filtros;
  categorias: { id: string; name: string }[];
  personas: { id: string; name: string }[];
  /** «2026-09», del más reciente al más viejo */
  meses: string[];
  total: number;
  suma: number;
  /** Se llegó al máximo de gastos que muestra la lista */
  tope: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [buscando, startTransition] = useTransition();
  const [q, setQ] = useState(filtros.q);
  const saltar = useRef(true);

  const ir = (cambios: Partial<Filtros>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filtros, ...cambios })) if (v) p.set(k, v);
    const qs = p.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  const irRef = useRef(ir);
  irRef.current = ir;

  // Escribir busca solo, 300 ms después de la última tecla
  useEffect(() => {
    if (saltar.current) {
      saltar.current = false;
      return;
    }
    const t = setTimeout(() => {
      if (q.trim() !== filtros.q) irRef.current({ q: q.trim() });
    }, 300);
    return () => clearTimeout(t);
  }, [q, filtros.q]);

  const hay = Boolean(filtros.q || filtros.cat || filtros.quien || filtros.mes || filtros.ver);
  const quitar = () => {
    saltar.current = true;
    setQ('');
    startTransition(() => router.replace(pathname, { scroll: false }));
  };

  return (
    <search className="gf" aria-label="Buscar gastos">
      <label className="gf-q">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar comercio: panadería, Uber, Éxito…"
          aria-label="Buscar por comercio"
          enterKeyHint="search"
          maxLength={60}
        />
        {q && (
          <button type="button" className="gf-x" onClick={() => setQ('')} aria-label="Borrar la búsqueda">
            ×
          </button>
        )}
      </label>

      <div className="gf-sel">
        <select aria-label="Categoría" value={filtros.cat} onChange={(e) => ir({ cat: e.target.value })} className={filtros.cat ? 'is-on' : ''}>
          <option value="">Categoría</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select aria-label="Quién pagó" value={filtros.quien} onChange={(e) => ir({ quien: e.target.value })} className={filtros.quien ? 'is-on' : ''}>
          <option value="">Quién pagó</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              Pagó {p.name}
            </option>
          ))}
        </select>
        <select aria-label="Mes" value={filtros.mes} onChange={(e) => ir({ mes: e.target.value })} className={filtros.mes ? 'is-on' : ''}>
          <option value="">Mes</option>
          {meses.map((m) => (
            <option key={m} value={m}>
              {monthName(`${m}-01`)} {m.slice(0, 4)}
            </option>
          ))}
        </select>
      </div>

      <div className="gf-foot">
        <Segmento
          label="Qué gastos ver"
          value={filtros.ver === 'pendientes' ? 'pendientes' : 'todos'}
          onChange={(v) => ir({ ver: v === 'pendientes' ? 'pendientes' : '' })}
          opciones={[
            { value: 'todos', label: 'Todos' },
            { value: 'pendientes', label: 'Por revisar' },
          ]}
        />
        <span className="lu-small lu-muted gf-n" aria-live="polite">
          {buscando ? 'Buscando…' : `${plural(total, 'gasto', 'gastos')} · ${formatCOP(suma)}${tope ? ' (los más recientes)' : ''}`}
        </span>
        {hay && (
          <button type="button" className="gf-clear" onClick={quitar}>
            Quitar filtros
          </button>
        )}
      </div>
    </search>
  );
}
