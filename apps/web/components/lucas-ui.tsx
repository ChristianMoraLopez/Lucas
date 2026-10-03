'use client';
/* Luks — componentes React (Next.js). Requiere styles/tokens.css y styles/lucas.css cargados globalmente.
   Port tipado de lucas-design-kit/components/lucas-ui.jsx (tipos de lucas-ui.d.ts).
   Las funciones puras (formatCOP, lucas, tonos, códigos) viven en lucas-core.ts y se re-exportan aquí. */
import Link from 'next/link';
import type React from 'react';
import { useEffect, useState } from 'react';
import { isLottieName, Lottie } from './lottie';
import { CATEGORIES, CODE_RE, formatCOP, formatCode, type Tone, toneFor } from './lucas-core';

export { CATEGORIES, CODE_RE, formatCOP, formatCode, lucas, setTones, TONES, type Tone, toneFor } from './lucas-core';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');
const toneVars = (t: Tone) => ({ '--c': `var(--tono-${t})`, '--cf': 'var(--tinta-fija)' }) as React.CSSProperties;

/* ---------- Divider ---------- */
export function Divider({ variant = 'line', label, className }: { variant?: 'line' | 'wave'; label?: React.ReactNode; className?: string }) {
  if (label)
    return (
      <div role="separator" className={cx('lu-divider lu-divider--label lu-label', className)}>
        {label}
      </div>
    );
  return <hr className={cx('lu-divider', variant === 'wave' && 'lu-divider--wave', className)} />;
}

/* ---------- Amount ---------- */
function Rolling({ text }: { text: string }) {
  return (
    <span aria-hidden="true">
      {text.split('').map((ch, i) =>
        /\d/.test(ch) ? (
          <span className="lu-roll" key={i}>
            <span className="lu-roll__col" style={{ transform: `translateY(${-Number(ch) * 10}%)` }}>
              {'0123456789'.split('').map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </span>
  );
}
export function Amount({
  value,
  size = 'md',
  highlight = false,
  roll = false,
  tone,
  sign = false,
  className,
}: {
  value: number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  highlight?: boolean;
  roll?: boolean;
  tone?: 'pos' | 'neg';
  sign?: boolean;
  className?: string;
}) {
  const text = formatCOP(value, { sign });
  return (
    <span className={cx('lu-amount', 'lu-amount--' + size, tone && 'lu-amount--' + tone, highlight && 'lu-amount--hl', className)}>
      {roll ? (
        <>
          {/* Los dígitos que ruedan son decorativos; el lector de pantalla lee el monto */}
          <span className="lu-sr">{text}</span>
          <Rolling text={text} />
        </>
      ) : (
        text
      )}
    </span>
  );
}

/* ---------- BillCard (hero) ---------- */
export function BillCard({
  label,
  amount,
  denom = 'LUCAS',
  tone = 'verde',
  roll = false,
  highlight = true,
  children,
  aside,
  href,
  linkLabel,
}: {
  label: React.ReactNode;
  amount: number;
  tone?: 'verde' | 'morado';
  denom?: string;
  aside?: React.ReactNode;
  roll?: boolean;
  highlight?: boolean;
  children?: React.ReactNode;
  /** Toda la tarjeta lleva aquí (p. ej. a los gastos del mes); los enlaces del `aside` siguen funcionando */
  href?: string;
  linkLabel?: string;
}) {
  const cifra = <Amount value={amount} size="xl" roll={roll} highlight={highlight} />;
  return (
    <section className={cx('lu-bill', tone === 'morado' && 'lu-bill--morado', href && 'lu-bill--link')}>
      <div className="lu-bill__top">
        <span className="lu-bill__label">{label}</span>
        {aside || <span className="lu-bill__denom">{denom}</span>}
      </div>
      <span className="lu-bill__amount">
        {href ? (
          <Link href={href} className="lu-bill__link" aria-label={linkLabel}>
            {cifra}
          </Link>
        ) : (
          cifra
        )}
      </span>
      {children && <div className="lu-bill__foot">{children}</div>}
    </section>
  );
}

/* ---------- Sticker ---------- */
const STICKER_TEXT = { pagado: 'Pagado', confirmado: 'Listo', revisar: 'Revisar', pendiente: 'Pendiente', alerta: 'Ojo', cerrado: 'Saldado' } as const;
export function Sticker({
  tone = 'pagado',
  children,
  sub,
  size = 'md',
  rotate = -4,
  animate = false,
  className,
}: {
  tone?: keyof typeof STICKER_TEXT;
  children?: React.ReactNode;
  sub?: string;
  size?: 'sm' | 'md' | 'lg';
  rotate?: number;
  animate?: boolean;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={String(children || STICKER_TEXT[tone]) + (sub ? ', ' + sub : '')}
      className={cx('lu-sticker', 'lu-sticker--' + tone, size !== 'md' && 'lu-sticker--' + size, animate && 'lu-sticker--pop', className)}
      style={{ '--rot': rotate + 'deg' } as React.CSSProperties}
    >
      {children || STICKER_TEXT[tone]}
      {sub ? <span className="lu-sticker__sub">{sub}</span> : null}
    </span>
  );
}

/* ---------- CategoryTag ---------- */
export function CategoryTag({
  name,
  showName = true,
  size = 'md',
  letter,
  tone,
}: {
  name: string;
  showName?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Las categorías propias de una cuenta traen su letra y su color de la base */
  letter?: string;
  tone?: Tone;
}) {
  const [g, t] = CATEGORIES[name] || [letter || String(name)[0], tone || ('rosa' as Tone)];
  return (
    <span className={cx('lu-cat', size !== 'md' && 'lu-cat--' + size)}>
      <span className="lu-cat__glyph" style={toneVars(t)} aria-hidden={showName}>
        {g}
      </span>
      {showName && name}
    </span>
  );
}

/* ---------- ExpenseCard ---------- */
export function ExpenseCard({
  merchant,
  category,
  meta,
  total,
  each,
  sticker,
  appear = false,
  onClick,
  children,
  flat = false,
  className,
  style,
}: {
  merchant: React.ReactNode;
  category?: string;
  meta?: React.ReactNode;
  total?: number;
  each?: React.ReactNode;
  sticker?: React.ReactNode;
  appear?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
  flat?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <article
      className={cx('lu-card', flat && 'lu-card--flat', onClick && 'lu-card--click', appear && 'lu-appear', className)}
      style={style}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="lu-expense">
        {category && (
          <span className="lu-expense__cat">
            <CategoryTag name={category} showName={false} size="lg" />
          </span>
        )}
        <span className="lu-expense__m">{merchant}</span>
        {total != null && (
          <span className="lu-expense__amt">
            <Amount value={total} size="lg" />
          </span>
        )}
        {meta && <span className="lu-expense__meta">{meta}</span>}
        {each && <span className="lu-expense__each">{each}</span>}
      </div>
      {children && <div className="lu-expense__body">{children}</div>}
      {sticker && <div className="lu-card__sticker">{sticker}</div>}
    </article>
  );
}
export function Row({
  label,
  value,
  amount,
  muted = false,
  total = false,
}: {
  label: React.ReactNode;
  amount?: number;
  value?: React.ReactNode;
  muted?: boolean;
  total?: boolean;
}) {
  return (
    <div className={cx('lu-row', muted && 'lu-row--muted', total && 'lu-row--total')}>
      <span className="lu-row__label">{label}</span>
      {amount != null ? (
        <Amount value={amount} size={total ? 'lg' : 'md'} />
      ) : (
        <span className="lu-num" style={{ fontWeight: 600 }}>
          {value}
        </span>
      )}
    </div>
  );
}

/* ---------- Avatar / Person ---------- */
/** «Juan Camilo» → «JC». Solo letras y números: los nombres de WhatsApp traen emojis («Juli 🌻» → «J») */
const initials = (n: string) => ((n.match(/(?<![\p{L}\p{N}])[\p{L}\p{N}]/gu) ?? []).slice(0, 2).join('') || '?').toUpperCase();
export function Avatar({ name, tone, size = 'md', registered = true }: { name: string; tone?: Tone; size?: 'xs' | 'sm' | 'md'; registered?: boolean }) {
  return (
    <span
      className={cx('lu-avatar', size !== 'md' && 'lu-avatar--' + size, !registered && 'lu-avatar--ghost')}
      style={registered ? toneVars(tone || toneFor(name)) : undefined}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
// «Titular» en vez de «Dueña/Dueño»: no sabemos el género de cada quien.
const ROLE_LABELS = { owner: 'Titular', admin: 'Admin', member: 'Miembro' } as const;
export function Person({
  name,
  sub,
  tone,
  registered = true,
  role,
  size = 'md',
  aside,
}: {
  name: string;
  sub?: React.ReactNode;
  tone?: Tone;
  registered?: boolean;
  role?: keyof typeof ROLE_LABELS;
  size?: 'xs' | 'sm' | 'md';
  aside?: React.ReactNode;
}) {
  return (
    <div className="lu-person">
      <Avatar name={name} tone={tone} size={size} registered={registered} />
      <span style={{ minWidth: 0, display: 'grid' }}>
        <span className="lu-person__name">{name}</span>
        {(sub || !registered) && <span className="lu-person__sub">{sub || 'Sin cuenta · solo en WhatsApp'}</span>}
      </span>
      {role && (
        <span className={cx('lu-role', 'lu-role--' + role)} style={{ marginLeft: 'auto' }}>
          {ROLE_LABELS[role]}
        </span>
      )}
      {aside}
    </div>
  );
}

/* ---------- Correction ---------- */
export function Correction({ was, children, by, tone }: { was?: React.ReactNode; children: React.ReactNode; by?: string; tone?: Tone }) {
  return (
    <span className="lu-fix">
      {was != null && <span className="lu-fix__was">{was}</span>}
      <span className="lu-fix__now">{children}</span>
      {by && (
        <span className="lu-fix__by">
          <Avatar name={by} tone={tone} size="xs" />
          corrigió {by}
        </span>
      )}
    </span>
  );
}

/* ---------- Button ---------- */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'md' | 'sm';
  kbd?: string;
}
export function Button({ variant = 'primary', size = 'md', kbd, children, className, ...rest }: ButtonProps) {
  return (
    <button type="button" {...rest} className={cx('lu-btn', 'lu-btn--' + variant, size === 'sm' && 'lu-btn--sm', className)}>
      {children}
      {kbd && (
        <span className="lu-btn__kbd" aria-hidden="true">
          {kbd}
        </span>
      )}
    </button>
  );
}

/* ---------- Confidence ---------- */
export function Confidence({ value, corrected = false }: { value: number; corrected?: boolean }) {
  if (corrected) return <span className="lu-conf lu-conf--humano">Corregido a mano</span>;
  const lvl = value >= 0.9 ? 'alta' : value >= 0.75 ? 'media' : 'baja';
  const txt = { alta: 'Seguro', media: 'Casi seguro', baja: 'Revísalo' }[lvl];
  return (
    <span className={cx('lu-conf', 'lu-conf--' + lvl)} title={'Confianza de lectura: ' + Math.round(value * 100) + ' %'}>
      <span className="lu-conf__dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {txt} · {Math.round(value * 100)} %
    </span>
  );
}

/* ---------- Field ---------- */
export function Field({
  label,
  value,
  onChange,
  confidence,
  original,
  corrected,
  correctedBy,
  num = false,
  inputMode,
  id,
  children,
}: {
  label: string;
  value?: string;
  onChange?: (v: string) => void;
  confidence?: number;
  original?: string;
  corrected?: boolean;
  correctedBy?: string;
  num?: boolean;
  inputMode?: string;
  id?: string;
  children?: React.ReactNode;
}) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => {
    setV(value ?? '');
  }, [value]);
  const isFixed = corrected ?? (original != null && String(v) !== String(original));
  const low = !isFixed && confidence != null && confidence < 0.75;
  const fid =
    id ||
    'f-' +
      String(label)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[^a-z]+/g, '-');
  return (
    <div className={cx('lu-field', num && 'lu-field--num', low && 'lu-field--low', isFixed && 'lu-field--fixed')}>
      <div className="lu-field__top">
        <label className="lu-label" htmlFor={fid}>
          {label}
        </label>
        {confidence != null && <Confidence value={confidence} corrected={isFixed} />}
      </div>
      {children || (
        <input
          id={fid}
          value={v}
          inputMode={inputMode as React.InputHTMLAttributes<HTMLInputElement>['inputMode']}
          onChange={(e) => {
            setV(e.target.value);
            onChange?.(e.target.value);
          }}
        />
      )}
      {isFixed && original != null && (
        <span className="lu-fix">
          <span className="lu-fix__was">{original}</span>
          <span className="lu-fix__by">
            {correctedBy ? (
              <>
                <Avatar name={correctedBy} size="xs" />
                corrigió {correctedBy}
              </>
            ) : (
              'Tu corrección'
            )}
          </span>
        </span>
      )}
    </div>
  );
}

/* ---------- Chip ---------- */
export function Chip({
  pressed = true,
  onToggle,
  name,
  tone,
  children,
  style,
}: {
  name?: string;
  tone?: Tone;
  pressed?: boolean;
  onToggle?: () => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <button type="button" className="lu-chip" aria-pressed={pressed} onClick={onToggle} style={style}>
      {name && <Avatar name={name} tone={tone} size="sm" />}
      {children || name}
    </button>
  );
}

/* ---------- BudgetBar ---------- */
export function BudgetBar({ name, spent, budget, category }: { name: string; spent: number; budget: number; category?: boolean }) {
  const pct = budget > 0 ? spent / budget : 0;
  const state = pct > 1 ? 'over' : pct >= 0.85 ? 'near' : null;
  return (
    <div className={cx('lu-budget', state && 'lu-budget--' + state)}>
      <div className="lu-budget__row">
        <span className="lu-budget__name">
          {category !== false && <CategoryTag name={name} showName={false} size="sm" />}
          {name}
        </span>
        <span className="lu-amount lu-amount--sm">
          {formatCOP(spent)} <span className="lu-muted">/ {formatCOP(budget)}</span>
        </span>
      </div>
      <div className="lu-budget__bar" role="meter" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={spent} aria-label={name}>
        <div className="lu-budget__fill" style={{ width: Math.min(pct, 1) * 100 + '%' }} />
      </div>
      <div className="lu-budget__foot">
        {pct > 1 ? 'Te pasaste ' + formatCOP(spent - budget) : 'Quedan ' + formatCOP(budget - spent) + ' · ' + Math.round(pct * 100) + ' %'}
      </div>
    </div>
  );
}

/* ---------- LottieSlot ---------- */
export function LottieSlot({
  name,
  width = 120,
  height = 120,
  label,
  src,
  square = false,
  onLoad,
  alVerse,
}: {
  name: string;
  width?: number;
  height?: number;
  square?: boolean;
  label?: string;
  src?: string;
  /** Ya se ve la animación */
  onLoad?: () => void;
  /** Arranca cuando aparece en pantalla, una vez */
  alVerse?: boolean;
}) {
  // Si ya tenemos la animación (public/lottie), se reproduce; si no, queda el espacio reservado del kit
  if (!src && isLottieName(name)) return <Lottie name={name} width={width} height={height} label={label} onLoad={onLoad} alVerse={alVerse} />;
  return (
    <div
      className={cx('lu-lottie', square && 'lu-lottie--square')}
      role="img"
      aria-label={label || name}
      data-lottie={src || name + '.json'}
      style={{ width, height }}
    >
      {width < 56 ? (
        <b>L</b>
      ) : (
        <span>
          <b>LOTTIE</b>
          {name}
          <br />
          {width}×{height}
        </span>
      )}
    </div>
  );
}

/* ---------- CodeInput ---------- */
export function CodeInput({
  value = '',
  onChange,
  label = 'Código de la cuenta',
  hint,
  error,
  readOnly = false,
  id = 'codigo',
}: {
  value?: string;
  onChange?: (v: string) => void;
  label?: string;
  hint?: string;
  error?: string | null;
  readOnly?: boolean;
  id?: string;
}) {
  const [v, setV] = useState(value);
  // El código puede llegar después (del link /e/CODIGO o de «Código nuevo»)
  useEffect(() => {
    setV(value);
  }, [value]);
  const ok = CODE_RE.test(v) && !error;
  const err = !!error;
  return (
    <div className={cx('lu-code', ok && 'lu-code--ok', err && 'lu-code--error')}>
      <label className="lu-code__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="lu-code__input"
        value={v}
        readOnly={readOnly}
        placeholder="PASEO-7K2Q"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          const n = formatCode(e.target.value);
          setV(n);
          onChange?.(n);
        }}
      />
      <span className="lu-code__hint" aria-live="polite">
        {err ? error : ok ? hint || 'Código completo' : 'Una palabra, un guion y 4 letras o números'}
      </span>
    </div>
  );
}

/* ---------- Evidence ---------- */
export function Evidence({
  kind = 'foto',
  sender,
  time,
  group,
  file,
  pages,
  receipt,
  messages,
  box,
}: {
  kind?: 'foto' | 'pdf' | 'mensaje';
  sender: string;
  time: string;
  group?: string;
  file?: string;
  pages?: number;
  receipt?: { title: string; sub?: string; lines?: [string, string][]; total: string; foot?: string };
  messages?: { who: string; whoColor?: string; text: string; time: string; dim?: boolean; target?: boolean }[];
  box?: string;
}) {
  return (
    <figure className="lu-evi">
      <figcaption className="lu-evi__from">
        <Avatar name={sender} size="sm" />
        <span style={{ display: 'grid' }}>
          <b>{sender}</b>
          <span>
            {kind === 'foto' ? 'mandó una foto' : kind === 'pdf' ? 'mandó un PDF' : 'escribió'} · {time}
            {group ? ' · ' + group : ''}
          </span>
        </span>
      </figcaption>
      {kind === 'foto' && (
        <div className="lu-evi__photo">
          <div className="lu-evi__receipt">
            <b>{receipt?.title}</b>
            <div style={{ textAlign: 'center', opacity: 0.8 }}>{receipt?.sub}</div>
            <hr />
            {(receipt?.lines || []).map((l, i) => (
              <i key={i}>
                <span>{l[0]}</span>
                <span>{l[1]}</span>
              </i>
            ))}
            <hr />
            <i style={{ fontWeight: 700, fontSize: 10, position: 'relative' }}>
              <span>TOTAL</span>
              <span>{receipt?.total}</span>
              {box && (
                <span className="lu-evi__box" style={{ inset: '-3px -4px' }}>
                  <span>{box}</span>
                </span>
              )}
            </i>
            <div style={{ textAlign: 'center', marginTop: 10, opacity: 0.7 }}>{receipt?.foot}</div>
          </div>
        </div>
      )}
      {kind === 'pdf' && (
        <div className="lu-evi__pdf">
          <div className="lu-evi__page">
            <b>{receipt?.title}</b>
            <span>{receipt?.sub}</span>
            <div className="bar" style={{ width: '70%' }} />
            <div className="bar" style={{ width: '90%' }} />
            <div className="bar" style={{ width: '55%' }} />
            {(receipt?.lines || []).map((l, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{l[0]}</span>
                <span>{l[1]}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, position: 'relative', marginTop: 4 }}>
              <span>Total a pagar</span>
              <span>{receipt?.total}</span>
              {box && (
                <span className="lu-evi__box" style={{ inset: '-3px -4px' }}>
                  <span>{box}</span>
                </span>
              )}
            </div>
          </div>
          <div className="lu-evi__file">
            <span>{file}</span>
            <span className="lu-muted">{pages} pág.</span>
          </div>
        </div>
      )}
      {kind === 'mensaje' && (
        <div className="lu-evi__chat">
          {(messages || []).map((m, i) => (
            <div
              key={i}
              className={cx('lu-evi__msg', m.dim && 'lu-evi__msg--dim', m.target && 'lu-evi__msg--target')}
              style={{ '--c': `var(--${m.whoColor || 'morado'})` } as React.CSSProperties}
            >
              <span className="who">{m.who}</span>
              {m.text}
              <span className="t">{m.time}</span>
            </div>
          ))}
        </div>
      )}
    </figure>
  );
}

/* ---------- ConnectionStatus ---------- */
export function ConnectionStatus({
  state = 'esperando',
  children,
  sub,
}: {
  state?: 'esperando' | 'conectado' | 'error';
  children?: React.ReactNode;
  sub?: React.ReactNode;
}) {
  const txt = { esperando: 'Esperando el código en el grupo', conectado: 'Conectado', error: 'No pudimos conectar' }[state];
  return (
    <span className={cx('lu-conn', 'lu-conn--' + state)} role="status" aria-live="polite">
      <span className="lu-conn__dot" aria-hidden="true" />
      <span style={{ display: 'grid' }}>
        {children || txt}
        {sub && <span className="lu-conn__sub">{sub}</span>}
      </span>
    </span>
  );
}

/* ---------- Logo ---------- */
export function Logo({ size = 24 }: { size?: number }) {
  // La versión plana del logo (a este tamaño el grabado es ruido); los colores van en app.css
  const alto = Math.round(size * 1.35);
  return (
    <span className="lu-logo">
      <svg className="lu-logo__svg" viewBox="0 0 610 200" role="img" aria-label="luks" style={{ height: alto, width: Math.round((alto * 610) / 200) }}>
        <path d="M58 14 C36 12 22 30 23 56 L27 140 C28 162 44 176 64 174 C80 172 90 160 90 140 L92 70 C92 38 80 16 58 14 Z" className="lu-logo__v" />
        <path
          d="M26 156 C30 132 58 124 86 130 C108 135 124 120 146 106 C168 94 194 108 193 138 C192 170 168 189 134 189 L64 189 C38 189 22 176 26 156 Z"
          className="lu-logo__m"
        />
        <circle cx="128" cy="70" r="23" className="lu-logo__a" />
        <path
          transform="translate(226 186) scale(0.192 -0.192)"
          d="M233 -9.5Q191.5 -9.5 160.0 -5.0Q128.5 -0.5 106.25 11.5Q84 23.5 69.875 44.875Q55.75 66.25 49.125 99.625Q42.5 133 42.5 181.5V643.75Q42.5 664 46.125 681.0Q49.75 698 65.625 708.875Q81.5 719.75 117.75 719.75Q154.25 719.75 169.75 709.0Q185.25 698.25 189.0 681.0Q192.75 663.75 192.75 643.75V189.25Q192.75 172.5 194.375 162.0Q196 151.5 200.5 145.625Q205 139.75 213.0 138.0Q221 136.25 233.5 136.25Q246.25 136.25 258.75 133.0Q271.25 129.75 279.875 115.0Q288.5 100.25 288.5 65.25Q288.5 28.75 279.875 12.875Q271.25 -3 258.375 -6.25Q245.5 -9.5 233 -9.5Z"
          className="lu-logo__v"
        />
        <path
          transform="translate(290.8 186) scale(0.192 -0.192)"
          d="M256.25 -8.25Q209.5 -8.25 169.375 9.625Q129.25 27.5 99.25 60.25Q69.25 93 52.75 137.375Q36.25 181.75 36.25 235V416Q36.25 436 39.875 453.0Q43.5 470 59.375 480.75Q75.25 491.5 111.5 491.5Q148.75 491.5 164.25 480.625Q179.75 469.75 183.375 452.375Q187 435 187 415V234.75Q187 205.5 197.375 184.375Q207.75 163.25 228.125 151.875Q248.5 140.5 277 140.5Q305.75 140.5 326.5 152.25Q347.25 164 358.75 185.125Q370.25 206.25 370.25 234.75V416.75Q370.25 436.75 373.875 453.75Q377.5 470.75 393.375 481.125Q409.25 491.5 445.75 491.5Q482.75 491.5 498.125 480.625Q513.5 469.75 517.125 452.375Q520.75 435 520.75 415.75V64Q520.75 45.25 517.125 28.75Q513.5 12.25 497.75 1.875Q482 -8.5 445.5 -8.5Q419 -8.5 403.875 -2.5Q388.75 3.5 382.0 12.875Q375.25 22.25 373.75 32.125Q372.25 42 372.25 49.75L385 60.75Q381.75 56.5 371.75 45.5Q361.75 34.5 345.25 22.0Q328.75 9.5 306.625 0.625Q284.5 -8.25 256.25 -8.25Z"
          className="lu-logo__v"
        />
        <path
          transform="translate(405.3 186) scale(0.192 -0.192)"
          d="M453.5 126.75Q484.75 99.5 486.875 75.25Q489 51 459.75 19.25Q437.75 -4 421.5 -11.25Q405.25 -18.5 389.25 -11.625Q373.25 -4.75 351.5 14.25L194.25 152.25V65.5Q194.25 46.25 190.5 28.875Q186.75 11.5 171.375 1.0Q156 -9.5 118.75 -9.5Q82.5 -9.5 66.625 1.375Q50.75 12.25 47.5 29.75Q44.25 47.25 44.25 66.5V643.5Q44.25 663.5 48.0 680.5Q51.75 697.5 67.625 708.375Q83.5 719.25 119.75 719.25Q156.25 719.25 171.625 708.375Q187 697.5 190.625 680.125Q194.25 662.75 194.25 642.5V340.5L306 448.75Q325.75 467.75 343.25 474.875Q360.75 482 377.875 476.0Q395 470 414 449Q446 414.25 444.75 392.5Q443.5 370.75 413.5 341L305.5 242.75Z"
          className="lu-logo__m"
        />
        <path
          transform="translate(509.1 186) scale(0.192 -0.192)"
          d="M220.75 -17Q194 -17 162.25 -11.0Q130.5 -5 100.75 6.5Q71 18 50.75 33.625Q30.5 49.25 27.75 69.25Q26 79.25 28.625 90.375Q31.25 101.5 37.875 114.25Q44.5 127 55.25 141Q63.25 151.5 72.875 154.75Q82.5 158 96.25 153.75Q112 151.25 128.25 143.5Q144.5 135.75 161.25 127.125Q178 118.5 195.875 112.125Q213.75 105.75 233 105.75Q261 105.75 276.625 114.125Q292.25 122.5 292.25 137.75Q292.25 148.5 285.625 155.875Q279 163.25 267.375 168.375Q255.75 173.5 240.625 177.625Q225.5 181.75 208.125 186.125Q190.75 190.5 172.5 196.25Q148.25 203.25 124.875 214.0Q101.5 224.75 82.875 242.25Q64.25 259.75 53.0 285.25Q41.75 310.75 41.75 348.25Q41.75 396.75 64.625 430.0Q87.5 463.25 131.5 480.75Q175.5 498.25 238.75 498.25Q257.25 498.25 275.0 495.875Q292.75 493.5 310.25 488.75Q327.75 484 344.75 476.75Q361.75 469.5 378.5 460.25Q409.25 445.5 410.25 421.875Q411.25 398.25 392.75 372.5Q381.5 355.75 369.625 348.25Q357.75 340.75 345.25 343.5Q329.25 347.5 310.625 356.625Q292 365.75 271.625 373.75Q251.25 381.75 230.5 381.75Q214.25 381.75 202.125 377.5Q190 373.25 183.875 365.5Q177.75 357.75 177.75 347.5Q177.75 335 185.5 327.25Q193.25 319.5 206.125 314.5Q219 309.5 236.125 305.75Q253.25 302 272.75 298.25Q299.75 293.25 328.125 284.5Q356.5 275.75 380.125 259.875Q403.75 244 418.25 216.75Q432.75 189.5 432.75 145.75Q432.75 67 377.75 25.0Q322.75 -17 220.75 -17Z"
          className="lu-logo__o"
        />
      </svg>
    </span>
  );
}

/* ---------- íconos de navegación (trazo, 24px) ---------- */
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
export const ICONS: Record<string, React.ReactNode> = {
  resumen: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path {...P} d="M5 20V11M12 20V5M19 20v-6" />
    </svg>
  ),
  revisar: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path {...P} d="M4 13l2.5-7h11L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path {...P} d="M4 13h4.5l1 2h5l1-2H20" />
    </svg>
  ),
  gastos: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path {...P} d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1.5" fill="currentColor" />
      <circle cx="4.5" cy="12" r="1.5" fill="currentColor" />
      <circle cx="4.5" cy="18" r="1.5" fill="currentColor" />
    </svg>
  ),
  liquidar: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path {...P} d="M4 8h14l-3-3M20 16H6l3 3" />
    </svg>
  ),
  personas: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle {...P} cx="9" cy="8" r="3.5" />
      <path {...P} d="M2.5 20c.8-3.5 3.3-5.5 6.5-5.5s5.7 2 6.5 5.5" />
      <path {...P} d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.7 3.1 2.4 3.5 5.2" />
    </svg>
  ),
  whatsapp: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path {...P} d="M4.5 20l1.2-3.6A8 8 0 1 1 8.7 19.2L4.5 20Z" />
      <path {...P} d="M9 9.5c.3 2.3 2.2 4.4 4.6 5l1.4-1.2-1.8-1.1-.9.7c-.9-.4-1.7-1.2-2-2.1l.7-.9L9.9 8.1 9 9.5Z" />
    </svg>
  ),
  presupuestos: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle {...P} cx="12" cy="12" r="8.5" />
      <path {...P} d="M12 3.5V12l6 6" />
    </svg>
  ),
};

/* ---------- AppShell ---------- */
export function AppShell({
  account,
  accountTone = 'verde',
  accountGlyph = 'L',
  tabs = [],
  active,
  onTab,
  children,
  onAccount,
  brand,
  barExtra,
}: {
  account?: string;
  accountTone?: Tone;
  accountGlyph?: string;
  /** railOnly: solo en el menú lateral (escritorio), no en las pestañas de abajo. dot: un punto de estado sobre el ícono */
  tabs?: { id: string; label: string; count?: number; icon?: string; railOnly?: boolean; dot?: 'ok' | 'warn' | 'off' }[];
  active?: string;
  onTab?: (id: string) => void;
  onAccount?: () => void;
  children?: React.ReactNode;
  /** Lo que va a la izquierda de la barra; por defecto el logo */
  brand?: React.ReactNode;
  /** Algo más en la barra de arriba, antes de la cuenta (p. ej. el estado de WhatsApp) */
  barExtra?: React.ReactNode;
}) {
  const tabEl = (t: (typeof tabs)[number]) => (
    // data-navega: lleva a otra pantalla; mientras carga se ve el giro (components/conexion.tsx)
    <button type="button" key={t.id} className="lu-tab" aria-current={t.id === active ? 'page' : undefined} data-navega="" onClick={() => onTab?.(t.id)}>
      {ICONS[t.icon || t.id]}
      <span>{t.label}</span>
      {t.count ? <span className="lu-tab__count">{t.count}</span> : null}
      {t.dot ? <span className={`lu-tab__dot lu-tab__dot--${t.dot}`} aria-hidden="true" /> : null}
    </button>
  );
  const railEls = tabs.map(tabEl);
  const tabEls = tabs.filter((t) => !t.railOnly).map(tabEl);
  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        {brand ?? <Logo />}
        {barExtra}
        {account && (
          <button type="button" className="lu-app__acct" data-navega="" onClick={onAccount} aria-label={`${account}: cambiar de cuenta`}>
            <span className="lu-cat__glyph" style={toneVars(accountTone)} aria-hidden="true">
              {accountGlyph}
            </span>
            <span>{account}</span>
            <span aria-hidden="true">▾</span>
          </button>
        )}
      </header>
      <div className="lu-app__body">
        {tabs.length > 0 && (
          <nav className="lu-app__rail" aria-label="Secciones">
            {railEls}
          </nav>
        )}
        <main className="lu-app__main">{children}</main>
      </div>
      {tabs.length > 0 && (
        <nav className="lu-tabs" aria-label="Secciones">
          {tabEls}
        </nav>
      )}
    </div>
  );
}
