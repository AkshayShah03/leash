import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('shows failed approve status inline without success toast', async () => {
    vi.spyOn(api, 'approve').mockResolvedValue(proposal({ status: 'failed', reasons: ['Card declined'] }));
    const { onToast } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Approve Gaming Headset' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not complete: Card declined');
    expect(onToast).not.toHaveBeenCalled();
  });

  it('falls back to status when failed has no reasons', async () => {
    vi.spyOn(api, 'approve').mockResolvedValue(proposal({ status: 'failed', reasons: [] }));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Approve Gaming Headset' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not complete: failed');
  });

  it('shows a humanized message for other api errors', async () => {
    vi.spyOn(api, 'approve').mockRejectedValue(new ApiError(422, 'mandate_expired'));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Approve Gaming Headset' }));
    const text = (await screen.findByRole('alert')).textContent ?? '';
    expect(text).toContain('Something went wrong. Try again.');
    expect(text).not.toContain('mandate_expired');
  });

  it('shows connectivity message on network errors', async () => {
    vi.spyOn(api, 'approve').mockRejectedValue(new TypeError('Failed to fetch'));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Approve Gaming Headset' }));
    expect((await screen.findByRole('alert')).textContent).toContain("Can't reach the Leash server");
  });

  it('sends one request for two same-tick clicks', async () => {
    const spy = vi.spyOn(api, 'approve').mockReturnValue(new Promise(() => {}));
    setup();
    const btn = screen.getByRole('button', { name: 'Approve Gaming Headset' });
    act(() => { btn.click(); btn.click(); });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('caps deny reason at 300 chars and shows a counter', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Deny Gaming Headset' }));
    const input = screen.getByLabelText('Reason (optional)') as HTMLInputElement;
    expect(input.maxLength).toBe(300);
    fireEvent.change(input, { target: { value: 'abcde' } });
    expect(screen.getByText('5/300')).toBeTruthy();
  });

  it('clears the leave timer on unmount', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(api, 'approve').mockResolvedValue(proposal({ status: 'human_approved' }));
      const { unmount } = render(<Approvals proposals={[proposal()]} onChanged={vi.fn()} onToast={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Approve Gaming Headset' }));
      await vi.advanceTimersByTimeAsync(10);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
