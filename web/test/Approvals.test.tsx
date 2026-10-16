import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Approvals from '../src/pages/Approvals';
import { ApiError, api } from '../src/lib/api';
import type { Proposal } from '../src/lib/types';

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: 'p1', mandateId: 'm1', status: 'pending_human', reasons: ['Category "gaming" is not allowed'],
  intent: { score: 0.5, reason: 'explicit gaming focus' }, paypal: {}, createdAt: '2026-10-16T10:00:00Z', committedAt: null,
  input: { title: 'Gaming Headset', description: '', category: 'audio', merchant: 'shop.example', priceCents: 7999, currency: 'USD', userRequest: 'a headset for calls', productUrl: 'javascript:alert(1)' },
  ...over,
});

function setup(proposals: Proposal[] = [proposal()]) {
  const onChanged = vi.fn();
  const onToast = vi.fn();
  render(<Approvals proposals={proposals} onChanged={onChanged} onToast={onToast} />);
  return { onChanged, onToast };
}

describe('Approvals', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('shows empty state', () => {
    setup([]);
    expect(screen.getByText('Nothing needs your OK. Scout will ask here when a purchase looks off.')).toBeTruthy();
  });

  it('renders details and never links unsafe urls', () => {
    setup();
    expect(screen.getByText('Gaming Headset')).toBeTruthy();
    expect(screen.getByText('$79.99')).toBeTruthy();
    expect(screen.getByText(/a headset for calls/)).toBeTruthy();
    expect(screen.getByText(/AI match 50%/)).toBeTruthy();
    expect(screen.getByText(/explicit gaming focus/)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('approves, toasts and refetches', async () => {
    const spy = vi.spyOn(api, 'approve').mockResolvedValue(proposal({ status: 'human_approved' }));
    const { onChanged, onToast } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Approve Gaming Headset' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith('p1');
    expect(onToast).toHaveBeenCalledWith('Approved — paying now');
  });

  it('denies with a reason', async () => {
    const spy = vi.spyOn(api, 'deny').mockResolvedValue(proposal({ status: 'denied' }));
    const { onChanged, onToast } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Deny Gaming Headset' }));
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'not needed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deny' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith('p1', 'not needed');
    expect(onToast).toHaveBeenCalledWith('Denied');
  });

  it('shows re-check denial inline', async () => {
    vi.spyOn(api, 'approve').mockResolvedValue(proposal({ status: 'denied', reasons: ['Over monthly cap'] }));
    const { onChanged } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Approve Gaming Headset' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Blocked on re-check: Over monthly cap');
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows already decided on 409 and refetches', async () => {
    vi.spyOn(api, 'approve').mockRejectedValue(new ApiError(409, 'conflict'));
    const { onChanged } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Approve Gaming Headset' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Already decided');
    expect(onChanged).toHaveBeenCalled();
  });

  it('disables buttons while in flight', async () => {
    let resolve!: (p: Proposal) => void;
    vi.spyOn(api, 'approve').mockReturnValue(new Promise((r) => { resolve = r; }));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Approve Gaming Headset' }));
    expect((screen.getByRole('button', { name: 'Approve Gaming Headset' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Deny Gaming Headset' }) as HTMLButtonElement).disabled).toBe(true);
    resolve(proposal({ status: 'human_approved' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve Gaming Headset' })).toBeNull());
  });
});
