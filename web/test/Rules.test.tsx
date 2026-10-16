import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Rules, { validateRules, diffMandate, formFromMandate } from '../src/pages/Rules';
import { api, ApiError } from '../src/lib/api';
import type { PublicMandate } from '../src/lib/types';

const mandate: PublicMandate = {
  id: 'm1', goal: 'Desk stuff', currency: 'USD', perOrderCapCents: 5000, monthlyBudgetCents: 20000,
  allowedCategories: ['Audio'], allowedMerchants: null, blockedMerchants: [], maxOrdersPerDay: 3,
  reviewThreshold: 0.7, connected: false,
};
const base = { ...formFromMandate(mandate) };

describe('validateRules', () => {
  it('accepts the saved mandate', () => {
    expect(validateRules(base).values).not.toBeNull();
  });
  it.each(['abc', '1.234', '-5', '', '1e3'])('rejects bad dollar string %j', (bad) => {
    const r = validateRules({ ...base, cap: bad });
    expect(r.errors.cap).toBeTruthy();
    expect(r.values).toBeNull();
  });
  it('rejects zero cap and zero budget', () => {
    expect(validateRules({ ...base, cap: '0' }).errors.cap).toBeTruthy();
    expect(validateRules({ ...base, budget: '0.00' }).errors.budget).toBeTruthy();
  });
  it('rejects cap above budget', () => {
    const r = validateRules({ ...base, cap: '300', budget: '200' });
    expect(r.errors.cap).toMatch(/budget/);
    expect(r.values).toBeNull();
  });
  it('rejects empty goal and bad max orders', () => {
    expect(validateRules({ ...base, goal: '   ' }).errors.goal).toBeTruthy();
    expect(validateRules({ ...base, maxOrders: '0' }).errors.maxOrders).toBeTruthy();
  });
});

describe('diffMandate', () => {
  it('includes only changed fields', () => {
    const v = validateRules({ ...base, cap: '40', threshold: 0.8 }).values!;
    expect(diffMandate(mandate, v)).toEqual({ perOrderCapCents: 4000, reviewThreshold: 0.8 });
  });
  it('is empty when nothing changed', () => {
    expect(diffMandate(mandate, validateRules(base).values!)).toEqual({});
  });
});

describe('Rules page', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('create: submit disabled until valid, then posts and calls onSaved', async () => {
    const created = { ...mandate, id: 'new' };
    const spy = vi.spyOn(api, 'createMandate').mockResolvedValue(created);
    const onSaved = vi.fn();
    render(<Rules creating onSaved={onSaved} />);
    const submit = screen.getByRole('button', { name: 'Create spending rules' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Goal'), 'Gifts');
    await userEvent.type(screen.getByLabelText('Per-order cap ($)'), '300');
    await userEvent.type(screen.getByLabelText('Monthly budget ($)'), '200');
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/can’t be higher/)).toBeTruthy();
    await userEvent.clear(screen.getByLabelText('Per-order cap ($)'));
    await userEvent.type(screen.getByLabelText('Per-order cap ($)'), '50');
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(submit);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created, 'created'));
    expect(spy.mock.calls[0][0]).toMatchObject({ perOrderCapCents: 5000, monthlyBudgetCents: 20000, allowedMerchants: null });
  });

  it('edit: PATCH sends only changed fields and shows server errors', async () => {
    const spy = vi.spyOn(api, 'updateMandate').mockRejectedValueOnce(new ApiError(400, 'perOrderCapCents must not exceed monthlyBudgetCents'));
    render(<Rules mandate={mandate} />);
    const save = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const cap = screen.getByLabelText('Per-order cap ($)');
    await userEvent.clear(cap);
    await userEvent.type(cap, '75');
    await userEvent.click(save);
    expect(spy).toHaveBeenCalledWith('m1', { perOrderCapCents: 7500 });
    expect((await screen.findByRole('alert')).textContent).toMatch(/more than the monthly budget/);
  });

  it('chips add on Enter and remove with the x button; slider label is live', async () => {
    render(<Rules creating />);
    const blocked = screen.getByLabelText('Blocked merchants');
    await userEvent.type(blocked, 'shady.com{Enter}');
    expect(screen.getByText('shady.com')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Remove shady.com' }));
    expect(screen.queryByText('shady.com')).toBeNull();
    expect(screen.getByText(/less than/).textContent).toContain('70%');
  });

  it('shows Reconnect when connected', () => {
    render(<Rules mandate={{ ...mandate, connected: true }} />);
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeTruthy();
  });

  it('Reconnect calls onConnect', async () => {
    const onConnect = vi.fn();
    render(<Rules mandate={{ ...mandate, connected: true }} onConnect={onConnect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('chips dedupe case-insensitively and trim whitespace', async () => {
    render(<Rules creating />);
    const blocked = screen.getByLabelText('Blocked merchants');
    await userEvent.type(blocked, '  Shady.com  {Enter}');
    await userEvent.type(blocked, 'SHADY.COM{Enter}');
    expect(screen.getAllByText('Shady.com')).toHaveLength(1);
    expect(screen.queryByText('SHADY.COM')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(1);
  });

  it('clicking a suggestion keeps the typed draft as a chip', async () => {
    render(<Rules creating />);
    const cats = screen.getByLabelText('Allowed categories');
    await userEvent.type(cats, 'Toys');
    await userEvent.click(screen.getByRole('button', { name: '+ Audio' }));
    expect(screen.getByText('Toys')).toBeTruthy();
    expect(screen.getByText('Audio')).toBeTruthy();
  });

  it('create: a second save after success does not create a duplicate', async () => {
    let release: (m: PublicMandate) => void = () => {};
    const spy = vi.spyOn(api, 'createMandate').mockImplementation(
      () => new Promise((r) => { release = r; }),
    );
    const onSaved = vi.fn();
    render(<Rules creating onSaved={onSaved} />);
    await userEvent.type(screen.getByLabelText('Goal'), 'Gifts');
    await userEvent.type(screen.getByLabelText('Per-order cap ($)'), '50');
    await userEvent.type(screen.getByLabelText('Monthly budget ($)'), '200');
    const submit = screen.getByRole('button', { name: 'Create spending rules' });
    await userEvent.click(submit);
    await userEvent.click(screen.getByRole('button', { name: 'Saving…' }));
    await act(async () => { release({ ...mandate, id: 'new' }); });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'Create spending rules' }));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('uses spending-rules copy and accessible group/live regions', async () => {
    render(<Rules creating />);
    expect(screen.getByRole('heading', { name: 'Set up your spending rules' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Allowed categories suggestions' })).toBeTruthy();
    await userEvent.click(screen.getByLabelText('Goal'));
    await userEvent.tab();
    expect(screen.getByText('Tell Scout what you are shopping for.').getAttribute('aria-live')).toBe('polite');
  });
});
