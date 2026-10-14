import { describe, expect, it } from 'vitest';
import { loadPayPalConfig } from '../src/config';
import { Leash } from '../src/leash';
import { PayPalRest } from '../src/paypal/api';
import { PayPalClient } from '../src/paypal/client';
import { Store } from '../src/store';
import { mandate, proposal } from './fakes';

const vaultId = process.env.PAYPAL_VAULT_ID;

describe.skipIf(!vaultId)('PayPal sandbox end-to-end', () => {
  it('captures, tracks and refunds a real sandbox purchase through Leash', async () => {
    const store = new Store();
    const paypal = new PayPalRest(new PayPalClient(loadPayPalConfig()));
    const leash = new Leash({ store, paypal, intent: async () => ({ score: 0.99, reason: 'e2e' }) });
    const { id: _i, vaultId: _v, setupTokenId: _s, ...input } = mandate();
    const m = store.updateMandate(store.createMandate(input).id, { vaultId: vaultId! });

    const p = await leash.propose(m.id, proposal({ priceCents: 123, title: 'Leash e2e test item' }));
    console.log(store.listEvents(m.id));
    expect(p.status).toBe('tracked');
    expect(p.paypal.orderId).toBeTruthy();
    expect(p.paypal.captureId).toBeTruthy();

    const r = await leash.refund(p.id);
    expect(r.status).toBe('refunded');
    expect(r.paypal.refundId).toBeTruthy();
  }, 60_000);
});
