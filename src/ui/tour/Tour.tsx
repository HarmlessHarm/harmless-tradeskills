import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Onboarding, TourId } from '../../db/repo';
import type { Workflow } from '../../engine/types';
import { useStore } from '../../state/store';
import { TOURS, type TourCtx, type TourStep } from './tours';

/**
 * Guided tours (onboarding). A tour is a list of steps; each step points at an element marked with
 * `data-tour="..."` and moves on by itself once the user has done what it asks, or on Next. The
 * bubble never blocks the page: the user clicks the real controls. Progress lives in personal data.
 */

interface TourValue {
  onboarding: Onboarding;
  start: (tour: TourId) => void;
  /** Ends the active tour; `done` marks it finished, otherwise skipped. `then` skips or starts another tour. */
  end: (done: boolean, then?: { start?: TourId; skip?: TourId }) => void;
  skip: (tour: TourId) => void;
}

const TourContext = createContext<TourValue | null>(null);

export const useTour = () => {
  const v = useContext(TourContext);
  if (!v) throw new Error('useTour outside TourProvider');
  return v;
};

const tab = () => window.location.hash.slice(1).split('/')[0];
export const tourEl = (target: string) => document.querySelector<HTMLElement>(`[data-tour="${target}"]`);

export function TourProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const { onboarding, workflows, mutate } = store;
  const save = useCallback((next: Onboarding) => mutate((repo) => repo.saveOnboarding(next)), [mutate]);
  const begin = (tour: TourId): Onboarding['active'] => ({ tour, step: 0, afterId: Math.max(0, ...workflows.map((w) => w.id)), workflowId: null });

  const value = useMemo<TourValue>(
    () => ({
      onboarding,
      start: (tour) => {
        save({ ...onboarding, active: begin(tour) });
        window.location.hash = TOURS[tour][0].page;
      },
      end: (done, then = {}) => {
        const a = onboarding.active;
        if (!a) return;
        const tours = { ...onboarding.tours, [a.tour]: done ? 'done' : 'skipped' };
        if (then.skip) tours[then.skip] = 'skipped';
        save({ tours, active: then.start ? begin(then.start) : null });
        if (then.start) window.location.hash = TOURS[then.start][0].page;
      },
      skip: (tour) => save({ tours: { ...onboarding.tours, [tour]: 'skipped' }, active: onboarding.active?.tour === tour ? null : onboarding.active }),
    }),
    [onboarding, workflows, save], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      {onboarding.active && <TourRunner />}
    </TourContext.Provider>
  );
}

/** Evaluates the active step every few hundred ms (DOM state such as an opened row has no event) and shows the bubble. */
function TourRunner() {
  const store = useStore();
  const tour = useTour();
  const active = store.onboarding.active!;
  const steps = TOURS[active.tour];
  const wf: Workflow | undefined = store.workflows.find((w) => w.id === active.workflowId);
  const ctx: TourCtx = { store, wf, tour, el: (t) => tourEl(t) !== null };
  const step: TourStep | undefined = steps[active.step];
  const [, tick] = useState(0);

  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  /** Step reached with Back: it waits for Next, even when what it asks is already done. */
  const [reviewing, setReviewing] = useState<string | null>(null);
  const reviewingRef = useRef<string | null>(null);
  /**
   * Moves to a step. Steps whose `skip` holds are passed over right here, in the direction of travel
   * (`dir`), so `skip` is only ever checked on arrival: doing part of a step never skips the rest.
   */
  const go = useCallback((to: number, patch: Partial<NonNullable<Onboarding['active']>> = {}, dir: 1 | -1 | 0 = 1) => {
    const c = ctxRef.current;
    const a = c.store.onboarding.active!;
    const list = TOURS[a.tour];
    let step = to;
    while (dir !== 0 && step > 0 && step < list.length && list[step].skip?.(c)) step += dir;
    const key = dir < 0 ? `${a.tour}-${step}` : null;
    reviewingRef.current = key;
    setReviewing(key);
    c.store.mutate((repo) => repo.saveOnboarding({ ...c.store.onboarding, active: { ...a, ...patch, step } }));
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const c = ctxRef.current;
      const a = c.store.onboarding.active!;
      const st = TOURS[a.tour][a.step];
      if (!st) return;
      // Workflow tour: remember the workflow made after the tour started; start over if it is deleted.
      if (a.tour === 'workflow') {
        const made = c.store.workflows.filter((w) => w.id > a.afterId).sort((x, y) => y.id - x.id)[0];
        if (a.workflowId === null && made) return go(a.step, { workflowId: made.id }, 0);
        if (a.workflowId !== null && !c.wf) return go(0, { workflowId: null }, 0);
      }
      if (st.done?.(c) && reviewingRef.current !== `${a.tour}-${a.step}`) go(a.step + 1);
      else tick((n) => n + 1);
    }, 300);
    return () => clearInterval(id);
  }, [go]);

  if (!step) return null;
  const target = typeof step.target === 'function' ? step.target(ctx) : step.target;
  return (
    <Bubble
      key={`${active.tour}-${active.step}`}
      step={step}
      target={target}
      ctx={ctx}
      index={active.step}
      count={steps.length}
      reviewing={reviewing === `${active.tour}-${active.step}`}
      onNext={() => go(active.step + 1)}
      onBack={
        active.step > 0
          ? () => go(Math.max(0, active.step - 1), {}, -1)
          : undefined
      }
      onClose={() => tour.end(false)}
    />
  );
}

interface Box {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

const sameRect = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

function union(first: Box, rest: Box[]): Box {
  const all = [first, ...rest];
  const top = Math.min(...all.map((r) => r.top));
  const left = Math.min(...all.map((r) => r.left));
  const right = Math.max(...all.map((r) => r.right));
  const bottom = Math.max(...all.map((r) => r.bottom));
  return { top, left, right, bottom, width: right - left, height: bottom - top };
}

const GAP = 12;
const PAD = 6;

function Bubble({
  step,
  target,
  ctx,
  index,
  count,
  reviewing,
  onNext,
  onBack,
  onClose,
}: {
  step: TourStep;
  /** Reached with Back: show Next even on a step that moves on by itself. */
  reviewing: boolean;
  target: string | null;
  ctx: TourCtx;
  index: number;
  count: number;
  onNext: () => void;
  onBack?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Box | null>(null);
  /** The target plus any open dropdown in it: the bubble is placed outside this. */
  const [avoid, setAvoid] = useState<Box | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const scrolled = useRef(false);
  const onPage = tab() === step.page;
  const found = target && onPage ? tourEl(target) : null;

  // Re-measure every frame the target is shown: layouts shift as data loads and rows open.
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      const el = target && tab() === step.page ? tourEl(target) : null;
      if (el && !scrolled.current) {
        scrolled.current = true;
        const r = el.getBoundingClientRect();
        if (r.top < 60 || r.bottom > window.innerHeight - 40) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      const r = el?.getBoundingClientRect() ?? null;
      setRect((old) => (sameRect(old, r) ? old : r));
      // Open dropdowns inside the target (search results) are part of what the bubble must not cover.
      const lists = el ? [...el.querySelectorAll<HTMLElement>('.combo-list')].map((l) => l.getBoundingClientRect()) : [];
      const a = r && lists.length ? union(r, lists) : r;
      setAvoid((old) => (sameRect(old, a) ? old : a));
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [target, step.page]);

  useLayoutEffect(() => {
    const b = ref.current;
    if (!b || !avoid) return setPos(null);
    const bw = b.offsetWidth;
    const bh = b.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampTop = (t: number) => Math.max(8, Math.min(t, vh - bh - 8));
    const clampLeft = (l: number) => Math.max(8, Math.min(l, vw - bw - 8));
    // Below, above, right, left of what to avoid; else below the target itself, over the rest.
    if (avoid.bottom + GAP + bh <= vh) setPos({ top: avoid.bottom + GAP, left: clampLeft(avoid.left) });
    else if (avoid.top - GAP - bh >= 0) setPos({ top: avoid.top - GAP - bh, left: clampLeft(avoid.left) });
    else if (avoid.right + GAP + bw <= vw) setPos({ top: clampTop(avoid.top), left: avoid.right + GAP });
    else if (avoid.left - GAP - bw >= 0) setPos({ top: clampTop(avoid.top), left: avoid.left - GAP - bw });
    else setPos({ top: clampTop(rect!.bottom + GAP), left: clampLeft(rect!.left) });
  }, [avoid, rect]);

  const body = typeof step.body === 'function' ? step.body(ctx) : step.body;
  const auto = step.done !== undefined;
  const docked = !found || !pos;
  const pageHref = step.page === 'workflows' && ctx.wf ? `#workflows/${ctx.wf.id}` : `#${step.page}`;

  return (
    <>
      {found && rect && (
        <div
          className="tour-ring"
          aria-hidden
          style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
        />
      )}
      <div
        ref={ref}
        className={`tour-bubble ${docked ? 'docked' : ''} ${target === null ? 'center' : ''}`}
        style={docked ? undefined : { top: pos!.top, left: pos!.left }}
        role="dialog"
        aria-label={step.title}
      >
        <div className="tour-head">
          <span className="tour-count small muted">
            {index + 1} of {count}
          </span>
          <button className="icon-btn" onClick={onClose} aria-label="Close the tour" title="Close the tour">
            ×
          </button>
        </div>
        <h4>{step.title}</h4>
        {!onPage && target !== null ? (
          <p className="small">
            This step is on another page. <a href={pageHref}>Take me there</a>
          </p>
        ) : (
          <div className="tour-body small">{body}</div>
        )}
        <div className="tour-actions">
          {onBack && (
            <button className="link-btn small" onClick={onBack}>
              Back
            </button>
          )}
          <span className="grow" />
          {step.actions ? (
            step.actions(ctx)
          ) : step.next || (auto && reviewing) ? (
            <button className={auto && !reviewing ? '' : 'primary'} onClick={onNext}>
              {reviewing ? 'Next' : step.next}
            </button>
          ) : auto ? (
            <span className="small muted">Do it to continue</span>
          ) : null}
        </div>
      </div>
    </>
  );
}
