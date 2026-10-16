import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('shows empty state only after the ledger fetch completes', async () => {
    vi.spyOn(api, 'ledger').mockResolvedValue([]);
    render(<Ledger mandateId="m1" proposals={[]} onChanged={vi.fn()} onToast={vi.fn()} />);
    expect(screen.queryByText('No purchases yet')).toBeNull();
    expect(await screen.findByText('No purchases yet')).toBeTruthy();
  });

  it('product button toggles the audit trail and moves focus to its heading', async () => {
    vi.spyOn(api, 'ledger').mockResolvedValue([]);
    render(<Ledger mandateId="m1" proposals={[proposal()]} onChanged={vi.fn()} onToast={vi.fn()} />);
    const btn = await screen.findByRole('button', { name: 'Desk Lamp' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    const heading = await screen.findByRole('heading', { name: /Audit trail/ });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Desk Lamp' }).getAttribute('aria-expanded')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: 'Desk Lamp' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Audit trail/ })).toBeNull());
  });

  it('clicking Refund does not select the row or open the audit panel', async () => {
    vi.spyOn(api, 'ledger').mockResolvedValue([]);
    render(<Ledger mandateId="m1" proposals={[proposal()]} onChanged={vi.fn()} onToast={vi.fn()} />);
    const product = await screen.findByRole('button', { name: 'Desk Lamp' });
    fireEvent.click(await screen.findByRole('button', { name: 'Refund Desk Lamp' }));
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
    // AG Grid dispatches rowClicked asynchronously; give it time to (wrongly) select.
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    expect(screen.queryByRole('heading', { name: /Audit trail/ })).toBeNull();
    expect(product.getAttribute('aria-expanded')).toBe('false');
  });

  it('highlights the selected row via grid context and clears it on toggle', async () => {
    vi.spyOn(api, 'ledger').mockResolvedValue([]);
    render(<Ledger mandateId="m1" proposals={[proposal()]} onChanged={vi.fn()} onToast={vi.fn()} />);
    const row = () => document.querySelector('.ag-row.lrow') as HTMLElement;
    fireEvent.click(await screen.findByRole('button', { name: 'Desk Lamp' }));
    await waitFor(() => expect(row().classList.contains('lrow--selected')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Desk Lamp' }));
    await waitFor(() => expect(row().classList.contains('lrow--selected')).toBe(false));
  });

  it('shows an error notice when the ledger fetch fails', async () => {
    vi.spyOn(api, 'ledger').mockRejectedValue(new Error('boom'));
    render(<Ledger mandateId="m1" proposals={[proposal()]} onChanged={vi.fn()} onToast={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Desk Lamp' }));
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load the audit trail");
    expect(screen.queryByText('No events recorded.')).toBeNull();
  });

  it('fetches events for the mandate and shows totals and filters', async () => {
    const spy = vi.spyOn(api, 'ledger').mockResolvedValue([]);
    render(<Ledger mandateId="m1" proposals={[proposal({ status: 'denied', id: 'p2' }), proposal({ status: 'refunded', id: 'p3' })]} onChanged={vi.fn()} onToast={vi.fn()} />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith('m1'));
    expect(screen.getByText('Denied', { selector: '.ltotal__label' })).toBeTruthy();
    expect(screen.getByText('Bought this month (completed)')).toBeTruthy();
    expect(screen.getByText('$59.99', { selector: '.ltotal__value' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Needs OK' }));
    expect(screen.getByText('Nothing matches this filter.')).toBeTruthy();
  });
});
