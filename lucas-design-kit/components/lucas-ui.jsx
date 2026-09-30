'use client';
/* Lucas — componentes React (Next.js / Vite). Requiere styles/tokens.css y styles/lucas.css cargados globalmente. */
import React, { useState, useEffect } from 'react';
const cx = (...a) => a.filter(Boolean).join(' ');

/** Pesos colombianos: 84300 → "$84.300" */
export function formatCOP(n, { sign = false } = {}) {
  const v = Math.round(Number(n) || 0);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (v < 0 ? '−' : sign && v > 0 ? '+' : '') + '$' + s;
}
/** "412 lucas" — la forma de decirlo en voz alta (miles de pesos) */
export function lucas(n) {
  const k = Math.abs(Number(n) || 0) / 1000;
  const t = k >= 1000 ? (k / 1000).toFixed(1).replace('.0', '').replace('.', ',') + ' palos' : (Number.isInteger(k) ? k : k.toFixed(1).replace('.', ',')) + ' lucas';
  return t;
}

/* ---------- tonos: personas y categorías ---------- */
export const TONES = ['morado', 'naranja', 'azul', 'coral', 'verde', 'amarillo', 'turquesa', 'rosa'];
const toneVars = t => ({ '--c': `var(--tono-${t})`, '--cf': 'var(--tinta-fija)' });
const TONE_MAP = {};
/** Fija el tono de cada persona de una cuenta: setTones({ Valeria: 'morado', ... }) */
export function setTones(map) { Object.assign(TONE_MAP, map); }
export function toneFor(name) {
  if (TONE_MAP[name]) return TONE_MAP[name];
  let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}
export const CATEGORIES = {
  'Café': ['C', 'naranja'], 'Licor': ['L', 'morado'], 'Mercado': ['M', 'verde'], 'Transporte': ['T', 'azul'],
  'Hospedaje': ['H', 'turquesa'], 'Restaurante': ['R', 'coral'], 'Servicios': ['S', 'amarillo'], 'Otros': ['O', 'rosa'],
};

/* ---------- Divider ---------- */
export function Divider({ variant = 'line', label, className }) {
  if (label) return <div role="separator" className={cx('lu-divider lu-divider--label lu-label', className)}>{label}</div>;
  return <hr className={cx('lu-divider', variant === 'wave' && 'lu-divider--wave', className)} />;
}

/* ---------- Amount ---------- */
function Rolling({ text }) {
  return (
    <span aria-hidden="true">
      {text.split('').map((ch, i) => /\d/.test(ch) ? (
        <span className="lu-roll" key={i}>
          <span className="lu-roll__col" style={{ transform: `translateY(${-Number(ch) * 10}%)` }}>
            {'0123456789'.split('').map(d => <span key={d}>{d}</span>)}
          </span>
        </span>
      ) : <span key={i}>{ch}</span>)}
    </span>
  );
}
export function Amount({ value, size = 'md', highlight = false, roll = false, tone, sign = false, className }) {
  const text = formatCOP(value, { sign });
  return (
    <span className={cx('lu-amount', 'lu-amount--' + size, tone && 'lu-amount--' + tone, highlight && 'lu-amount--hl', className)} aria-label={roll ? text : undefined}>
      {roll ? <Rolling text={text} /> : text}
    </span>
  );
}

/* ---------- BillCard (hero) ---------- */
export function BillCard({ label, amount, denom = 'LUCAS', tone = 'verde', roll = false, highlight = true, children, aside }) {
  return (
    <section className={cx('lu-bill', tone === 'morado' && 'lu-bill--morado')}>
      <div className="lu-bill__top">
        <span className="lu-bill__label">{label}</span>
        {aside || <span className="lu-bill__denom">{denom}</span>}
      </div>
      <span className="lu-bill__amount"><Amount value={amount} size="xl" roll={roll} highlight={highlight} /></span>
      {children && <div className="lu-bill__foot">{children}</div>}
    </section>
  );
}

/* ---------- Sticker ---------- */
const STICKER_TEXT = { pagado: 'Pagado', confirmado: 'Listo', revisar: 'Revisar', pendiente: 'Pendiente', alerta: 'Ojo', cerrado: 'Saldado' };
export function Sticker({ tone = 'pagado', children, sub, size = 'md', rotate = -4, animate = false, className }) {
  return (
    <span role="img" aria-label={(children || STICKER_TEXT[tone]) + (sub ? ', ' + sub : '')}
      className={cx('lu-sticker', 'lu-sticker--' + tone, size !== 'md' && 'lu-sticker--' + size, animate && 'lu-sticker--pop', className)}
      style={{ '--rot': rotate + 'deg' }}>
      {children || STICKER_TEXT[tone]}
      {sub ? <span className="lu-sticker__sub">{sub}</span> : null}
    </span>
  );
}

/* ---------- CategoryTag ---------- */
export function CategoryTag({ name, showName = true, size = 'md' }) {
  const [g, t] = CATEGORIES[name] || [String(name)[0], 'rosa'];
  return (
    <span className={cx('lu-cat', size !== 'md' && 'lu-cat--' + size)}>
      <span className="lu-cat__glyph" style={toneVars(t)} aria-hidden={showName}>{g}</span>
      {showName && name}
    </span>
  );
}

/* ---------- ExpenseCard ---------- */
export function ExpenseCard({ merchant, category, meta, total, each, sticker, appear = false, onClick, children, flat = false, className, style }) {
  return (
    <article className={cx('lu-card', flat && 'lu-card--flat', onClick && 'lu-card--click', appear && 'lu-appear', className)} style={style}
      onClick={onClick} tabIndex={onClick ? 0 : undefined}>
      <div className="lu-expense">
        {category && <span className="lu-expense__cat"><CategoryTag name={category} showName={false} size="lg" /></span>}
        <span className="lu-expense__m">{merchant}</span>
        {total != null && <span className="lu-expense__amt"><Amount value={total} size="lg" /></span>}
        {meta && <span className="lu-expense__meta">{meta}</span>}
        {each && <span className="lu-expense__each">{each}</span>}
      </div>
      {children && <div className="lu-expense__body">{children}</div>}
      {sticker && <div className="lu-card__sticker">{sticker}</div>}
    </article>
  );
}
export function Row({ label, value, amount, muted = false, total = false }) {
  return (
    <div className={cx('lu-row', muted && 'lu-row--muted', total && 'lu-row--total')}>
      <span className="lu-row__label">{label}</span>
      {amount != null ? <Amount value={amount} size={total ? 'lg' : 'md'} /> : <span className="lu-num" style={{ fontWeight: 600 }}>{value}</span>}
    </div>
  );
}

/* ---------- Avatar / Person ---------- */
const initials = n => n.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
export function Avatar({ name, tone, size = 'md', registered = true }) {
  return (
    <span className={cx('lu-avatar', size !== 'md' && 'lu-avatar--' + size, !registered && 'lu-avatar--ghost')}
      style={registered ? toneVars(tone || toneFor(name)) : undefined} aria-hidden="true">{initials(name)}</span>
  );
}
export function Person({ name, sub, tone, registered = true, role, size = 'md', aside }) {
  return (
    <div className="lu-person">
      <Avatar name={name} tone={tone} size={size} registered={registered} />
      <span style={{ minWidth: 0, display: 'grid' }}>
        <span className="lu-person__name">{name}</span>
        {(sub || !registered) && <span className="lu-person__sub">{sub || 'Sin cuenta · solo en WhatsApp'}</span>}
      </span>
      {role && <span className={cx('lu-role', 'lu-role--' + role)} style={{ marginLeft: 'auto' }}>{{ owner: 'Dueña', admin: 'Admin', member: 'Miembro' }[role]}</span>}
      {aside}
    </div>
  );
}

/* ---------- Correction ---------- */
export function Correction({ was, children, by, tone }) {
  return (
    <span className="lu-fix">
      {was != null && <span className="lu-fix__was">{was}</span>}
      <span className="lu-fix__now">{children}</span>
      {by && <span className="lu-fix__by"><Avatar name={by} tone={tone} size="xs" />corrigió {by}</span>}
    </span>
  );
}

/* ---------- Button ---------- */
export function Button({ variant = 'primary', size = 'md', kbd, children, className, ...rest }) {
  return (
    <button type="button" {...rest} className={cx('lu-btn', 'lu-btn--' + variant, size === 'sm' && 'lu-btn--sm', className)}>
      {children}{kbd && <span className="lu-btn__kbd" aria-hidden="true">{kbd}</span>}
    </button>
  );
}

/* ---------- Confidence ---------- */
export function Confidence({ value, corrected = false }) {
  if (corrected) return <span className="lu-conf lu-conf--humano">Corregido a mano</span>;
  const lvl = value >= 0.9 ? 'alta' : value >= 0.75 ? 'media' : 'baja';
  return (
    <span className={cx('lu-conf', 'lu-conf--' + lvl)} title={'Confianza de lectura: ' + Math.round(value * 100) + ' %'}>
      <span className="lu-conf__dots" aria-hidden="true"><i /><i /><i /></span>
      {{ alta: 'Seguro', media: 'Casi seguro', baja: 'Revísalo' }[lvl]} · {Math.round(value * 100)} %
    </span>
  );
}

/* ---------- Field ---------- */
export function Field({ label, value, onChange, confidence, original, corrected, correctedBy, num = false, inputMode, id, children }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => { setV(value ?? ''); }, [value]);
  const isFixed = corrected ?? (original != null && String(v) !== String(original));
  const low = !isFixed && confidence != null && confidence < 0.75;
  const fid = id || 'f-' + String(label).toLowerCase().normalize('NFD').replace(/[^a-z]+/g, '-');
  return (
    <div className={cx('lu-field', num && 'lu-field--num', low && 'lu-field--low', isFixed && 'lu-field--fixed')}>
      <div className="lu-field__top">
        <label className="lu-label" htmlFor={fid}>{label}</label>
        {confidence != null && <Confidence value={confidence} corrected={isFixed} />}
      </div>
      {children || <input id={fid} value={v} inputMode={inputMode} onChange={e => { setV(e.target.value); onChange && onChange(e.target.value); }} />}
      {isFixed && original != null && (
        <span className="lu-fix"><span className="lu-fix__was">{original}</span>
          <span className="lu-fix__by">{correctedBy ? <><Avatar name={correctedBy} size="xs" />corrigió {correctedBy}</> : 'Tu corrección'}</span></span>
      )}
    </div>
  );
}

/* ---------- Chip ---------- */
export function Chip({ pressed = true, onToggle, name, tone, children }) {
  return (
    <button type="button" className="lu-chip" aria-pressed={pressed} onClick={onToggle}>
      {name && <Avatar name={name} tone={tone} size="sm" />}{children || name}
    </button>
  );
}

/* ---------- BudgetBar ---------- */
export function BudgetBar({ name, spent, budget, category }) {
  const pct = budget > 0 ? spent / budget : 0;
  const state = pct > 1 ? 'over' : pct >= 0.85 ? 'near' : null;
  return (
    <div className={cx('lu-budget', state && 'lu-budget--' + state)}>
      <div className="lu-budget__row">
        <span className="lu-budget__name">{category !== false && <CategoryTag name={name} showName={false} size="sm" />}{name}</span>
        <span className="lu-amount lu-amount--sm">{formatCOP(spent)} <span className="lu-muted">/ {formatCOP(budget)}</span></span>
      </div>
      <div className="lu-budget__bar" role="meter" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={spent} aria-label={name}>
        <div className="lu-budget__fill" style={{ width: Math.min(pct, 1) * 100 + '%' }} />
      </div>
      <div className="lu-budget__foot">{pct > 1 ? 'Te pasaste ' + formatCOP(spent - budget) : 'Quedan ' + formatCOP(budget - spent) + ' · ' + Math.round(pct * 100) + ' %'}</div>
    </div>
  );
}

/* ---------- LottieSlot ---------- */
export function LottieSlot({ name, width = 120, height = 120, label, src, square = false }) {
  return (
    <div className={cx('lu-lottie', square && 'lu-lottie--square')} role="img" aria-label={label || name} data-lottie={src || name + '.json'} style={{ width, height }}>
      {width < 56 ? <b>L</b> : <span><b>LOTTIE</b>{name}<br />{width}×{height}</span>}
    </div>
  );
}

/* ---------- CodeInput ---------- */
export const CODE_RE = /^[A-Z]{3,8}-[A-Z0-9]{4}$/;
export function formatCode(raw) {
  const s = String(raw).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const [a = '', b] = s.split('-');
  if (b != null) return a.slice(0, 8) + '-' + b.replace(/-/g, '').slice(0, 4);
  return a.slice(0, 13);
}
export function CodeInput({ value = '', onChange, label = 'Código de la cuenta', hint, error, readOnly = false, id = 'codigo' }) {
  const [v, setV] = useState(value);
  const ok = CODE_RE.test(v) && !error;
  const err = !!error;
  return (
    <div className={cx('lu-code', ok && 'lu-code--ok', err && 'lu-code--error')}>
      <label className="lu-code__label" htmlFor={id}>{label}</label>
      <input id={id} className="lu-code__input" value={v} readOnly={readOnly} placeholder="PASEO-7K2Q" autoCapitalize="characters" autoComplete="off" spellCheck={false}
        onChange={e => { const n = formatCode(e.target.value); setV(n); onChange && onChange(n); }} />
      <span className="lu-code__hint" aria-live="polite">{err ? error : ok ? (hint || 'Código completo') : 'Una palabra, un guion y 4 letras o números'}</span>
    </div>
  );
}

/* ---------- Evidence ---------- */
export function Evidence({ kind = 'foto', sender, time, group, file, pages, receipt, messages, box }) {
  return (
    <figure className="lu-evi">
      <figcaption className="lu-evi__from">
        <Avatar name={sender} size="sm" />
        <span style={{ display: 'grid' }}><b>{sender}</b>
          <span>{kind === 'foto' ? 'mandó una foto' : kind === 'pdf' ? 'mandó un PDF' : 'escribió'} · {time}{group ? ' · ' + group : ''}</span></span>
      </figcaption>
      {kind === 'foto' && (
        <div className="lu-evi__photo">
          <div className="lu-evi__receipt">
            <b>{receipt?.title}</b>
            <div style={{ textAlign: 'center', opacity: .8 }}>{receipt?.sub}</div>
            <hr />
            {(receipt?.lines || []).map((l, i) => <i key={i}><span>{l[0]}</span><span>{l[1]}</span></i>)}
            <hr />
            <i style={{ fontWeight: 700, fontSize: 10, position: 'relative' }}>
              <span>TOTAL</span><span>{receipt?.total}</span>
              {box && <span className="lu-evi__box" style={{ inset: '-3px -4px' }}><span>{box}</span></span>}
            </i>
            <div style={{ textAlign: 'center', marginTop: 10, opacity: .7 }}>{receipt?.foot}</div>
          </div>
        </div>
      )}
      {kind === 'pdf' && (
        <div className="lu-evi__pdf">
          <div className="lu-evi__page">
            <b>{receipt?.title}</b><span>{receipt?.sub}</span>
            <div className="bar" style={{ width: '70%' }} /><div className="bar" style={{ width: '90%' }} /><div className="bar" style={{ width: '55%' }} />
            {(receipt?.lines || []).map((l, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{l[0]}</span><span>{l[1]}</span></div>)}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, position: 'relative', marginTop: 4 }}>
              <span>Total a pagar</span><span>{receipt?.total}</span>
              {box && <span className="lu-evi__box" style={{ inset: '-3px -4px' }}><span>{box}</span></span>}
            </div>
          </div>
          <div className="lu-evi__file"><span>{file}</span><span className="lu-muted">{pages} pág.</span></div>
        </div>
      )}
      {kind === 'mensaje' && (
        <div className="lu-evi__chat">
          {(messages || []).map((m, i) => (
            <div key={i} className={cx('lu-evi__msg', m.dim && 'lu-evi__msg--dim', m.target && 'lu-evi__msg--target')} style={{ '--c': `var(--${m.whoColor || 'morado'})` }}>
              <span className="who">{m.who}</span>{m.text}<span className="t">{m.time}</span>
            </div>
          ))}
        </div>
      )}
    </figure>
  );
}

/* ---------- ConnectionStatus ---------- */
export function ConnectionStatus({ state = 'esperando', children, sub }) {
  const txt = { esperando: 'Esperando el código en el grupo', conectado: 'Conectado', error: 'No pudimos conectar' }[state];
  return (
    <span className={cx('lu-conn', 'lu-conn--' + state)} role="status" aria-live="polite">
      <span className="lu-conn__dot" aria-hidden="true" />
      <span style={{ display: 'grid' }}>{children || txt}{sub && <span className="lu-conn__sub">{sub}</span>}</span>
    </span>
  );
}

/* ---------- Logo ---------- */
export function Logo({ size = 24 }) {
  return (
    <span className="lu-logo" style={{ fontSize: size, lineHeight: size + 2 + 'px' }}>
      <svg className="lu-logo__mark" viewBox="0 0 32 32" aria-hidden="true" style={{ width: size * 1.25, height: size * 1.25 }}>
        <rect className="c" x="3" y="7" width="22" height="15" rx="4" transform="rotate(-14 14 14.5)" />
        <rect className="a" x="7" y="10" width="22" height="15" rx="4" transform="rotate(6 18 17.5)" />
        <circle className="b" cx="18" cy="17.5" r="4.2" />
      </svg>
      lucas
    </span>
  );
}

/* ---------- íconos de navegación (trazo, 24px) ---------- */
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
export const ICONS = {
  resumen: <svg viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M5 20V11M12 20V5M19 20v-6" /></svg>,
  revisar: <svg viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M4 13l2.5-7h11L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path {...P} d="M4 13h4.5l1 2h5l1-2H20" /></svg>,
  gastos: <svg viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.5" fill="currentColor" /><circle cx="4.5" cy="12" r="1.5" fill="currentColor" /><circle cx="4.5" cy="18" r="1.5" fill="currentColor" /></svg>,
  liquidar: <svg viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M4 8h14l-3-3M20 16H6l3 3" /></svg>,
  personas: <svg viewBox="0 0 24 24" aria-hidden="true"><circle {...P} cx="9" cy="8" r="3.5" /><path {...P} d="M2.5 20c.8-3.5 3.3-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path {...P} d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.7 3.1 2.4 3.5 5.2" /></svg>,
  presupuestos: <svg viewBox="0 0 24 24" aria-hidden="true"><circle {...P} cx="12" cy="12" r="8.5" /><path {...P} d="M12 3.5V12l6 6" /></svg>,
};

/* ---------- AppShell ---------- */
export function AppShell({ account, accountTone = 'verde', accountGlyph = 'L', tabs = [], active, onTab, children, onAccount }) {
  const tabEls = tabs.map(t => (
    <button key={t.id} className="lu-tab" aria-current={t.id === active ? 'page' : undefined} onClick={() => onTab && onTab(t.id)}>
      {ICONS[t.icon || t.id]}
      <span>{t.label}</span>
      {t.count ? <span className="lu-tab__count">{t.count}</span> : null}
    </button>
  ));
  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <Logo />
        {account && <button className="lu-app__acct" onClick={onAccount}>
          <span className="lu-cat__glyph" style={toneVars(accountTone)} aria-hidden="true">{accountGlyph}</span>
          <span>{account}</span><span aria-hidden="true">▾</span></button>}
      </header>
      <div className="lu-app__body">
        {tabs.length > 0 && <nav className="lu-app__rail" aria-label="Secciones">{tabEls}</nav>}
        <main className="lu-app__main">{children}</main>
      </div>
      {tabs.length > 0 && <nav className="lu-tabs" aria-label="Secciones">{tabEls}</nav>}
    </div>
  );
}
