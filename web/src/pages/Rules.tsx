import { useRef, useState, type KeyboardEvent } from 'react';
import { CheckCircle2, Link2, X } from 'lucide-react';
import { api } from '../lib/api';
import { parseUsdToCents } from '../lib/format';
import type { MandateInput, PublicMandate } from '../lib/types';

export const CATEGORY_SUGGESTIONS = [
  'Input Devices',
  'Office Supplies',
  'Computer Accessories',
  'Headphones',
  'Audio',
];

export interface RulesForm {
  goal: string;
  cap: string;
  budget: string;
  categories: string[];
  blocked: string[];
  maxOrders: string;
  threshold: number;
}

export type RulesErrors = Partial<Record<'goal' | 'cap' | 'budget' | 'maxOrders', string>>;

const centsToDollars = (c: number) => (c / 100).toFixed(2);

export function formFromMandate(m: PublicMandate | null | undefined): RulesForm {
  if (!m) {
    return { goal: '', cap: '', budget: '', categories: [], blocked: [], maxOrders: '3', threshold: 0.7 };
  }
  return {
    goal: m.goal,
    cap: centsToDollars(m.perOrderCapCents),
    budget: centsToDollars(m.monthlyBudgetCents),
    categories: m.allowedCategories,
    blocked: m.blockedMerchants,
    maxOrders: String(m.maxOrdersPerDay),
    threshold: m.reviewThreshold,
  };
}

export function validateRules(f: RulesForm): { errors: RulesErrors; values: MandateValuesOrNull } {
  const errors: RulesErrors = {};
  const goal = f.goal.trim();
  if (!goal) errors.goal = 'Tell Scout what you are shopping for.';
  const cap = parseUsdToCents(f.cap);
  const budget = parseUsdToCents(f.budget);
  if (f.cap.trim() === '') errors.cap = 'Enter a dollar amount.';
  else if (cap === null) errors.cap = 'Use dollars like 25 or 25.50.';
  else if (cap <= 0) errors.cap = 'Must be more than $0.';
  if (f.budget.trim() === '') errors.budget = 'Enter a dollar amount.';
  else if (budget === null) errors.budget = 'Use dollars like 200 or 200.50.';
  else if (budget <= 0) errors.budget = 'Must be more than $0.';
  if (!errors.cap && !errors.budget && cap !== null && budget !== null && cap > budget) {
    errors.cap = 'Per-order cap can’t be higher than the monthly budget.';
  }
  const orders = Number(f.maxOrders);
  if (!/^\d+$/.test(f.maxOrders.trim()) || !Number.isSafeInteger(orders) || orders < 1) {
    errors.maxOrders = 'Enter a whole number, 1 or more.';
  }
  if (Object.keys(errors).length > 0 || cap === null || budget === null) return { errors, values: null };
  return {
    errors,
    values: {
      goal,
      perOrderCapCents: cap,
      monthlyBudgetCents: budget,
      allowedCategories: f.categories,
      blockedMerchants: f.blocked,
      maxOrdersPerDay: orders,
      reviewThreshold: f.threshold,
    },
  };
}

type MandateValues = Pick<
  MandateInput,
  | 'goal'
  | 'perOrderCapCents'
  | 'monthlyBudgetCents'
  | 'allowedCategories'
  | 'blockedMerchants'
  | 'maxOrdersPerDay'
  | 'reviewThreshold'
>;
type MandateValuesOrNull = MandateValues | null;

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Only the fields that differ from the saved mandate (the gateway rejects empty patches). */
export function diffMandate(m: PublicMandate, v: MandateValues): Partial<MandateInput> {
  const p: Partial<MandateInput> = {};
  if (v.goal !== m.goal) p.goal = v.goal;
  if (v.perOrderCapCents !== m.perOrderCapCents) p.perOrderCapCents = v.perOrderCapCents;
  if (v.monthlyBudgetCents !== m.monthlyBudgetCents) p.monthlyBudgetCents = v.monthlyBudgetCents;
  if (!sameList(v.allowedCategories, m.allowedCategories)) p.allowedCategories = v.allowedCategories;
  if (!sameList(v.blockedMerchants, m.blockedMerchants)) p.blockedMerchants = v.blockedMerchants;
  if (v.maxOrdersPerDay !== m.maxOrdersPerDay) p.maxOrdersPerDay = v.maxOrdersPerDay;
  if (v.reviewThreshold !== m.reviewThreshold) p.reviewThreshold = v.reviewThreshold;
  return p;
}

function ChipInput({
  id, label, hint, values, onChange, suggestions,
}: {
  id: string;
  label: string;
  hint?: string;
  values: string[];
  onChange: (fn: (prev: string[]) => string[]) => void;
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState('');
  const hasIn = (list: string[], s: string) => list.some((v) => v.toLowerCase() === s.toLowerCase());
  const has = (s: string) => hasIn(values, s);
  function add(raw: string) {
    const s = raw.trim();
    if (s) onChange((prev) => (hasIn(prev, s) ? prev : [...prev, s]));
    setDraft('');
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && draft === '' && values.length) {
      onChange((prev) => prev.slice(0, -1));
    }
  }
  const open = (suggestions ?? []).filter((s) => !has(s));
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      <div className="chips">
        {values.map((v) => (
          <span className="tag" key={v}>
            {v}
            <button type="button" className="tag__x" aria-label={`Remove ${v}`} onClick={() => onChange((prev) => prev.filter((x) => x !== v))}>
              <X size={14} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          id={id}
          className="chips__input"
          value={draft}
          placeholder={values.length ? '' : 'Type and press Enter'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => add(draft)}
        />
      </div>
      {hint && <p className="field__hint">{hint}</p>}
      {open.length > 0 && (
        <div className="suggest" role="group" aria-label={`${label} suggestions`}>
          {open.map((s) => (
            <button type="button" key={s} className="suggest__btn" onClick={() => add(s)}>+ {s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  mandate?: PublicMandate | null;
  creating?: boolean;
  onSaved?: (m: PublicMandate, kind: 'created' | 'updated') => void;
  onConnect?: () => void;
  connecting?: boolean;
}

export default function Rules({ mandate = null, creating, onSaved, onConnect, connecting }: Props) {
  const editing = !creating && mandate !== null;
  const [form, setForm] = useState<RulesForm>(() => formFromMandate(editing ? mandate : null));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const [created, setCreated] = useState(false);
  const inFlight = useRef(false);

  if (!creating && mandate === null) return null;

  const { errors, values } = validateRules(form);
  const patch = editing && values ? diffMandate(mandate, values) : null;
  const unchanged = patch !== null && Object.keys(patch).length === 0;
  const canSubmit = values !== null && !saving && !created && !unchanged;
  const set = <K extends keyof RulesForm>(k: K, v: RulesForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setServerError(null);
    setSavedNote(false);
  };
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));
  const err = (k: keyof RulesErrors) => (touched[k] ? errors[k] : undefined);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!values || saving || created || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setServerError(null);
    try {
      if (editing) {
        const saved = await api.updateMandate(mandate.id, diffMandate(mandate, values));
        setSavedNote(true);
        onSaved?.(saved, 'updated');
      } else {
        const saved = await api.createMandate({ ...values, currency: 'USD', allowedMerchants: null });
        setCreated(true);
        onSaved?.(saved, 'created');
      }
    } catch (ex) {
      setServerError(ex instanceof Error && ex.message ? ex.message : 'Could not save your rules.');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  const pct = Math.round(form.threshold * 100);
  const fieldProps = (k: keyof RulesErrors) => ({
    'aria-invalid': err(k) ? (true as const) : undefined,
    'aria-describedby': err(k) ? `${k}-err` : undefined,
    onBlur: () => touch(k),
  });

  return (
    <div className="rules">
      <form className="rules__form" onSubmit={submit} noValidate>
        <section className="card">
          <h2 className="card__title">{editing ? 'Spending rules' : 'Set up your spending rules'}</h2>
          <p className="card__sub">
            {editing ? 'Change what Scout is allowed to buy for you.' : 'Tell Scout what to shop for and how much it may spend.'}
          </p>
          <div className="field">
            <label className="field__label" htmlFor="rules-goal">Goal</label>
            <textarea
              id="rules-goal"
              rows={3}
              value={form.goal}
              placeholder="e.g. Buy desk accessories for my home office"
              onChange={(e) => set('goal', e.target.value)}
              {...fieldProps('goal')}
            />
            {err('goal') && <p id="goal-err" className="field__error" aria-live="polite">{err('goal')}</p>}
          </div>
          <div className="grid2">
            <div className="field">
              <label className="field__label" htmlFor="rules-cap">Per-order cap ($)</label>
              <input id="rules-cap" inputMode="decimal" value={form.cap} placeholder="50.00"
                onChange={(e) => set('cap', e.target.value)} {...fieldProps('cap')} />
              {err('cap') && <p id="cap-err" className="field__error" aria-live="polite">{err('cap')}</p>}
            </div>
            <div className="field">
              <label className="field__label" htmlFor="rules-budget">Monthly budget ($)</label>
              <input id="rules-budget" inputMode="decimal" value={form.budget} placeholder="200.00"
                onChange={(e) => set('budget', e.target.value)} {...fieldProps('budget')} />
              {err('budget') && <p id="budget-err" className="field__error" aria-live="polite">{err('budget')}</p>}
            </div>
          </div>
        </section>

        <section className="card">
          <h2 className="card__title">Where Scout may shop</h2>
          <ChipInput
            id="rules-categories"
            label="Allowed categories"
            hint="Leave empty to allow any category."
            values={form.categories}
            onChange={(fn) => setForm((f) => ({ ...f, categories: fn(f.categories) }))}
            suggestions={CATEGORY_SUGGESTIONS}
          />
          <ChipInput
            id="rules-blocked"
            label="Blocked merchants"
            hint="Scout will never buy from these."
            values={form.blocked}
            onChange={(fn) => setForm((f) => ({ ...f, blocked: fn(f.blocked) }))}
          />
        </section>

        <section className="card">
          <h2 className="card__title">Safety checks</h2>
          <div className="field">
            <label className="field__label" htmlFor="rules-orders">Max orders per day</label>
            <input id="rules-orders" className="narrow" inputMode="numeric" value={form.maxOrders}
              onChange={(e) => set('maxOrders', e.target.value)} {...fieldProps('maxOrders')} />
            {err('maxOrders') && <p id="maxOrders-err" className="field__error" aria-live="polite">{err('maxOrders')}</p>}
          </div>
          <div className="field">
            <label className="field__label" htmlFor="rules-threshold">Review threshold</label>
            <input
              id="rules-threshold"
              className="slider"
              type="range"
              min={0.5}
              max={0.95}
              step={0.05}
              value={Math.min(0.95, Math.max(0.5, form.threshold))}
              onChange={(e) => set('threshold', Math.round(Number(e.target.value) * 100) / 100)}
              aria-valuetext={`${pct}%`}
            />
            <p className="slider__label">Ask me when the AI is less than <strong>{pct}%</strong> sure</p>
          </div>
        </section>

        {serverError && <p role="alert" className="notice">{serverError}</p>}
        <div className="rules__actions">
          <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create spending rules'}
          </button>
          {savedNote && !saving && unchanged && (
            <span className="saved" role="status"><CheckCircle2 size={16} aria-hidden="true" /> Saved</span>
          )}
        </div>
        <p className="rules__note">These limits are enforced by the gateway. The AI can make a decision stricter, never looser.</p>
      </form>

      {editing && (
        <aside className="card rules__connect" aria-label="PayPal connection">
          <h2 className="card__title">PayPal</h2>
          {mandate.connected ? (
            <div className="connected">
              <span className="connected__row"><CheckCircle2 size={18} aria-hidden="true" /> PayPal connected</span>
              <button type="button" className="btn btn--secondary" onClick={onConnect} disabled={connecting}>Reconnect</button>
            </div>
          ) : (
            <>
              <p className="card__sub">Link a PayPal sandbox account so approved orders can be paid.</p>
              <button type="button" className="btn btn--primary" onClick={onConnect} disabled={connecting}>
                <Link2 size={16} aria-hidden="true" /> Connect PayPal
              </button>
            </>
          )}
        </aside>
      )}
    </div>
  );
}
