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
  const go = useCallback(
    (to: number, patch: Partial<NonNullable<Onboarding['active']>> = {}) => {
      const { store: s } = ctxRef.current;
      const a = s.onboarding.active!;
      s.mutate((repo) => repo.saveOnboarding({ ...s.onboarding, active: { ...a, ...patch, step: to } }));
    },
    [],
  );

  useEffect(() => {
    const id = setInterval(() => {
      const c = ctxRef.current;
      const a = c.store.onboarding.active!;
      const st = TOURS[a.tour][a.step];
      if (!st) return;
      // Workflow tour: remember the workflow made after the tour started; start over if it is deleted.
      if (a.tour === 'workflow') {
        const made = c.store.workflows.filter((w) => w.id > a.afterId).sort((x, y) => y.id - x.id)[0];
        if (a.workflowId === null && made) return go(a.step, { workflowId: made.id });
        if (a.workflowId !== null && !c.wf) return go(0, { workflowId: null });
      }
      if (st.skip?.(c) || st.done?.(c)) go(a.step + 1);
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
      onNext={() => go(active.step + 1)}
      onBack={active.step > 0 ? () => go(Math.max(0, active.step - 1)) : undefined}
      onClose={() => tour.end(false)}
    />
  );
}

const GAP = 12;
const PAD = 6;

function Bubble({
  step,
  target,
  ctx,
  index,
  count,
  onNext,
  onBack,
  onClose,
}: {
  step: TourStep;
  target: string | null;
  ctx: TourCtx;
  index: number;
  count: number;
  onNext: () => void;
  onBack?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
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
      setRect((old) => (old && r && old.top === r.top && old.left === r.left && old.width === r.width && old.height === r.height ? old : r));
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [target, step.page]);

  useLayoutEffect(() => {
    const b = ref.current;
    if (!b || !rect) return setPos(null);
    const bw = b.offsetWidth;
    const bh = b.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const below = rect.bottom + GAP + bh <= vh;
    const above = rect.top - GAP - bh >= 0;
    const top = below || !above ? Math.min(rect.bottom + GAP, vh - bh - 8) : rect.top - GAP - bh;
    const left = Math.max(8, Math.min(rect.left, vw - bw - 8));
    setPos({ top: Math.max(8, top), left });
  }, [rect]);

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
          ) : step.next ? (
            <button className={auto ? '' : 'primary'} onClick={onNext}>
              {step.next}
            </button>
          ) : auto ? (
            <span className="small muted">Do it to continue</span>
          ) : null}
        </div>
      </div>
    </>
  );
}
