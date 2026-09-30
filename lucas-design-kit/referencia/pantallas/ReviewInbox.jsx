import { C, useState, mount, Frames, TABS_EVENTO, PASEO } from './_kit.jsx';
const { AppShell, Evidence, Field, Chip, Button, ExpenseCard, Sticker, Amount, LottieSlot, CategoryTag, formatCOP, Avatar } = C;

const ALL = PASEO.people.map(p => p.name);
const ITEMS = [
  {
    id: 1, kind: 'foto', sender: 'Andrés', time: '26 sep · 11:52 p. m.',
    receipt: { title: 'ESTANCO EL PAISA', sub: 'NIT 901.284.117-3 · Cra 2 #11-40', lines: [['AGUARDIENTE 750 x2', '98.000'], ['CERVEZA LATA x24', '72.000'], ['HIELO BOLSA x2', '8.000'], ['LIMÓN x10', '8.000']], total: '186.000', foot: 'GRACIAS POR SU COMPRA' },
    box: 'total leído',
    f: { comercio: ['Estanco El Paisa', .97], fecha: ['26/09/2026 23:14', .91], total: ['186000', .71, '168000', 'Mafe'], categoria: ['Licor', .95], pago: ['Andrés', .99] },
    split: ALL.filter(n => n !== 'Santi'), splitNote: 'Santi no toma',
  },
  {
    id: 2, kind: 'pdf', sender: 'Laura', time: '27 sep · 8:05 a. m.', file: 'reserva-lancha-playa-cristal.pdf', pages: 2,
    receipt: { title: 'Lanchas Taganga Azul', sub: 'Comprobante de reserva #4471', lines: [['Trayecto ida y vuelta', '8 pax'], ['Valor por persona', '52.500']], total: '$420.000' },
    box: 'total',
    f: { comercio: ['Lanchas Taganga Azul', .96], fecha: ['27/09/2026', .98], total: ['420000', .96], categoria: ['Transporte', .93], pago: ['Laura', .99] },
    split: ALL,
  },
  {
    id: 3, kind: 'mensaje', sender: 'Juan Camilo', time: '24 sep · 3:31 p. m.',
    messages: [
      { who: 'Mafe', whoColor: 'azul', text: 'ya estamos en el apto', time: '3:12 p. m.', dim: true },
      { who: 'Juan Camilo', whoColor: 'naranja-texto', text: 'pagué el taxi del aeropuerto, 38 lucas, entre los 4 que llegamos juntos', time: '3:31 p. m.', target: true },
      { who: 'Valeria', whoColor: 'morado', text: 'listo, gracias', time: '3:33 p. m.', dim: true },
    ],
    f: { comercio: ['Taxi aeropuerto', .62], fecha: ['24/09/2026 15:31', .88], total: ['38000', .8], categoria: ['Transporte', .9], pago: ['Juan Camilo', .97] },
    split: ['Juan Camilo', 'Valeria', 'Mafe', 'Santi'], splitNote: 'leído del mensaje: "entre los 4"',
  },
];

function Review({ mode }) {
  const [i, setI] = useState(0);
  const [done, setDone] = useState({});
  const [split, setSplit] = useState(() => ITEMS.map(it => it.split));
  const [confirming, setConfirming] = useState(false);
  const it = ITEMS[i];
  const sp = split[i];
  const total = Number(it.f.total[0]);
  const isDone = done[it.id];

  const toggle = n => setSplit(s => s.map((arr, k) => k !== i ? arr : arr.includes(n) ? arr.filter(x => x !== n) : ALL.filter(x => arr.includes(x) || x === n)));
  const confirm = () => { setDone(d => ({ ...d, [it.id]: true })); };
  const pending = ITEMS.length - Object.keys(done).length;

  return (
    <AppShell account="Paseo Santa Marta" accountTone="morado" accountGlyph="P" tabs={TABS_EVENTO(pending)} active="revisar">
      <div className="rv">
        <div className="rv-head">
          <h1 className="lu-display">Por revisar</h1>
          <span className="rv-count lu-num">{pending}</span>
        </div>
        <p className="lu-small lu-muted" style={{ margin: '-8px 0 0' }}>Lo que llegó al grupo y todavía no es gasto.</p>

        <ol className="rv-queue" aria-label="Cola de revisión">
          {ITEMS.map((q, k) => (
            <li key={q.id}>
              <button className={'rv-q' + (k === i ? ' is-on' : '') + (done[q.id] ? ' is-done' : '')} onClick={() => setI(k)} aria-current={k === i}>
                <Avatar name={q.sender} size="sm" />
                <span className="rv-q__txt">
                  <span className="rv-q__m">{q.f.comercio[0]}</span>
                  <span className="rv-q__s">{q.kind === 'foto' ? 'Foto' : q.kind === 'pdf' ? 'PDF' : 'Mensaje'} · <span className="lu-num">{formatCOP(q.f.total[0])}</span></span>
                </span>
                {done[q.id] ? <Sticker tone="confirmado" size="sm" rotate={-8} className="rv-q__st" />
                  : Math.min(...Object.values(q.f).map(v => v[1])) < .75 ? <span className="rv-q__dot" title="Tiene datos por revisar" /> : null}
              </button>
            </li>
          ))}
          <li>
            <div className="rv-q rv-q--proc" aria-live="polite">
              <LottieSlot name="escaneo" width={32} height={32} label="Procesando recibo" />
              <span className="rv-q__txt"><span className="rv-q__m">Leyendo foto…</span><span className="rv-q__s">de Laura</span></span>
            </div>
          </li>
        </ol>

        <div className="rv-split">
          <section className="rv-evi" aria-label="Evidencia">
            <Evidence kind={it.kind} sender={it.sender} time={it.time} group="Paseo Santa Marta" receipt={it.receipt} box={it.box} file={it.file} pages={it.pages} messages={it.messages} />
          </section>

          <section className="rv-data" aria-label="Datos extraídos">
            {isDone ? (
              <div className="rv-done">
                <ExpenseCard appear merchant={it.f.comercio[0]} category={it.f.categoria[0]} meta={it.f.fecha[0].split(' ')[0] + ' · pagó ' + it.f.pago[0]} total={total}
                  each={'÷ ' + sp.length + ' · ' + formatCOP(total / sp.length)} sticker={<Sticker tone="confirmado" animate rotate={-6} />} />
                <div className="rv-done__row">
                  <LottieSlot name="gasto-registrado" width={64} height={64} />
                  <div>
                    <p className="lu-title" style={{ margin: 0 }}>Quedó registrado</p>
                    <p className="lu-small lu-muted" style={{ margin: 0 }}>Ya cuenta en el resumen y en la liquidación.</p>
                  </div>
                </div>
                {i < ITEMS.length - 1 && <Button onClick={() => setI(i + 1)}>Siguiente · {i + 2} de {ITEMS.length}</Button>}
              </div>
            ) : (
              <div className="rv-sheet">
                <div className="rv-data__top">
                  <span className="lu-title">Lo que leímos</span>
                  <span className="lu-small lu-muted">{i + 1} de {ITEMS.length}</span>
                </div>
                <div className="rv-fields" key={it.id}>
                  <Field label="Comercio" value={it.f.comercio[0]} confidence={it.f.comercio[1]} original={it.f.comercio[0]} />
                  <div className="rv-2">
                    <Field label="Fecha" num value={it.f.fecha[0]} confidence={it.f.fecha[1]} original={it.f.fecha[0]} />
                    <Field label="Total" num value={formatCOP(it.f.total[0])} confidence={it.f.total[1]}
                      original={it.f.total[2] ? formatCOP(it.f.total[2]) : formatCOP(it.f.total[0])} correctedBy={it.f.total[3]} inputMode="numeric" />
                  </div>
                  <div className="rv-2">
                    <Field label="Categoría" confidence={it.f.categoria[1]}>
                      <select defaultValue={it.f.categoria[0]} aria-label="Categoría">
                        {['Café', 'Licor', 'Mercado', 'Transporte', 'Hospedaje', 'Restaurante', 'Servicios'].map(c => <option key={c}>{c}</option>)}
                      </select>
                    </Field>
                    <Field label="Quién pagó" confidence={it.f.pago[1]}>
                      <select defaultValue={it.f.pago[0]} aria-label="Quién pagó">{ALL.map(n => <option key={n}>{n}</option>)}</select>
                    </Field>
                  </div>
                  <div className="lu-field">
                    <div className="lu-field__top">
                      <span className="lu-label">Entre quiénes · {sp.length} de {ALL.length}</span>
                      <span className="lu-amount lu-amount--sm">{formatCOP(total / sp.length)} c/u</span>
                    </div>
                    <div className="lu-chips">
                      {ALL.map(n => <Chip key={n} name={n} pressed={sp.includes(n)} onToggle={() => toggle(n)} />)}
                    </div>
                    {it.splitNote && <span className="rv-note">{it.splitNote}</span>}
                  </div>
                </div>
                <div className="rv-actions">
                  <Button onClick={confirm} kbd={mode === 'd' ? 'Enter' : null}>Confirmar gasto</Button>
                  <Button variant="ghost">No es un gasto</Button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}

mount(<Frames path="lucas.co/paseo-santa-marta/revisar" render={m => <Review mode={m} />} desktopH={940} phoneH={1340} />);
