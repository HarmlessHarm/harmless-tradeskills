import { useEffect, useId, useState, type ReactNode } from 'react';
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
 * Pick an item from the catalog by name, or type an ID (a missing ID is imported on demand).
 */
export function ItemPicker({
  value,
  onChange,
  filter,
  placeholder = 'Item name or ID',
}: {
  value: number | null;
  onChange: (id: number | null) => void;
  filter?: (item: Item) => boolean;
  placeholder?: string;
}) {
  const { engine, mutateAsync } = useStore();
  const listId = useId();
  const label = (id: number | null) => {
    if (id === null) return '';
    const it = engine.items.get(id);
    return it ? `${it.name} #${id}` : `#${id}`;
  };
  const [text, setText] = useState(label(value));
  useEffect(() => setText(label(value)), [value, engine.items]); // eslint-disable-line react-hooks/exhaustive-deps
  const options = [...engine.items.values()].filter((i) => !filter || filter(i)).sort((a, b) => a.name.localeCompare(b.name));
  const commit = () => {
    const t = text.trim();
    if (!t) return value !== null && onChange(null);
    const idMatch = /#?(\d+)\s*$/.exec(t);
    let id: number | null = idMatch ? Number(idMatch[1]) : null;
    if (id === null) id = options.find((o) => o.name.toLowerCase() === t.toLowerCase())?.id ?? null;
    if (id === null) return setText(label(value));
    if (id !== value) onChange(id);
    setText(label(id));
    // First reference to an unknown ID imports it (REQ-1.2). Failures leave an import button on the name.
    if (!engine.items.has(id)) void mutateAsync((repo) => importItem(repo, id!)).catch(() => {});
  };
  return (
    <>
      <input
        className="item-picker"
        list={listId}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o.id} value={`${o.name} #${o.id}`} />
        ))}
      </datalist>
    </>
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
