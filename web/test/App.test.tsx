import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { api } from '../src/lib/api';

describe('App session gate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows an unreachable state with Retry on network errors, not Login', async () => {
    const spy = vi.spyOn(api, 'session').mockRejectedValueOnce(new TypeError('fetch failed'));
    render(<App />);
    expect(await screen.findByText("Can't reach the Leash server")).toBeTruthy();
    expect(screen.queryByLabelText('Passcode')).toBeNull();
    spy.mockResolvedValueOnce(false);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByLabelText('Passcode')).toBeTruthy();
  });

  it('activates the newest mandate (first in the list)', async () => {
    const mk = (id: string, goal: string) => ({
      id, goal, currency: 'USD' as const, perOrderCapCents: 1000, monthlyBudgetCents: 5000,
      allowedCategories: [], allowedMerchants: null, blockedMerchants: [], maxOrdersPerDay: 3,
      reviewThreshold: 0.8, connected: true,
    });
    vi.spyOn(api, 'session').mockResolvedValue(true);
    vi.spyOn(api, 'listMandates').mockResolvedValue([mk('new', 'Newest goal'), mk('old', 'Oldest goal')]);
    vi.spyOn(api, 'listProposals').mockResolvedValue([]);
    vi.stubGlobal('EventSource', class { onopen = null; onerror = null; addEventListener() {} removeEventListener() {} close() {} });
    render(<App />);
    expect((await screen.findAllByText('Newest goal')).length).toBeGreaterThan(0);
    const budget = screen.getByRole('region', { name: 'Monthly budget' });
    expect(budget.textContent).toContain('Newest goal');
    expect(budget.textContent).not.toContain('Oldest goal');
  });

  it('ignores late proposals from a mandate that is no longer active', async () => {
    const mk = (id: string, goal: string) => ({
      id, goal, currency: 'USD' as const, perOrderCapCents: 1000, monthlyBudgetCents: 5000,
      allowedCategories: [], allowedMerchants: null, blockedMerchants: [], maxOrdersPerDay: 3,
      reviewThreshold: 0.8, connected: true,
    });
    const pendingA = {
      id: 'p1', mandateId: 'a', status: 'pending_human' as const, reasons: [], intent: null, paypal: {},
      createdAt: '2026-01-01T00:00:00Z', committedAt: null,
      input: { title: 'Mouse', description: '', category: 'Input Devices', merchant: 'x', priceCents: 500, currency: 'USD', userRequest: 'r' },
    };
    let resolveA: (v: typeof pendingA[]) => void = () => {};
    vi.spyOn(api, 'session').mockResolvedValue(true);
    vi.spyOn(api, 'listMandates').mockResolvedValue([mk('a', 'Goal A'), mk('b', 'Goal B')]);
    vi.spyOn(api, 'listProposals').mockImplementation((id: string) =>
      id === 'a' ? new Promise((r) => { resolveA = r as typeof resolveA; }) : Promise.resolve([]));
    vi.stubGlobal('EventSource', class { onopen = null; onerror = null; addEventListener() {} removeEventListener() {} close() {} });
    render(<App />);
    const select = await screen.findByLabelText('Spending rules');
    await userEvent.selectOptions(select, 'b');
    await act(async () => { resolveA([pendingA]); });
    expect(screen.queryByLabelText('1 pending')).toBeNull();
  });


  const mandate = {
    id: 'm', goal: 'Goal M', currency: 'USD' as const, perOrderCapCents: 1000, monthlyBudgetCents: 5000,
    allowedCategories: [], allowedMerchants: null, blockedMerchants: [], maxOrdersPerDay: 3,
    reviewThreshold: 0.8, connected: true,
  };
  const proposal = (id: string) => ({
    id, mandateId: 'm', status: 'pending_human' as const, reasons: [], intent: null, paypal: {},
    createdAt: '2026-01-01T00:00:00Z', committedAt: null,
    input: { title: id, description: '', category: 'Input Devices', merchant: 'x', priceCents: 500, currency: 'USD', userRequest: 'r' },
  });
  type Listener = () => void;
  function stubEventSource() {
    const listeners: Record<string, Listener[]> = {};
    const inst: { onerror: null | (() => void) } = { onerror: null };
    vi.stubGlobal('EventSource', class {
      set onerror(f: () => void) { inst.onerror = f; }
      addEventListener(n: string, f: Listener) { (listeners[n] ??= []).push(f); }
      removeEventListener() {}
      close() {}
    });
    return { emit: (n: string) => (listeners[n] ?? []).forEach((f) => f()), error: () => inst.onerror?.() };
  }

  it('returns to Login with a notice when any call hits 401', async () => {
    vi.stubGlobal('EventSource', class { addEventListener() {} removeEventListener() {} close() {} });
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url === '/api/session'
        ? new Response('{}', { status: 200 })
        : new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })));
    render(<App />);
    expect(await screen.findByText('Your session expired — unlock again.')).toBeTruthy();
    expect(screen.getByLabelText('Passcode')).toBeTruthy();
  });

  it('returns to Login when the SSE stream errors and the session is gone', async () => {
    vi.spyOn(api, 'session').mockResolvedValueOnce(true).mockResolvedValue(false);
    vi.spyOn(api, 'listMandates').mockResolvedValue([mandate]);
    vi.spyOn(api, 'listProposals').mockResolvedValue([]);
    const es = stubEventSource();
    render(<App />);
    await screen.findAllByText('Goal M');
    await act(async () => { es.error(); });
    expect(await screen.findByText('Your session expired — unlock again.')).toBeTruthy();
  });

  it('debounces SSE-triggered refetches by 150ms and drops out-of-order responses', async () => {
    vi.spyOn(api, 'session').mockResolvedValue(true);
    vi.spyOn(api, 'listMandates').mockResolvedValue([mandate]);
    const resolvers: ((v: ReturnType<typeof proposal>[]) => void)[] = [];
    const lp = vi.spyOn(api, 'listProposals').mockImplementation(
      () => new Promise((r) => { resolvers.push(r as (typeof resolvers)[number]); }),
    );
    const es = stubEventSource();
    render(<App />);
    await screen.findAllByText('Goal M');
    await waitFor(() => expect(lp).toHaveBeenCalledTimes(1));
    resolvers[0]([]);
    vi.useFakeTimers();
    try {
      lp.mockClear();
      act(() => { es.emit('ledger'); es.emit('ledger'); es.emit('ledger'); });
      await act(async () => { vi.advanceTimersByTime(149); });
      expect(lp).not.toHaveBeenCalled();
      await act(async () => { vi.advanceTimersByTime(2); });
      expect(lp).toHaveBeenCalledTimes(1);
      // second burst -> second request; resolve newer first, then the stale one
      act(() => { es.emit('ledger'); });
      await act(async () => { vi.advanceTimersByTime(150); });
      expect(lp).toHaveBeenCalledTimes(2);
      const [older, newer] = resolvers.slice(-2);
      await act(async () => { newer([proposal('new-one')]); });
      await act(async () => { older([]); });
      expect(screen.getByLabelText('1 pending')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
