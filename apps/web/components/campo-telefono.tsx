'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/components/idioma';
import { useRegion } from '@/components/region';
import { normalizar, PAISES, pais, paisDe, paisDeRegion } from '@/lib/telefono';

/**
 * Un número de WhatsApp: el país (por defecto, el de la región; Colombia si
 * no) y el número como lo escribe la gente. Avisa el número completo, ya
 * normalizado («573001234567»), o null si todavía no se entiende.
 */
export function CampoTelefono({
  id,
  onNumero,
  describedBy,
  autoFocus = false,
}: {
  id: string;
  onNumero: (numero: string | null, escribio: boolean) => void;
  describedBy?: string;
  autoFocus?: boolean;
}) {
  const t = useT();
  const region = useRegion();
  const [paisId, setPaisId] = useState(() => paisDeRegion(region));
  const [texto, setTexto] = useState('');
  const avisar = useRef(onNumero);
  avisar.current = onNumero;

  useEffect(() => {
    avisar.current(normalizar(texto, paisId), texto.trim() !== '');
  }, [texto, paisId]);

  const escribir = (v: string) => {
    setTexto(v);
    // Si pegan el número con «+», el país se pone solo
    if (v.trim().startsWith('+')) {
      const p = paisDe(v.replace(/\D/g, ''));
      if (p) setPaisId(p.id);
    }
  };

  return (
    <div className="tel">
      <select className="wa-input tel-pais" aria-label={t('País del número')} value={paisId} onChange={(e) => setPaisId(e.target.value)}>
        {PAISES.map((p) => (
          <option key={p.id} value={p.id}>
            {p.bandera} +{p.indicativo} · {t(p.nombre)}
          </option>
        ))}
      </select>
      <input
        id={id}
        className="wa-input lu-num tel-num"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder={pais(paisId).ejemplo}
        value={texto}
        onChange={(e) => escribir(e.target.value)}
        aria-describedby={describedBy}
        // biome-ignore lint/a11y/noAutofocus: aparece porque la persona la acaba de pedir
        autoFocus={autoFocus}
      />
    </div>
  );
}
