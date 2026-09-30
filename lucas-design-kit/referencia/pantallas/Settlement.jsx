import { C, useState, mount, Frames, TABS_EVENTO, PASEO } from './_kit.jsx';
const { AppShell, Amount, Button, Sticker, BillCard, Avatar, LottieSlot, formatCOP, lucas } = C;

function Settle() {
  const [paid, setPaid] = useState({ 1: 'pre', 3: 'pre' });
  const [closed, setClosed] = useState(false);
  const list = PASEO.transfers;
  const n = Object.keys(paid).length;
  const pending = list.reduce((s, t, i) => s + (paid[i] ? 0 : t.amount), 0);
  const all = n === list.length;

  return (
    <AppShell account="Paseo Santa Marta" accountTone="morado" accountGlyph="P" tabs={TABS_EVENTO(0)} active="liquidar">
      <div className="st">
        <header className="st-head">
          <h1 className="lu-display">¿Quién le paga <span className="lu-mark">a quién?</span></h1>
          <p className="lu-small lu-muted" style={{ margin: 0 }}>Con 5 transferencias quedan todos a paz y salvo. Márquenlas cuando se hagan.</p>
        </header>

        <div className="st-main">
          <BillCard label={all ? 'Todo pagado' : 'Falta por pagar'} amount={pending} roll highlight={false}
            aside={<span className="lu-bill__denom">{n} DE {list.length}</span>}>
            <div className="st-prog" aria-hidden="true">{list.map((_, i) => <i key={i} className={paid[i] ? 'on' : ''} />)}</div>
          </BillCard>

          <ol className="st-list">
            {list.map((t, i) => (
              <li key={i} className={'st-t' + (paid[i] ? ' is-paid' : '')}>
                <div className="st-pair" aria-hidden="true">
                  <Avatar name={t.from} registered={!['Caro', 'Felipe'].includes(t.from)} />
                  <svg className="st-arrow" viewBox="0 0 40 16"><path d="M2 8h32M28 3l6 5-6 5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <Avatar name={t.to} />
                </div>
                <div className="st-txt">
                  <span className="st-sent"><b>{t.from}</b> le paga a <b>{t.to}</b></span>
                  <span className="st-lucas">{lucas(t.amount)}</span>
                </div>
                <Amount value={t.amount} size="lg" className="st-amt" />
                <div className="st-act">
                  {paid[i]
                    ? <><Sticker tone="pagado" animate={paid[i] !== 'pre'} rotate={i % 2 ? 5 : -5} sub={paid[i] === 'pre' ? '28 sep' : 'hoy'} />
                        {!closed && <button className="st-undo" onClick={() => setPaid(p => { const q = { ...p }; delete q[i]; return q; })}>deshacer</button>}</>
                    : <Button size="sm" onClick={() => setPaid(p => ({ ...p, [i]: 'now' }))}>Marcar pagada</Button>}
                </div>
              </li>
            ))}
          </ol>
        </div>

        <aside className="st-side">
          <section className={'st-close' + (all ? ' is-ready' : '')}>
            {all ? (
              <div className="st-close__row">
                <LottieSlot name="cierre-evento" width={88} height={88} />
                <div>
                  <h2 className="lu-title" style={{ margin: 0 }}>{closed ? 'Paseo cerrado' : '¡Todo pagado!'}</h2>
                  <p className="lu-small" style={{ margin: '4px 0 0' }}>{closed ? 'Queda archivado con su liquidación.' : 'Ya pueden cerrar el paseo. Después no entran más gastos.'}</p>
                </div>
              </div>
            ) : (
              <p className="lu-small" style={{ margin: 0 }}><b>Faltan {list.length - n} transferencias.</b> El paseo se cierra cuando todas estén pagadas.</p>
            )}
            {closed ? <Sticker tone="cerrado" size="lg" animate rotate={-5} sub="29 sep">Saldado</Sticker>
              : <Button disabled={!all} onClick={() => setClosed(true)}>Cerrar paseo</Button>}
          </section>

          <section>
            <h2 className="lu-title" style={{ marginBottom: 12 }}>Descargar</h2>
            <div className="st-exp">
              <button className="st-file"><span className="st-file__ext" style={{ background: 'var(--tono-verde)' }}>XLS</span>Excel</button>
              <button className="st-file"><span className="st-file__ext" style={{ background: 'var(--tono-azul)' }}>CSV</span>CSV</button>
              <button className="st-file"><span className="st-file__ext" style={{ background: 'var(--tono-coral)' }}>PDF</span>PDF</button>
            </div>
            <p className="lu-small lu-muted" style={{ margin: '10px 0 0' }}>Con los 41 gastos, su evidencia y quién corrigió qué.</p>
          </section>

          <section className="st-why">
            <h2 className="lu-label" style={{ margin: '0 0 6px' }}>¿Cómo se calculó?</h2>
            <p className="lu-small" style={{ margin: 0 }}>A cada quien le tocaba <b className="lu-num">{formatCOP(PASEO.share)}</b>. Al que puso de más le devuelven, el que puso de menos completa, y se cruzan las deudas para hacer el menor número de transferencias.</p>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}

mount(<Frames path="lucas.co/paseo-santa-marta/liquidar" render={() => <Settle />} desktopH={1180} phoneH={1240} />);
