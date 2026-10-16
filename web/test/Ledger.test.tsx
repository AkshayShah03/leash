import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Ledger from '../src/pages/Ledger';
import { api } from '../src/lib/api';
import type { Proposal } from '../src/lib/types';

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: 'p1', mandateId: 'm1', status: 'captured', reasons: [], intent: null, paypal: {}, createdAt: '2026-10-16T10:00:00Z', committedAt: '2026-10-16T10:00:00Z',
  input: { title: 'Desk Lamp', description: '', category: 'home', merchant: 'shop.example', priceCents: 5999, currency: 'USD', userRequest: 'lamp' },
  ...over,
});

describe('Ledger page', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('shows empty state', () => {
    vi.spyOn(api, 'ledger').mockResolvedValue([]);
    render(<Ledger mandateId="m1" proposals={[]} onChanged={vi.fn()} onToast={vi.fn()} />);
    expect(screen.getByText('No purchases yet')).toBeTruthy();
  });

  it('fetches events for the mandate and shows totals and filters', async () => {
    const spy = vi.spyOn(api, 'ledger').mockResolvedValue([]);
    render(<Ledger mandateId="m1" proposals={[proposal({ status: 'denied', id: 'p2' }), proposal({ status: 'refunded', id: 'p3' })]} onChanged={vi.fn()} onToast={vi.fn()} />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith('m1'));
    expect(screen.getByText('Blocked', { selector: '.ltotal__label' })).toBeTruthy();
    expect(screen.getByText('$59.99', { selector: '.ltotal__value' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Needs OK' }));
    expect(screen.getByText('Nothing matches this filter.')).toBeTruthy();
  });
});
