import { C, useState, mount, Frames, TABS_EVENTO } from './_kit.jsx';
const { AppShell, Person, Button, CodeInput, Divider } = C;

const MEMBERS = [
  { name: 'Valeria', role: 'owner', sub: 'Tú · creó la cuenta' },
  { name: 'Laura', role: 'admin', sub: '9 gastos · entró el 24 sep' },
  { name: 'Mafe', role: 'member', sub: '7 gastos · corrigió 4' },
  { name: 'Juan Camilo', role: 'member', sub: '6 gastos' },
  { name: 'Andrés', role: 'member', sub: '5 gastos' },
  { name: 'Santi', role: 'member', sub: '2 gastos' },
  { name: 'Caro', registered: false, sub: 'Solo en WhatsApp · +57 ••• 4471' },
  { name: 'Felipe', registered: false, sub: 'Solo en WhatsApp · +57 ••• 0918' },
];
const ROLE_TXT = [['owner', 'Dueña', 'Todo, incluso borrar la cuenta'], ['admin', 'Admin', 'Edita gastos y personas, cierra el evento'], ['member', 'Miembro', 'Manda y corrige gastos']];
const rnd = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

function Members() {
  const [roles, setRoles] = useState(Object.fromEntries(MEMBERS.map(m => [m.name, m.role])));
  const [code, setCode] = useState('PASEO-7K2Q');
  const [old, setOld] = useState(null);
  return (
    <AppShell account="Paseo Santa Marta" accountTone="morado" accountGlyph="P" tabs={TABS_EVENTO(3)} active="personas">
      <div className="mb">
        <header className="mb-head">
          <h1 className="lu-display">Personas</h1>
          <span className="lu-small lu-muted">8 en la cuenta · 6 con cuenta y 2 solo en WhatsApp</span>
        </header>
        <section className="mb-list" aria-label="Miembros">
          <ul>
            {MEMBERS.filter(m => m.registered !== false).map(m => (
              <li key={m.name}>
                <Person name={m.name} sub={m.sub} />
                {roles[m.name] === 'owner'
                  ? <span className="lu-role lu-role--owner">Dueña</span>
                  : <select className="mb-role" aria-label={'Rol de ' + m.name} value={roles[m.name]} onChange={e => setRoles(r => ({ ...r, [m.name]: e.target.value }))}>
                      <option value="admin">Admin</option><option value="member">Miembro</option>
                    </select>}
              </li>
            ))}
          </ul>
          <Divider label="Todavía sin cuenta" />
          <ul>
            {MEMBERS.filter(m => m.registered === false).map(m => (
              <li key={m.name}><Person name={m.name} sub={m.sub} registered={false} /><Button size="sm" variant="outline">Invitar</Button></li>
            ))}
          </ul>
          <p className="lu-small lu-muted" style={{ margin: 'var(--space-3) 0 0' }}>Sus gastos ya cuentan. Cuando entren con el código, eligen su nombre y quedan enlazados.</p>
        </section>
        <aside className="mb-inv">
          <h2 className="lu-title">Invitar</h2>
          <CodeInput key={code} value={code} readOnly label="Código de invitación" hint="Vence el 5 oct · sirve para 10 personas más" id="inv" />
          {old && <span className="mb-old">{old} ya no sirve</span>}
          <div className="mb-link lu-small">lucas.co/e/{code}</div>
          <div className="mb-btns">
            <Button size="sm">Copiar link</Button>
            <Button size="sm" variant="secondary">Mandar al grupo</Button>
            <Button size="sm" variant="ghost" onClick={() => { setOld(code); setCode('PASEO-' + rnd()); }}>Código nuevo</Button>
          </div>
          <dl className="mb-roles">
            {ROLE_TXT.map(([k, l, v]) => <div key={k}><dt><span className={'lu-role lu-role--' + k}>{l}</span></dt><dd className="lu-small">{v}</dd></div>)}
          </dl>
        </aside>
      </div>
    </AppShell>
  );
}

mount(<Frames path="lucas.co/paseo-santa-marta/personas" render={() => <Members />} desktopH={900} phoneH={1100} />);
