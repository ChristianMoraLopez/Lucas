import { C, useState, mount, Frames, TABS_HOGAR, CASA } from './_kit.jsx';
const { AppShell, Amount, BillCard, BudgetBar, CategoryTag, Avatar, Sticker, formatCOP, CATEGORIES } = C;
const MONTHS = { abr: 'Abril', may: 'Mayo', jun: 'Junio', jul: 'Julio', ago: 'Agosto', sep: 'Septiembre' };

function Home() {
  const [m, setM] = useState(5);
  const [key, val] = CASA.trend[m];
  const prev = m > 0 ? CASA.trend[m - 1][1] : null;
  const max = 2800000;
  const over = CASA.cats.filter(c => c[1] > c[2]).length;
  return (
    <AppShell account="Casa" accountTone="verde" accountGlyph="C" tabs={TABS_HOGAR(1)} active="resumen">
      <div className="hd">
        <div className="hd-main">
          <header className="hd-head">
            <div>
              <h1 className="lu-display-xl">Casa</h1>
              <span className="lu-small lu-muted">Hogar de Valeria y Andrés</span>
            </div>
            <span className="lu-avatars"><Avatar name="Valeria" /><Avatar name="Andrés" /></span>
          </header>

          <BillCard label={MONTHS[key] + ' 2026' + (m === 5 ? ' · va el día 29' : '')} amount={val} roll highlight={m === 5}
            aside={<span className="hd-nav">
              <button aria-label="Mes anterior" disabled={m === 0} onClick={() => setM(m - 1)}>‹</button>
              <button aria-label="Mes siguiente" disabled={m === 5} onClick={() => setM(m + 1)}>›</button>
            </span>}>
            <span>de <b>{formatCOP(CASA.budget)}</b> · {Math.round(val / CASA.budget * 100)} %</span>
            {prev != null && <span>{val > prev ? '▲' : '▼'} <b>{formatCOP(Math.abs(val - prev))}</b> vs. {CASA.trend[m - 1][0]}</span>}
          </BillCard>

          <section aria-label="Gasto por categoría">
            <div className="hd-sec"><h2 className="lu-title">¿En qué se fue?</h2><span className="lu-label">Septiembre</span></div>
            <div className="hd-stack" role="img" aria-label="Reparto del gasto de septiembre por categoría">
              {CASA.cats.map(([c, v]) => <i key={c} style={{ flex: v, background: `var(--tono-${CATEGORIES[c][1]})` }} />)}
            </div>
            <ul className="hd-catlist">
              {CASA.cats.map(([c, v]) => (
                <li key={c}><CategoryTag name={c} /><Amount value={v} size="md" /><span className="hd-pct lu-num">{Math.round(v / CASA.total * 100)} %</span></li>
              ))}
            </ul>
          </section>

          <section aria-label="Tendencia de 6 meses">
            <div className="hd-sec"><h2 className="lu-title">Últimos seis meses</h2><span className="hd-legend lu-small"><i /> tope {formatCOP(CASA.budget)}</span></div>
            <div className="hd-bars" role="img" aria-label="Gasto mensual de abril a septiembre">
              <div className="hd-budgetline" style={{ bottom: (CASA.budget / max * 100) + '%' }} />
              {CASA.trend.map(([k, v], i) => (
                <button key={k} className={'hd-bar' + (i === m ? ' is-on' : '')} onClick={() => setM(i)} aria-label={MONTHS[k] + ' ' + formatCOP(v)}>
                  <span className="hd-bar__v lu-num">{(v / 1e6).toFixed(2).replace('.', ',')}M</span>
                  <span className="hd-bar__col" style={{ height: (v / max * 100) + '%' }} />
                  <span className="hd-bar__k">{k}</span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="hd-aside">
          <section className="hd-budgets" aria-label="Presupuestos">
            <div className="hd-sec"><h2 className="lu-title">Presupuestos</h2>{over ? <Sticker tone="alerta" size="sm" rotate={4}>{over} pasados</Sticker> : null}</div>
            <div className="hd-blist">
              {[...CASA.cats].sort((a, b) => (b[1] / b[2]) - (a[1] / a[2])).map(([c, v, b]) => <BudgetBar key={c} name={c} spent={v} budget={b} />)}
            </div>
          </section>
          <section aria-label="Últimos gastos">
            <div className="hd-sec"><h2 className="lu-title">Últimos gastos</h2><a className="hd-all lu-small" href="#">Ver todos</a></div>
            <ul className="hd-recent">
              {CASA.recent.map(r => (
                <li key={r.m + r.when}>
                  <CategoryTag name={r.c} showName={false} size="lg" />
                  <span className="hd-r__t"><span className="hd-r__m">{r.m}</span><span className="hd-r__s">{r.when} · <Avatar name={r.who} size="xs" /> {r.who}{r.pdf ? ' · PDF' : ''}</span></span>
                  <Amount value={r.v} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

mount(<Frames path="lucas.co/casa" render={() => <Home />} desktopH={1180} phoneH={1180} />);
