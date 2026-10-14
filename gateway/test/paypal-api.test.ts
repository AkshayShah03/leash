import { describe, expect, it } from 'vitest';
import { PayPalClient } from '../src/paypal/client';
import { PayPalRest } from '../src/paypal/api';
import { TOKEN_RESPONSE, fakeFetch, type FakeResponse } from './helpers';

function api(responses: FakeResponse[]) {
  const { fn, calls } = fakeFetch([TOKEN_RESPONSE, ...responses]);
  const rest = new PayPalRest(new PayPalClient({ clientId: 'i', clientSecret: 's', baseUrl: 'https://pp.test' }, fn));
  const sent = () =>
    calls.slice(1).map((c) => ({
      url: c.url.replace('https://pp.test', ''),
      body: c.init.body ? JSON.parse(String(c.init.body)) : undefined,
      requestId: (c.init.headers as Record<string, string>)['PayPal-Request-Id'],
    }));
  return { rest, sent };
}

const completedOrder = {
  id: 'ORDER-1',
  status: 'COMPLETED',
  purchase_units: [{ payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED' }] } }],
};

describe('PayPalRest', () => {
  it('creates a vault setup token for a PayPal wallet and returns the approve link', async () => {
    const { rest, sent } = api([
      { status: 200, body: { id: 'ST-1', links: [{ rel: 'approve', href: 'https://pp/approve' }] } },
    ]);
    const res = await rest.createSetupToken({ returnUrl: 'https://r', cancelUrl: 'https://c' });
    expect(res).toEqual({ id: 'ST-1', approveUrl: 'https://pp/approve' });
    expect(sent()[0]).toMatchObject({
      url: '/v3/vault/setup-tokens',
      body: {
        payment_source: {
          paypal: {
            usage_type: 'MERCHANT',
            experience_context: { return_url: 'https://r', cancel_url: 'https://c' },
          },
        },
      },
    });
  });

  it('exchanges an approved setup token for a payment token (vault id)', async () => {
    const { rest, sent } = api([{ status: 200, body: { id: 'VAULT-1' } }]);
    expect(await rest.createPaymentToken('ST-1')).toEqual({ vaultId: 'VAULT-1' });
    expect(sent()[0]).toEqual({
      url: '/v3/vault/payment-tokens',
      body: { payment_source: { token: { id: 'ST-1', type: 'SETUP_TOKEN' } } },
      requestId: 'payment-token-ST-1',
    });
  });

  it('charges a vaulted wallet; uses the capture from a COMPLETED order directly', async () => {
    const { rest, sent } = api([{ status: 201, body: completedOrder }]);
    const res = await rest.chargeVaulted({
      vaultId: 'VAULT-1',
      amountCents: 5400,
      currency: 'USD',
      description: 'Ergonomic keyboard',
      referenceId: 'prop-1',
      requestId: 'order-prop-1',
    });
    expect(res).toEqual({ orderId: 'ORDER-1', captureId: 'CAP-1' });
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toEqual({
      url: '/v2/checkout/orders',
      requestId: 'order-prop-1',
      body: {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: 'prop-1',
            description: 'Ergonomic keyboard',
            amount: { currency_code: 'USD', value: '54.00' },
          },
        ],
        payment_source: { paypal: { vault_id: 'VAULT-1' } },
      },
    });
  });

  it('captures explicitly when the created order is not yet COMPLETED', async () => {
    const { rest, sent } = api([
      { status: 201, body: { id: 'ORDER-2', status: 'APPROVED' } },
      { status: 201, body: { ...completedOrder, id: 'ORDER-2' } },
    ]);
    const res = await rest.chargeVaulted({
      vaultId: 'V', amountCents: 100, currency: 'USD', description: 'x', referenceId: 'p', requestId: 'order-p',
    });
    expect(res.orderId).toBe('ORDER-2');
    expect(sent()[1]).toMatchObject({ url: '/v2/checkout/orders/ORDER-2/capture', requestId: 'order-p-capture' });
  });

  it('fails loudly when the capture is not COMPLETED', async () => {
    const { rest } = api([
      {
        status: 201,
        body: { id: 'O', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'C', status: 'DECLINED' }] } }] },
      },
    ]);
    await expect(
      rest.chargeVaulted({ vaultId: 'V', amountCents: 100, currency: 'USD', description: 'x', referenceId: 'p', requestId: 'r' }),
    ).rejects.toThrow('Capture not completed for order O: DECLINED');
  });

  it('truncates descriptions to 127 characters', async () => {
    const { rest, sent } = api([{ status: 201, body: completedOrder }]);
    await rest.chargeVaulted({
      vaultId: 'V', amountCents: 100, currency: 'USD', description: 'a'.repeat(300), referenceId: 'p', requestId: 'r',
    });
    expect(sent()[0].body.purchase_units[0].description).toHaveLength(127);
  });

  it('refunds a capture idempotently', async () => {
    const { rest, sent } = api([{ status: 201, body: { id: 'REF-1', status: 'COMPLETED' } }]);
    expect(await rest.refundCapture('CAP-1', 'refund-p')).toEqual({ refundId: 'REF-1', status: 'COMPLETED' });
    expect(sent()[0]).toEqual({ url: '/v2/payments/captures/CAP-1/refund', body: {}, requestId: 'refund-p' });
  });

  it('adds shipment tracking to an order', async () => {
    const { rest, sent } = api([{ status: 201, body: {} }]);
    await rest.addTracking({ orderId: 'ORDER-1', captureId: 'CAP-1', trackingNumber: 'LEASH1', carrier: 'USPS' });
    expect(sent()[0]).toEqual({
      url: '/v2/checkout/orders/ORDER-1/track',
      body: { capture_id: 'CAP-1', tracking_number: 'LEASH1', carrier: 'USPS', notify_payer: false },
      requestId: 'track-ORDER-1',
    });
  });
});
