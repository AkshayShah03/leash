import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Chat from '../src/pages/Chat';
import { ApiError, api } from '../src/lib/api';
import type { Proposal, ScoutTurnResult } from '../src/lib/types';

vi.mock('../src/components/ProductGrid', () => ({ default: () => <div>grid</div> }));

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: 'p1', mandateId: 'm1', status: 'pending_human', reasons: ['Over your review threshold'],
  intent: { score: 0.94, reason: 'ok' }, paypal: {}, createdAt: '', committedAt: null,
  input: { title: 'Ergo Keyboard', description: '', category: 'kb', merchant: 'shop.example', priceCents: 5999, currency: 'USD', userRequest: 'kb' },
  ...over,
});

const result: ScoutTurnResult = {
  text: 'Here is a **great** pick',
  products: [
    { id: 'a', title: 'Ergo Keyboard', brand: 'Kinesis', imageUrl: 'https://img.example/a.png', description: '', category: 'kb', categoryPath: [],
      offers: [{ domain: 'shop.example', priceCents: 5999, currency: 'USD', availability: 'InStock', condition: null, url: 'https://shop.example/a' }] },
    { id: 'b', title: 'Evil', brand: null, imageUrl: 'javascript:alert(1)', description: '', category: 'kb', categoryPath: [],
      offers: [{ domain: 'x.example', priceCents: 100, currency: 'USD', availability: 'InStock', condition: null, url: 'javascript:alert(2)' }] },
  ],
  proposals: [proposal()],
};

function setup() {
  const onProposalsChanged = vi.fn();
  const onReviewApprovals = vi.fn();
  render(<Chat mandateId="m1" onProposalsChanged={onProposalsChanged} onReviewApprovals={onReviewApprovals} />);
  return { onProposalsChanged, onReviewApprovals };
}

async function type(text: string) {
  fireEvent.change(screen.getByLabelText('Message Scout'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
}

describe('Chat', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('sends a message and renders reply, products and proposals', async () => {
    const chat = vi.spyOn(api, 'chat').mockResolvedValue(result);
    const { onProposalsChanged, onReviewApprovals } = setup();
    await type('keyboard please');
    expect(screen.getByText('keyboard please')).toBeInTheDocument();
    expect(await screen.findByText('great')).toBeInTheDocument();
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ mandateId: 'm1', messages: [{ role: 'user', content: 'keyboard please' }] }));
    expect(screen.getByRole('link', { name: 'View Ergo Keyboard' })).toHaveAttribute('href', 'https://shop.example/a');
    expect(screen.getByAltText('Ergo Keyboard')).toHaveAttribute('src', 'https://img.example/a.png');
    expect(screen.queryByRole('link', { name: 'View Evil' })).toBeNull();
    expect(screen.queryByAltText('Evil')).toBeNull();
    expect(screen.getByText('Needs your OK')).toBeInTheDocument();
    expect(screen.getByText('AI match 94%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review in Approvals' }));
    expect(onReviewApprovals).toHaveBeenCalled();
    expect(onProposalsChanged).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Compare in table' }));
    expect(screen.getByText('grid')).toBeInTheDocument();
  });

  it('disables composer and shows typing text while in flight', async () => {
    let resolve!: (r: ScoutTurnResult) => void;
    vi.spyOn(api, 'chat').mockReturnValue(new Promise((r) => { resolve = r; }));
    setup();
    await type('hi');
    expect(screen.getByText('Scout is searching and checking your rules…')).toBeInTheDocument();
    expect(screen.getByLabelText('Message Scout')).toBeDisabled();
    resolve({ text: 'done', products: [], proposals: [] });
    await waitFor(() => expect(screen.getByLabelText('Message Scout')).toBeEnabled());
  });

  it('shows inline error and refetches proposals on 502', async () => {
    vi.spyOn(api, 'chat').mockRejectedValue(new ApiError(502, 'scout_unavailable'));
    const { onProposalsChanged } = setup();
    await type('hi');
    expect(await screen.findByText(/Scout is unavailable right now/)).toBeInTheDocument();
    expect(onProposalsChanged).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('suggestion chip sends and New chat resets', async () => {
    vi.spyOn(api, 'chat').mockResolvedValue({ text: 'ok', products: [], proposals: [] });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Find a USB-C hub for my laptop' }));
    await screen.findByText('ok');
    fireEvent.click(screen.getByRole('button', { name: /New chat/ }));
    expect(screen.queryByText('ok')).toBeNull();
    expect(screen.getByText('What should Scout find for you?')).toBeInTheDocument();
  });
});
