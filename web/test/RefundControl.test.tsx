import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RefundControl from '../src/components/RefundControl';
import { ApiError, api } from '../src/lib/api';
import type { Proposal } from '../src/lib/types';

const proposal: Proposal = {
  id: 'p1', mandateId: 'm1', status: 'captured', reasons: [], intent: null, paypal: { orderId: 'O1' },
  createdAt: '2026-10-16T10:00:00Z', committedAt: '2026-10-16T10:00:00Z',
  input: { title: 'Desk Lamp', description: '', category: 'home', merchant: 'shop.example', priceCents: 5999, currency: 'USD', userRequest: 'lamp' },
};

function setup() {
  const onChanged = vi.fn();
  const onToast = vi.fn();
  render(<RefundControl proposal={proposal} onChanged={onChanged} onToast={onToast} />);
  return { onChanged, onToast };
}

describe('RefundControl', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('confirms inline, refunds once, toasts and refetches', async () => {
    const spy = vi.spyOn(api, 'refund').mockResolvedValue({ ...proposal, status: 'refunded' });
    const { onChanged, onToast } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Refund Desk Lamp' }));
    expect(screen.getByText('Refund $59.99?')).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('p1');
    expect(onToast).toHaveBeenCalledWith('Refunded $59.99');
  });

  it('cancel does not call the api', () => {
    const spy = vi.spyOn(api, 'refund');
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Refund Desk Lamp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Refund Desk Lamp' })).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiError(409), 'Already refunded or not refundable'],
    [new ApiError(500), 'Request failed (500). Try again.'],
    [new ApiError(400, 'bad_state'), 'bad_state'],
    [new TypeError('fetch failed'), "Can't reach the gateway. Check your connection."],
  ])('maps errors %#', async (err, msg) => {
    vi.spyOn(api, 'refund').mockRejectedValue(err);
    const { onChanged, onToast } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Refund Desk Lamp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(onToast).toHaveBeenCalledWith(msg);
  });
});
