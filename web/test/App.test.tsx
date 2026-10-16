import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
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

});
