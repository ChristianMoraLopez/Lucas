import { C, mount, Frames, TABS_EVENTO, PASEO } from './_kit.jsx';
const { AppShell, Amount, BillCard, Avatar, Button, Sticker, CategoryTag, formatCOP, lucas, CATEGORIES } = C;

function Event() {
  const rows = PASEO.people.map(p => ({ ...p, bal: p.paid - PASEO.share })).sort((a, b) => b.bal - a.bal);
  const maxAbs = Math.max(...rows.map(r => Math.abs(r.bal)));
  return (
    <AppShell account="Paseo Santa Marta" accountTone="morado" accountGlyph="P" tabs={TABS_EVENTO(3)} active="resumen">
      <div className="ed">
        <header className="ed-head">
          <span className="lu-label">Evento · {PASEO.dates}</span>
          <h1 className="lu-display-xl">Paseo Santa Marta</h1>
        </header>

        <div className="ed-alert" role="status">
          <Sticker tone="revisar" rotate={-5}>3 por revisar</Sticker>
          <span className="lu-small" style={{ flex: 1, minWidth: 160 }}>El paseo terminó ayer. Revisen lo pendiente y después liquidan.</span>
          <Button size="sm">Revisar</Button>
        </div>

        <div className="ed-top">
          <BillCard label="Total del paseo" amount={PASEO.total} tone="morado" denom="8 PERSONAS">
            <span><b>{formatCOP(PASEO.share)}</b> a cada uno</span>
            <span>41 gastos · partes iguales</span>
          </BillCard>
          <section className="ed-cats" aria-label="Por categoría">
            <h2 className="lu-title" style={{ marginBottom: 12 }}>¿En qué se fue?</h2>
            <div className="ed-stack" aria-hidden="true">{PASEO.cats.map(([c, v]) => <i key={c} style={{ flex: v, background: `var(--tono-${CATEGORIES[c][1]})` }} />)}</div>
            {PASEO.cats.map(([c, v]) => (
              <div className="ed-cat" key={c}><CategoryTag name={c} size="sm" /><Amount value={v} /></div>
            ))}
          </section>
        </div>

        <section className="ed-people" aria-label="Balance por persona">
          <div className="ed-sec">
            <h2 className="lu-title">¿Quién puso más?</h2>
            <span className="ed-legend lu-small"><i className="neg" /> debe <i className="pos" /> le deben</span>
          </div>
          <ul className="ed-list">
            {rows.map(p => (
              <li key={p.name}>
                <span className="ed-who">
                  <Avatar name={p.name} size="sm" registered={p.registered !== false} />
                  <span style={{ display: 'grid', minWidth: 0 }}><b>{p.name}</b><span className="lu-muted" style={{ fontSize: 12 }}>pagó {formatCOP(p.paid)}</span></span>
                </span>
                <span className="ed-track" aria-hidden="true">
                  <i className={p.bal >= 0 ? 'pos' : 'neg'} style={{ width: (Math.abs(p.bal) / maxAbs * 50) + '%' }} />
                </span>
                <span className="ed-bal">
                  <Amount value={p.bal} sign tone={p.bal >= 0 ? 'pos' : 'neg'} />
                  <span className="lu-muted">{lucas(p.bal)}</span>
                </span>
              </li>
            ))}
          </ul>
          <Button className="ed-cta">Ver quién le paga a quién</Button>
        </section>
      </div>
    </AppShell>
  );
}

mount(<Frames path="lucas.co/paseo-santa-marta" render={() => <Event />} desktopH={1220} phoneH={1240} />);
