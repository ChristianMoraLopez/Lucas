import { C, useState, mount, Frames, PASEO } from './_kit.jsx';
const { CodeInput, Person, Button, Avatar, CODE_RE, LottieSlot, Logo } = C;

const CLAIMABLE = [
  { name: 'Felipe', sub: 'WhatsApp +57 ••• 0918 · mandó 5 gastos' },
  { name: 'Caro', sub: 'WhatsApp +57 ••• 4471 · mandó 3 gastos' },
  { name: 'Pipe Ramírez', sub: 'Lo nombraron en 2 mensajes · sin número' },
];

function Join({ start }) {
  const [code, setCode] = useState(start);
  const [who, setWho] = useState('Felipe');
  const found = code === 'PASEO-7K2Q';
  const bad = CODE_RE.test(code) && !found;
  return (
    <div className="lu-app">
      <header className="lu-app__bar"><Logo /></header>
      <div className="jn">
        <section className="jn-code">
          <h1 className="lu-display">Entra a una cuenta</h1>
          <p className="lu-small lu-muted" style={{ margin: '6px 0 var(--space-6)' }}>Pídele el código a quien creó la cuenta, o cópialo del grupo.</p>
          <CodeInput value={code} onChange={setCode} error={bad ? 'Ese código no existe o ya venció' : null} hint="¡La encontramos!" />
          {!found && !bad && (
            <div className="jn-wait">
              <LottieSlot name="vacio-codigo" width={72} height={72} />
              <span className="lu-small lu-muted">Cuando el código esté completo te mostramos la cuenta.</span>
            </div>
          )}
          {found && (
            <div className="jn-acct">
              <span className="jn-glyph">P</span>
              <span style={{ display: 'grid' }}><b>Paseo Santa Marta</b><span className="lu-small lu-muted">Evento · {PASEO.dates} · la creó Valeria</span></span>
              <span className="lu-avatars" style={{ marginLeft: 'auto' }}>{PASEO.people.slice(0, 4).map(p => <Avatar key={p.name} name={p.name} size="xs" />)}</span>
            </div>
          )}
        </section>

        {found && (
          <section className="jn-claim" aria-labelledby={'jn-q-' + start}>
            <h2 id={'jn-q-' + start} className="lu-title">¿Eres alguno de ellos?</h2>
            <p className="lu-small lu-muted" style={{ margin: '4px 0 var(--space-4)' }}>Ya aparecen en los gastos pero no tienen cuenta. Si eres uno, esos gastos quedan a tu nombre.</p>
            <div className="jn-opts" role="radiogroup" aria-labelledby={'jn-q-' + start}>
              {CLAIMABLE.map(p => (
                <label key={p.name} className={'jn-opt' + (who === p.name ? ' is-on' : '')}>
                  <input type="radio" name={'who-' + start} checked={who === p.name} onChange={() => setWho(p.name)} />
                  <Person name={p.name} sub={p.sub} />
                </label>
              ))}
              <label className={'jn-opt' + (who === 'nadie' ? ' is-on' : '')}>
                <input type="radio" name={'who-' + start} checked={who === 'nadie'} onChange={() => setWho('nadie')} />
                <span style={{ display: 'grid' }}><b>No, soy otra persona</b><span className="lu-small lu-muted">Entro como participante nuevo</span></span>
              </label>
            </div>
            <div className="jn-go">
              <Button>{who === 'nadie' ? 'Entrar' : 'Entrar como ' + who}</Button>
              <span className="lu-small lu-muted">Valeria o Laura pueden corregirlo si te equivocas.</span>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

mount(<Frames path="lucas.co/entrar" render={m => <Join start={m === 'm' ? 'PASEO-7K' : 'PASEO-7K2Q'} />} desktopH={860} />);
