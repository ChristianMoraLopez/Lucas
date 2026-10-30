/**
 * El bombín de Chepito, animado: se ladea y se levanta un poquito, como
 * saludando. Va donde las cuentas ponen su inicial (Chepito no es una cuenta).
 * Los colores son los de su frac (scripts/lottie-chepito.py).
 */
export function Sombrerito({ size = 24 }: { size?: number }) {
  return (
    <svg className="sombrerito" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <g className="sombrerito__hat">
        {/* La copa redonda */}
        <path d="M8 21 C8 10 11 6 16 6 C21 6 24 10 24 21 Z" fill="#352B5C" />
        {/* El brillo */}
        <path d="M12 11 C12.6 9 13.8 8 15 7.8" stroke="#4B4074" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        {/* La cinta dorada */}
        <rect x="8.2" y="17" width="15.6" height="3.4" fill="#F0B429" />
        {/* El ala */}
        <ellipse cx="16" cy="22" rx="13" ry="3.2" fill="#2A2142" />
      </g>
    </svg>
  );
}
