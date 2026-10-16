import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { mandate, proposal } from './fakes';

function setup() {
  const store = new Store();
  const { id: _id, vaultId: _v, setupTokenId: _s, ...input } = mandate();
  const m = store.createMandate(input);
  return { store, m };
}

describe('Store mandates', () => {
  it('listMandates returns newest first', () => {
    const { store, m } = setup();
    const { id: _i, vaultId: _v, setupTokenId: _s, ...input } = mandate();
    const m2 = store.createMandate({ ...input, goal: 'second' });
    expect(store.listMandates().map((x) => x.id)).toEqual([m2.id, m.id]);
  });
  it('updateMandateRules patches rules and never touches vault fields', () => {
    const { store, m } = setup();
    store.updateMandate(m.id, { vaultId: 'V-1' });
    const next = store.updateMandateRules(m.id, { perOrderCapCents: 123, vaultId: 'evil' } as any);
    expect(next).toMatchObject({ perOrderCapCents: 123, vaultId: 'V-1' });
    expect(store.getMandate(m.id)).toMatchObject({ perOrderCapCents: 123, vaultId: 'V-1' });
    expect(() => store.updateMandateRules('nope', {})).toThrow();
  });
});

describe('Store', () => {
  it('creates mandates without vault credentials and updates them', () => {
    const { store, m } = setup();
    expect(m.vaultId).toBeNull();
    store.updateMandate(m.id, { vaultId: 'V-1' });
    expect(store.getMandate(m.id)?.vaultId).toBe('V-1');
    expect(store.getMandate('nope')).toBeUndefined();
  });

  it('round-trips proposals and merges paypal refs on update', () => {
    const { store, m } = setup();
    const p = store.createProposal(m.id, proposal(), new Date('2026-10-20T12:00:00Z'));
    expect(p.status).toBe('proposed');
    store.updateProposal(p.id, { status: 'captured', paypal: { orderId: 'O', captureId: 'C' } });
    const updated = store.updateProposal(p.id, { status: 'refunded', paypal: { refundId: 'R' } });
    expect(updated.paypal).toEqual({ orderId: 'O', captureId: 'C', refundId: 'R' });
    expect(store.getProposal(p.id)).toEqual(updated);
  });

  it('appends ledger events in order, filterable by mandate', () => {
    const { store, m } = setup();
    const p = store.createProposal(m.id, proposal(), new Date());
    const e1 = store.appendEvent({ proposalId: p.id, mandateId: m.id, status: 'proposed', actor: 'agent', detail: 'a', at: 't1' });
    const e2 = store.appendEvent({ proposalId: p.id, mandateId: m.id, status: 'denied', actor: 'policy', detail: 'b', at: 't2' });
    store.appendEvent({ proposalId: 'x', mandateId: 'other', status: 'proposed', actor: 'agent', detail: 'c', at: 't3' });
    expect(e2.seq).toBeGreaterThan(e1.seq);
    expect(store.listEvents(m.id).map((e) => e.detail)).toEqual(['a', 'b']);
    expect(store.listEvents()).toHaveLength(3);
  });

  it('computes spend from committed proposals in the current UTC month only', () => {
    const { store, m } = setup();
    const now = new Date('2026-10-20T12:00:00Z');
    const add = (cents: number, status: Parameters<Store['updateProposal']>[1]['status'], at: Date) => {
      const p = store.createProposal(m.id, proposal({ priceCents: cents }), at);
      store.updateProposal(p.id, { status, committedAt: at.toISOString() });
      return p;
    };
    add(1000, 'tracked', new Date('2026-10-01T00:00:00Z'));
    add(2000, 'captured', new Date('2026-10-20T08:00:00Z'));
    add(3000, 'auto_approved', new Date('2026-10-20T09:00:00Z'));
    add(4000, 'refunded', new Date('2026-10-20T10:00:00Z')); // money returned
    add(5000, 'denied', new Date('2026-10-20T10:00:00Z'));
    add(6000, 'pending_human', new Date('2026-10-20T10:00:00Z'));
    add(7000, 'tracked', new Date('2026-09-30T23:59:59Z')); // last month
    const h = store.spendHistory(m.id, now);
    expect(h.monthSpentCents).toBe(6000); // 1000 + 2000 + 3000
    expect(h.ordersToday).toBe(3); // captured, auto_approved, refunded on Oct 20
  });

  it('excludes a given proposal from spend', () => {
    const { store, m } = setup();
    const now = new Date('2026-10-20T12:00:00Z');
    const p = store.createProposal(m.id, proposal({ priceCents: 5000 }), now);
    store.updateProposal(p.id, { status: 'auto_approved', committedAt: now.toISOString() });
    expect(store.spendHistory(m.id, now).monthSpentCents).toBe(5000);
    expect(store.spendHistory(m.id, now, p.id).monthSpentCents).toBe(0);
  });

  it('windows spend by commit time, not creation time', () => {
    const { store, m } = setup();
    const p = store.createProposal(m.id, proposal({ priceCents: 4000 }), new Date('2026-10-31T23:00:00Z'));
    store.updateProposal(p.id, { status: 'human_approved', committedAt: '2026-11-01T01:00:00.000Z' });
    expect(store.getProposal(p.id)?.committedAt).toBe('2026-11-01T01:00:00.000Z');
    const nov = store.spendHistory(m.id, new Date('2026-11-15T12:00:00Z'));
    expect(nov.monthSpentCents).toBe(4000);
    const oct = store.spendHistory(m.id, new Date('2026-10-31T23:30:00Z'));
    expect(oct.monthSpentCents).toBe(0);
    expect(oct.ordersToday).toBe(0);
    expect(store.spendHistory(m.id, new Date('2026-11-01T12:00:00Z')).ordersToday).toBe(1);
  });

  it('starts proposals with committedAt null', () => {
    const { store, m } = setup();
    expect(store.createProposal(m.id, proposal(), new Date()).committedAt).toBeNull();
  });

  it('lists proposals newest first, optionally by status', () => {
    const { store, m } = setup();
    const a = store.createProposal(m.id, proposal({ title: 'A' }), new Date('2026-10-20T10:00:00Z'));
    const b = store.createProposal(m.id, proposal({ title: 'B' }), new Date('2026-10-20T11:00:00Z'));
    store.updateProposal(a.id, { status: 'pending_human' });
    expect(store.listProposals(m.id).map((p) => p.input.title)).toEqual(['B', 'A']);
    expect(store.listProposals(m.id, 'pending_human').map((p) => p.id)).toEqual([a.id]);
    expect(store.listProposals('other')).toEqual([]);
    expect(b.id).toBeTruthy();
  });

  it('finds proposals by idempotency key per mandate', () => {
    const { store, m } = setup();
    const p = store.createProposal(m.id, proposal(), new Date(), 'key-1');
    expect(store.findByIdempotencyKey(m.id, 'key-1')?.id).toBe(p.id);
    expect(store.findByIdempotencyKey('other', 'key-1')).toBeUndefined();
    expect(() => store.createProposal(m.id, proposal(), new Date(), 'key-1')).toThrow();
  });
});
