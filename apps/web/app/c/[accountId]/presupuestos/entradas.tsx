'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/components/idioma';
import { formatDay } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { deCampo, dinero, type Moneda } from '@/lib/moneda';
import { createClient } from '@/utils/supabase/client';

/** Un ingreso del mes (public.incomes, migración 810) */
export interface Entrada {
  id: string;
  amount_cop: number;
  income_date: string;
  description: string | null;
  source: 'web' | 'whatsapp';
  created_by: string | null;
  person: string | null;
}

/**
 * Lo que entró este mes: anotarlo a mano (o por WhatsApp: «hoy entraron 200
 * lucas») y verlo. Lo borra quien lo anotó o quien administra.
 */
export function Entradas({
  accountId,
  today,
  entradas,
  usuario,
  administra,
  moneda,
}: {
  accountId: string;
  today: string;
  entradas: Entrada[];
  usuario: string;
  administra: boolean;
  moneda: Moneda;
}) {
  const t = useT();
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [monto, setMonto] = useState(0);
  const [concepto, setConcepto] = useState('');
  const [fecha, setFecha] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const fmt = (n: number) => dinero(n, moneda, t.idioma);
  const total = entradas.reduce((s, e) => s + Number(e.amount_cop), 0);

  async function anotar() {
    if (monto <= 0) return;
    setOcupado(true);
    setError(null);
    const { error: e } = await createClient()
      .from('incomes')
      .insert({ account_id: accountId, amount_cop: monto, income_date: fecha, description: concepto.trim() || null, created_by: usuario });
    setOcupado(false);
    if (e) return setError(humanError(e, t.idioma));
    setMonto(0);
    setConcepto('');
    setAbierto(false);
    router.refresh();
  }

  async function borrar(id: string) {
    setOcupado(true);
    const { error: e } = await createClient().from('incomes').delete().eq('id', id);
    setOcupado(false);
    if (e) return setError(humanError(e, t.idioma));
    router.refresh();
  }

  return (
    <section className="pr-card" aria-labelledby="pr-entradas">
      <div className="hd-sec">
        <h2 className="lu-title" id="pr-entradas">
          {t('¿Qué entró este mes?')}
        </h2>
        <span className="lu-num pr-entro">{fmt(total)}</span>
      </div>

      {entradas.length === 0 ? (
        <p className="lu-small lu-muted pr-vacio">{t('Anoten aquí el sueldo o lo que les entre, o escríbanlo en el grupo: «hoy entraron 200 lucas».')}</p>
      ) : (
        <ul className="pr-lista">
          {entradas.map((e) => (
            <li key={e.id}>
              <span className="pr-lista__que">
                <b>{e.description || t('Entrada')}</b>
                <span className="lu-small lu-muted">
                  {formatDay(e.income_date, today, t.idioma)}
                  {e.person ? ` · ${e.person}` : ''}
                  {e.source === 'whatsapp' ? ` · ${t('por WhatsApp')}` : ''}
                </span>
              </span>
              <span className="lu-num pr-lista__monto">+{fmt(Number(e.amount_cop))}</span>
              {(administra || e.created_by === usuario) && (
                <button type="button" className="pr-ev__x" aria-label={t('Quitar')} disabled={ocupado} onClick={() => borrar(e.id)}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {abierto ? (
        <div className="pr-edit">
          <div className="pr-grid">
            <div className="lu-field lu-field--num">
              <label className="lu-label" htmlFor="pr-entrada-monto">
                {t('¿Cuánto entró?')}
              </label>
              <input id="pr-entrada-monto" inputMode="numeric" value={dinero(monto, moneda, t.idioma)} onChange={(e) => setMonto(deCampo(e.target.value))} />
            </div>
            <div className="lu-field">
              <label className="lu-label" htmlFor="pr-entrada-fecha">
                {t('Fecha')}
              </label>
              <input id="pr-entrada-fecha" type="date" max={today} value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
          </div>
          <div className="lu-field">
            <label className="lu-label" htmlFor="pr-entrada-que">
              {t('¿Qué fue?')}
            </label>
            <input
              id="pr-entrada-que"
              maxLength={120}
              placeholder={t('Quincena, prima, una venta…')}
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
            />
          </div>
          <div className="pr-edit__acciones">
            <button type="button" className="lu-btn lu-btn--secondary lu-btn--sm" disabled={ocupado || monto <= 0} onClick={anotar}>
              {t('Anotar la entrada')}
            </button>
            <button type="button" className="lu-btn lu-btn--ghost lu-btn--sm" onClick={() => setAbierto(false)}>
              {t('Cancelar')}
            </button>
          </div>
        </div>
      ) : (
        <div className="pr-ev__add">
          <button type="button" className="lu-btn lu-btn--secondary lu-btn--sm" onClick={() => setAbierto(true)}>
            + {t('Anotar una entrada')}
          </button>
        </div>
      )}
      {error && (
        <p className="lu-small pr-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
