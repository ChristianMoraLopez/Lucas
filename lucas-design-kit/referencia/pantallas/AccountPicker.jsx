import { C, mount, Frames, PASEO } from './_kit.jsx';
const { BillCard, Amount, Button, Sticker, Avatar, formatCOP, lucas } = C;

const OTHERS = [
  { name: 'Casa', type: 'Hogar', glyph: 'C', tone: 'verde', period: 'Septiembre', total: 2395200, pend: 1, people: ['Valeria', 'Andrés'], note: '92 % del presupuesto' },
  { name: 'Apto 402 · arriendo', type: 'Hogar', glyph: 'A', tone: 'azul', period: 'Septiembre', total: 1840000, pend: 0, people: ['Valeria', 'Mafe', 'Laura'], note: 'Al día' },
  { name: 'Cumple de Santi', type: 'Evento', glyph: 'S', tone: 'amarillo', period: '9 – 10 ago', total: 1265000, pend: 0, people: ['Santi', 'Valeria', 'Mafe', 'Andrés', 'Laura', 'Juan Camilo'], closed: true },
];

function AccountRow({ a }) {
  return (
    <button className={'ap-row' + (a.closed ? ' is-closed' : '')}>
      <span className="ap-glyph" style={{ background: `var(--tono-${a.tone})` }}>{a.glyph}</span>
      <span className="ap-row__txt">
        <span className="ap-row__n">{a.name}</span>
        <span className="ap-row__s">{a.type} · {a.period} · {a.note || a.people.length + ' personas'}</span>
      </span>
      <span className="ap-row__r">
        <Amount value={a.total} />
        {a.pend ? <span className="ap-pend">{a.pend} por revisar</span> : a.closed ? <Sticker tone="cerrado" size="sm" rotate={-5} /> : <span className="lu-avatars">{a.people.slice(0, 3).map(p => <C.Avatar key={p} name={p} size="xs" />)}</span>}
      </span>
    </button>
  );
}

function Picker() {
  return (
    <div className="lu-app">
      <header className="lu-app__bar"><C.Logo /><span className="ap-me"><Avatar name="Valeria" size="sm" /></span></header>
      <div className="ap">
        <div className="ap-main">
          <div className="ap-intro">
            <h1 className="lu-display">Hola, Valeria</h1>
            <p className="lu-small lu-muted" style={{ margin: 0 }}>Tienes 4 cuentas y 4 gastos esperando revisión.</p>
          </div>
          <button className="ap-lead" aria-label="Abrir Paseo Santa Marta">
            <BillCard label={'Evento · ' + PASEO.dates} amount={PASEO.total} tone="morado"
              aside={<Sticker tone="revisar" rotate={6}>3 por revisar</Sticker>}>
              <span className="ap-lead__n">Paseo Santa Marta</span>
              <span className="lu-avatars">{PASEO.people.map(p => <Avatar key={p.name} name={p.name} size="sm" />)}</span>
              <span>Terminó ayer · falta liquidar · <b>{lucas(PASEO.share)}</b> por cabeza</span>
            </BillCard>
          </button>
          <div className="ap-list">
            <div className="lu-label">Otras cuentas</div>
            {OTHERS.map(a => <AccountRow key={a.name} a={a} />)}
          </div>
        </div>
        <aside className="ap-side">
          <Button>Crear cuenta</Button>
          <Button variant="secondary">Unirme con un código</Button>
          <div className="ap-tip">
            <span className="lu-title">¿Cómo funciona?</span>
            <ol>
              <li>Crea una cuenta de <b>hogar</b> o de <b>evento</b>.</li>
              <li>Agrega el número de Lucas a su grupo de WhatsApp.</li>
              <li>Manden fotos, PDFs o mensajes. Lucas los vuelve gastos.</li>
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}

mount(<Frames path="lucas.co/cuentas" render={() => <Picker />} desktopH={900} phoneH={900} />);
