import { act, render, screen } from '@testing-library/react';
import { ModuleRegistry, ValidationModule } from 'ag-grid-community';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LedgerGrid from '../src/components/LedgerGrid';
import ProductGrid from '../src/components/ProductGrid';
import type { Proposal, ProductSummary } from '../src/lib/types';

// Production builds register a hand-picked module list. ValidationModule reports any grid feature used
// without its module (AG Grid error #200), so registering it here makes missing modules fail the test.
ModuleRegistry.registerModules([ValidationModule]);

const proposal = (id: string, over: Partial<Proposal> = {}): Proposal => ({
  id, mandateId: 'm1', status: 'captured', reasons: [], intent: { score: 0.9, reason: 'ok' }, paypal: { orderId: 'ORD-1' },
  createdAt: '2026-10-16T10:00:00Z', committedAt: '2026-10-16T10:00:00Z',
  input: { title: `Lamp ${id}`, description: '', category: 'home', merchant: 'shop.example', priceCents: 5999, currency: 'USD', userRequest: 'lamp' },
  ...over,
});

const products: ProductSummary[] = [{
  id: 'a', title: 'Desk Lamp', brand: 'Acme', imageUrl: null, description: '', category: 'home', categoryPath: [],
  offers: [{ domain: 'shop.example', priceCents: 5999, currency: 'USD', availability: 'in_stock', condition: null, url: 'https://shop.example' }],
}];

let errors: unknown[][];
let warns: unknown[][];
beforeEach(() => {
  errors = []; warns = [];
  vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a); });
  vi.spyOn(console, 'warn').mockImplementation((...a) => { errors.length; warns.push(a); });
});
afterEach(() => { vi.restoreAllMocks(); });

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 200)); });
const expectClean = () => {
  const all = [...errors, ...warns].map((a) => a.map(String).join(' '));
  expect(all.filter((m) => /AG Grid|#200|error #/.test(m))).toEqual([]);
  expect(errors).toEqual([]);
};

describe('AG Grid module registration', () => {
  it('LedgerGrid uses only registered modules, including selection redraw/refresh', async () => {
    const props = { proposals: [proposal('p1'), proposal('p2', { intent: null, paypal: {} })], events: [], onSelect: vi.fn(), onChanged: vi.fn(), onToast: vi.fn() };
    const { rerender } = render(<LedgerGrid {...props} selectedId={null} />);
    await screen.findByRole('button', { name: 'Lamp p1' });
    rerender(<LedgerGrid {...props} selectedId="p1" />);
    await settle();
    rerender(<LedgerGrid {...props} selectedId="p2" />);
    await settle();
    expectClean();
  });

  it('ProductGrid uses only registered modules', async () => {
    render(<ProductGrid products={products} />);
    await screen.findByText('Desk Lamp');
    await settle();
    expectClean();
  });
});
