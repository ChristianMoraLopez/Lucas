import type { T } from '@/lib/i18n';
import type { Recibo } from '@/lib/recibo';

/**
 * Lo que pidió alguien en un gasto dividido por consumo: cada ítem con su
 * parte en plata y, aparte, la propina y lo que no está en los ítems. En el
 * link público y en Liquidar (sin hooks: sirve en el servidor y en el cliente).
 */
export function ItemsDeUno({ recibo, label, fmt, t }: { recibo: Recibo; label: string; fmt: (n: number) => string; t: T }) {
  if (!recibo.items.length) return null;
  return (
    <ul className="sh-items" aria-label={label}>
      {recibo.items.map((i, k) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: dos ítems pueden llamarse igual
        <li key={`${i.name}-${k}`} className="sh-items__li">
          <span>
            {i.name}
            <span className="lu-muted">
              {i.units ? ` · ${t('{n} de {total}', { n: i.units, total: i.de })}` : i.entre > 1 ? ` · ${t('entre {n}', { n: i.entre })}` : ''}
            </span>
          </span>
          <span className="lu-num">{fmt(i.amount)}</span>
        </li>
      ))}
      {Math.abs(recibo.resto) > recibo.items.length && (
        <li className="sh-items__li sh-items__resto">
          <span>{recibo.resto > 0 ? t('Propina, servicio y lo que no está en los ítems') : t('Lo que otro puso de más')}</span>
          <span className="lu-num">{recibo.resto > 0 ? fmt(recibo.resto) : `−${fmt(-recibo.resto)}`}</span>
        </li>
      )}
    </ul>
  );
}
