import { C, useState, mount, Frames } from './_kit.jsx';
const { AppShell, Button, ConnectionStatus, LottieSlot, Sticker } = C;

function Step({ n, title, done, children }) {
  return (
    <li className={'wa-step' + (done ? ' is-done' : '')}>
      <span className="wa-n" aria-hidden="true">{done ? '✓' : n}</span>
      <div className="wa-body">
        <h2 className="wa-t">{title}</h2>
        {children}
      </div>
    </li>
  );
}

function Link({ start }) {
  const [st, setSt] = useState(start);
  const on = st === 'conectado';
  return (
    <AppShell account="Paseo Santa Marta" accountTone="morado" accountGlyph="P">
      <div className="wa">
        <header className="wa-head">
          <h1 className="lu-display">Conecta el grupo de WhatsApp</h1>
          <p className="lu-small lu-muted" style={{ margin: '6px 0 0', maxWidth: '52ch' }}>Todo lo que manden al grupo, sean fotos de recibos, PDFs o mensajes con montos, llega a Lucas para revisar.</p>
        </header>

        <ol className="wa-steps">
          <Step n="1" title="Agrega a Lucas al grupo" done={on || st === 'error'}>
            <div className="wa-num lu-num">+57 300 555 0142</div>
            <p className="lu-small lu-muted" style={{ margin: '0 0 12px' }}>Aparece como «Lucas». Solo lee el grupo; escribe únicamente para confirmar.</p>
            <div className="wa-row"><Button size="sm" variant="secondary">Copiar número</Button><Button size="sm" variant="ghost">Guardar contacto</Button></div>
          </Step>
          <Step n="2" title="Escribe este mensaje en el grupo" done={on}>
            <div className="wa-bubble"><span className="lu-num">lucas PASEO-7K2Q</span></div>
            <div className="wa-row"><Button size="sm" variant="secondary">Copiar mensaje</Button></div>
          </Step>
          <Step n="3" title="Espera la confirmación" done={on}>
            <div className={'wa-live wa-live--' + st}>
              <LottieSlot name={on ? 'whatsapp-conectado' : 'conectando-whatsapp'} width={64} height={64} />
              <div style={{ display: 'grid', gap: 4 }}>
                {st === 'esperando' && <ConnectionStatus state="esperando" sub="revisado hace 4 s" />}
                {st === 'conectado' && <ConnectionStatus state="conectado" sub="último mensaje 10:02 a. m. · Mafe">Conectado a «Paseo Santa Marta»</ConnectionStatus>}
                {st === 'error' && <ConnectionStatus state="error" sub="el número de Lucas no está en el grupo">Todavía no vemos el código</ConnectionStatus>}
                {on && <span className="lu-small">8 personas · 41 mensajes con gastos desde el 24 sep</span>}
                {st === 'error' && <span className="lu-small">Revisa que Lucas siga en el grupo y vuelve a escribir el mensaje.</span>}
              </div>
            </div>
          </Step>
        </ol>

        <aside className="wa-demo">
          {on && <Sticker tone="pagado" rotate={-5} size="lg">¡Listo!</Sticker>}
          <span className="lu-label">Estado (demostración)</span>
          <div className="wa-seg" role="radiogroup" aria-label="Estado de conexión">
            {['esperando', 'conectado', 'error'].map(s => <button key={s} role="radio" aria-checked={st === s} onClick={() => setSt(s)}>{s}</button>)}
          </div>
          {on && <Button>Ir a revisar · 3 pendientes</Button>}
        </aside>
      </div>
    </AppShell>
  );
}

mount(<Frames path="lucas.co/paseo-santa-marta/whatsapp" render={m => <Link start={m === 'm' ? 'esperando' : 'conectado'} />} desktopH={860} />);
