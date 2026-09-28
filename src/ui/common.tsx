import { useEffect, useId, useMemo, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { anyItem } from '../engine/disenchant';
import { formatMoney, parseMoney, splitMoney } from '../engine/money';
import type { Copper, Item, PriceObservation } from '../engine/types';
import { useStore } from '../state/store';
import { importItem } from '../state/importer';
import { iconUrl, wowheadUrl } from '../wowhead/adapter';

export function Money({ value, signed = false }: { value: Copper | null | undefined; signed?: boolean }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="money muted">-</span>;
  const { negative, gold, silver, copper } = splitMoney(value);
  const cls = signed ? (value > 0.5 ? 'pos' : value < -0.5 ? 'neg' : '') : '';
  return (
    <span className={`money ${cls}`} title={formatMoney(value)}>
      {negative && '-'}
      {gold > 0 && <span className="g">{gold}</span>}
      {silver > 0 && <span className="s">{silver}</span>}
      {(copper > 0 || (gold === 0 && silver === 0)) && <span className="c">{copper}</span>}
    </span>
  );
}

/** Text input for money: "1g 2s 3c", "25s" or plain copper. Commits on blur or Enter. */
export function MoneyInput({
  value,
  onChange,
  placeholder = 'e.g. 1g 20s',
  allowEmpty = true,
  className = '',
}: {
  value: Copper | null;
  onChange: (v: Copper | null) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(value === null ? '' : formatMoney(value));
  const [bad, setBad] = useState(false);
  useEffect(() => setText(value === null ? '' : formatMoney(value)), [value]);
  const commit = () => {
    if (!text.trim()) {
      setBad(!allowEmpty);
      if (allowEmpty && value !== null) onChange(null);
      return;
    }
    const v = parseMoney(text);
    if (v === null) return setBad(true);
    setBad(false);
    setText(formatMoney(v));
    if (v !== value) onChange(v);
  };
  return (
    <input
      className={`money-input ${bad ? 'bad' : ''} ${className}`}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** Number input that commits on blur/Enter; empty means null. */
export function NumberInput({
  value,
  onChange,
  step,
  min,
  placeholder,
  className = '',
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number;
  min?: number;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => setText(value === null ? '' : String(value)), [value]);
  const commit = () => {
    const v = text.trim() === '' ? null : Number(text);
    if (v !== null && !Number.isFinite(v)) return setText(value === null ? '' : String(value));
    if (v !== value) onChange(v);
  };
  return (
    <input
      type="number"
      className={`num-input ${className}`}
      value={text}
      step={step}
      min={min}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function ItemIcon({ item }: { item: Item | undefined }) {
  if (!item?.icon) return <span className="icon icon-empty" />;
  return <img className="icon" src={iconUrl(item.icon)} alt="" loading="lazy" />;
}

/** Item name in its quality colour. Unknown items get an import button (lazy fetch, DEC-5). */
export function ItemName({ id, link = false }: { id: number; link?: boolean }) {
  const { engine, mutateAsync } = useStore();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const item = engine.items.get(id);
  const any = item ? null : anyItem(engine.deRules, id);
  if (any) {
    return (
      <span className="item-name">
        <span className="icon icon-empty" />
        <span className={`q${any.quality}`}>{any.name}</span>
      </span>
    );
  }
  if (!item) {
    return (
      <span className="item-name unknown">
        <span className="icon icon-empty" />#{id}{' '}
        <button
          className="link-btn"
          disabled={busy}
          title={err ?? 'Import from Wowhead'}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await mutateAsync((repo) => importItem(repo, id));
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'importing...' : err ? 'retry import' : 'import'}
        </button>
      </span>
    );
  }
  const name = <span className={`q${item.quality}`}>{item.name}</span>;
  return (
    <span className="item-name">
      <ItemIcon item={item} />
      {link ? (
        <a href={wowheadUrl('item', id)} target="_blank" rel="noreferrer">
          {name}
        </a>
      ) : (
        name
      )}
    </span>
  );
}

/**
 * Text input with a styled result list below it. Arrow keys move through the results, Enter or a
 * click picks one, Escape closes the list. Enter with nothing to pick calls `onCommit`.
 */
export function Combo<T>({
  text,
  onText,
  options,
  optionKey,
  renderOption,
  onPick,
  onCommit,
  onFocus,
  placeholder,
  disabled,
  className = '',
  empty = 'No matches.',
}: {
  text: string;
  onText: (t: string) => void;
  options: T[];
  optionKey: (o: T) => string | number;
  renderOption: (o: T) => ReactNode;
  onPick: (o: T) => void;
  /** Called on blur and on Enter when there is nothing to pick. */
  onCommit?: () => void;
  onFocus?: (e: FocusEvent<HTMLInputElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  empty?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const current = Math.min(active, options.length - 1);

  const move = (d: number) => {
    const next = Math.max(0, Math.min(options.length - 1, current + d));
    setActive(next);
    listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
  };
  const pick = (o: T) => {
    onPick(o);
    setOpen(false);
    setActive(0);
  };

  return (
    <div className={`combo ${className}`}>
      <input
        className="combo-input"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => {
          onText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={(e) => {
          setOpen(true);
          onFocus?.(e);
        }}
        onBlur={() => {
          setOpen(false);
          onCommit?.();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!open) setOpen(true);
            else move(1);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            move(-1);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (open && options[current] !== undefined) pick(options[current]);
            else onCommit?.();
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul className="combo-list" role="listbox" id={listId} ref={listRef}>
          {options.length === 0 && <li className="combo-empty muted small">{empty}</li>}
          {options.map((o, i) => (
            <li
              key={optionKey(o)}
              role="option"
              aria-selected={i === current}
              className={i === current ? 'on' : ''}
              onMouseEnter={() => setActive(i)}
              // mousedown, not click: it fires before the input's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
            >
              {renderOption(o)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ITEM_PICKER_LIMIT = 50;
const NONE: number[] = [];

/**
 * Pick an item from the catalog by name, or type an ID (a missing ID is imported on demand).
 */
export function ItemPicker({
  value,
  onChange,
  filter,
  placeholder = 'Item name or ID',
  preferred = NONE,
  preferredLabel,
}: {
  value: number | null;
  onChange: (id: number | null) => void;
  filter?: (item: Item) => boolean;
  placeholder?: string;
  /** Items listed first, in this order, with `preferredLabel` as their hint. */
  preferred?: number[];
  preferredLabel?: string;
}) {
  const { engine, mutateAsync } = useStore();
  const label = (id: number | null) => {
    if (id === null) return '';
    const it = engine.items.get(id);
    return it ? `${it.name} #${id}` : `#${id}`;
  };
  const [text, setText] = useState(label(value));
  useEffect(() => setText(label(value)), [value, engine.items]); // eslint-disable-line react-hooks/exhaustive-deps

  const typedId = /^#?(\d+)$/.exec(text.trim());
  const options = useMemo(() => {
    const rank = (id: number) => {
      const i = preferred.indexOf(id);
      return i < 0 ? preferred.length : i;
    };
    // The box still shows the current pick: list everything, so the list is useful on focus.
    const showAll = text === label(value);
    const terms = showAll ? [] : text.toLowerCase().split(/\s+/).filter(Boolean);
    return [...engine.items.values()]
      .filter((i) => !filter || filter(i))
      .filter((i) => (typedId && !showAll ? i.id === Number(typedId[1]) : terms.every((t) => `${i.name.toLowerCase()} #${i.id}`.includes(t))))
      .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name))
      .slice(0, ITEM_PICKER_LIMIT);
  }, [engine.items, filter, preferred, text, value]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (id: number | null) => {
    if (id !== value) onChange(id);
    setText(label(id));
    // First reference to an unknown ID imports it (REQ-1.2). Failures leave an import button on the name.
    if (id !== null && !engine.items.has(id)) void mutateAsync((repo) => importItem(repo, id)).catch(() => {});
  };
  const commit = () => {
    const t = text.trim();
    if (!t) return value !== null && onChange(null);
    const idMatch = /#?(\d+)\s*$/.exec(t);
    const id = idMatch ? Number(idMatch[1]) : (options.find((o) => o.name.toLowerCase() === t.toLowerCase())?.id ?? null);
    if (id === null) return setText(label(value));
    choose(id);
  };

  return (
    <Combo
      className="item-picker"
      text={text}
      onText={setText}
      options={options}
      optionKey={(i) => i.id}
      onPick={(i) => choose(i.id)}
      onCommit={commit}
      onFocus={(e) => e.target.select()}
      placeholder={placeholder}
      empty={typedId ? `Press Enter to import item #${typedId[1]}` : 'No item matches. Type an item ID to import it.'}
      renderOption={(i) => (
        <span className="combo-name">
          <ItemIcon item={i} />
          <span className={`q${i.quality}`}>{i.name}</span> <span className="muted small">#{i.id}</span>
          {preferredLabel && preferred.includes(i.id) && <span className="combo-tag small">{preferredLabel}</span>}
        </span>
      )}
    />
  );
}

export function ago(ts: number | null | undefined): string {
  if (!ts) return 'never';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Price age with a warning colour once it is a day old. */
export function PriceAge({ obs }: { obs: PriceObservation | undefined }) {
  if (!obs) return <span className="muted">no price</span>;
  const old = Date.now() - obs.observedAt > 86_400_000;
  return (
    <span className={old ? 'stale' : 'muted'} title={new Date(obs.observedAt).toLocaleString()}>
      {ago(obs.observedAt)}
    </span>
  );
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec)) return '-';
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtQty(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(n < 1 ? 3 : 2).replace(/0+$/, '').replace(/\.$/, '');
}

export function Panel({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
