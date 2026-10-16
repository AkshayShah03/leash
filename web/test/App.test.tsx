import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { api } from '../src/lib/api';

describe('App session gate', () => {
  beforeEach(() => vi.restoreAllMocks());

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
    vi.unstubAllGlobals();
  });
});
