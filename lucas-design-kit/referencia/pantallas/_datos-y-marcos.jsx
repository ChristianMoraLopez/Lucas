export const C = window.Lucas;
C.setTones({ Valeria: 'morado', 'Juan Camilo': 'naranja', Mafe: 'azul', 'Andrés': 'coral', Laura: 'verde', Santi: 'amarillo', Caro: 'turquesa', Felipe: 'rosa', 'Pipe Ramírez': 'rosa' });
export const { useState, useEffect, useRef } = React;

export function mount(node) {
  ReactDOM.createRoot(document.getElementById('root')).render(node);
}

/* Dos marcos: móvil (390) y escritorio (1000). El mismo componente, estado independiente. */
export function Frames({ render, path = 'lucas.co', mobileOnly = false, desktopH = 760, phoneH = 844 }) {
  return (
    <div className="pv-wrap">
      <div className="pv-col">
        <div className="pv-cap">MÓVIL · 390</div>
        <div className="pv-phone" style={{ height: phoneH }}><div className="pv-scroll">{render('m')}</div></div>
      </div>
      {!mobileOnly && (
        <div className="pv-col">
          <div className="pv-cap">ESCRITORIO · 1000</div>
          <div className="pv-desk" style={{ height: desktopH }}>
            <div className="pv-url">{path}</div>
            <div className="pv-scroll">{render('d')}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export const TABS_EVENTO = (count = 3) => [
  { id: 'resumen', label: 'Resumen' },
  { id: 'revisar', label: 'Revisar', count },
  { id: 'gastos', label: 'Gastos' },
  { id: 'liquidar', label: 'Liquidar' },
  { id: 'personas', label: 'Personas' },
];
export const TABS_HOGAR = (count = 1) => [
  { id: 'resumen', label: 'Resumen' },
  { id: 'revisar', label: 'Revisar', count },
  { id: 'gastos', label: 'Gastos' },
  { id: 'presupuestos', label: 'Presupuestos' },
  { id: 'personas', label: 'Personas' },
];

/* Datos de ejemplo — Paseo Santa Marta, 8 personas, total $4.816.000, $602.000 c/u */
export const PASEO = {
  name: 'Paseo Santa Marta', code: 'PASEO-7K2Q', dates: '24 – 28 sep 2026', total: 4816000, share: 602000,
  people: [
    { name: 'Valeria', paid: 1014500 },
    { name: 'Laura', paid: 870000 },
    { name: 'Mafe', paid: 753500 },
    { name: 'Caro', paid: 502000, registered: false },
    { name: 'Juan Camilo', paid: 469500 },
    { name: 'Felipe', paid: 450500, registered: false },
    { name: 'Andrés', paid: 434000 },
    { name: 'Santi', paid: 322000 },
  ],
  cats: [['Hospedaje', 1920000], ['Restaurante', 1084000], ['Transporte', 780000], ['Licor', 612000], ['Mercado', 420000]],
  transfers: [
    { from: 'Santi', to: 'Valeria', amount: 280000 },
    { from: 'Andrés', to: 'Laura', amount: 168000 },
    { from: 'Felipe', to: 'Mafe', amount: 151500 },
    { from: 'Juan Camilo', to: 'Valeria', amount: 132500 },
    { from: 'Caro', to: 'Laura', amount: 100000 },
  ],
};

export const CASA = {
  name: 'Casa', month: 'Septiembre 2026', total: 2395200, budget: 2600000,
  cats: [
    ['Mercado', 1184300, 1300000], ['Servicios', 486900, 450000], ['Restaurante', 312000, 350000],
    ['Transporte', 231700, 300000], ['Licor', 96000, 120000], ['Café', 84300, 80000],
  ],
  trend: [['abr', 2180400], ['may', 2412900], ['jun', 2265000], ['jul', 2598300], ['ago', 2341700], ['sep', 2395200]],
  recent: [
    { m: 'Panadería La Espiga', c: 'Café', who: 'Andrés', when: 'Hoy 7:42', v: 18400 },
    { m: 'Tienda Don Beto', c: 'Mercado', who: 'Valeria', when: 'Ayer 19:10', v: 46900 },
    { m: 'Factura acueducto', c: 'Servicios', who: 'Andrés', when: '27 sep', v: 96300, pdf: true },
    { m: 'Asadero Los Cerros', c: 'Restaurante', who: 'Valeria', when: '26 sep', v: 84300 },
    { m: 'Parqueadero Calle 85', c: 'Transporte', who: 'Andrés', when: '26 sep', v: 12000 },
    { m: 'Estanco El Paisa', c: 'Licor', who: 'Valeria', when: '25 sep', v: 58000 },
  ],
};
