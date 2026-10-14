import { toPayPalValue } from '../money';
import type { PayPalClient } from './client';

export interface ChargeArgs {
  vaultId: string;
  amountCents: number;
  currency: string;
  description: string;
  referenceId: string;
  requestId: string;
}

export interface ChargeResult {
  orderId: string;
  captureId: string;
}

export interface TrackingArgs {
  orderId: string;
  captureId: string;
  trackingNumber: string;
  carrier: string;
}

export interface PayPalApi {
  chargeVaulted(a: ChargeArgs): Promise<ChargeResult>;
  refundCapture(captureId: string, requestId: string): Promise<{ refundId: string; status: string }>;
  addTracking(a: TrackingArgs): Promise<void>;
}

export interface VaultApi {
  createSetupToken(a: { returnUrl: string; cancelUrl: string }): Promise<{ id: string; approveUrl: string }>;
  createPaymentToken(setupTokenId: string): Promise<{ vaultId: string }>;
}

interface Order {
  id: string;
  status: string;
  purchase_units?: Array<{ payments?: { captures?: Array<{ id: string; status: string }> } }>;
}

export class PayPalRest implements PayPalApi, VaultApi {
  constructor(private c: PayPalClient) {}

  async createSetupToken(a: { returnUrl: string; cancelUrl: string }) {
    const res = await this.c.request<{ id: string; links: Array<{ rel: string; href: string }> }>(
      'POST',
      '/v3/vault/setup-tokens',
      {
        body: {
          payment_source: {
            paypal: {
              usage_type: 'MERCHANT',
              experience_context: { return_url: a.returnUrl, cancel_url: a.cancelUrl },
            },
          },
        },
      },
    );
    const approveUrl = res.links?.find((l) => l.rel === 'approve')?.href;
    if (!approveUrl) throw new Error(`Setup token ${res.id} has no approve link`);
    return { id: res.id, approveUrl };
  }

  async createPaymentToken(setupTokenId: string) {
    const res = await this.c.request<{ id: string }>('POST', '/v3/vault/payment-tokens', {
      requestId: `payment-token-${setupTokenId}`,
      body: { payment_source: { token: { id: setupTokenId, type: 'SETUP_TOKEN' } } },
    });
    return { vaultId: res.id };
  }

  async chargeVaulted(a: ChargeArgs): Promise<ChargeResult> {
    const order = await this.c.request<Order>('POST', '/v2/checkout/orders', {
      requestId: a.requestId,
      body: {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: a.referenceId,
            description: a.description.slice(0, 127),
            amount: { currency_code: a.currency, value: toPayPalValue(a.amountCents) },
          },
        ],
        payment_source: { paypal: { vault_id: a.vaultId } },
      },
    });
    const final =
      order.status === 'COMPLETED'
        ? order
        : await this.c.request<Order>('POST', `/v2/checkout/orders/${order.id}/capture`, {
            requestId: `${a.requestId}-capture`,
            body: {},
          });
    const capture = final.purchase_units?.[0]?.payments?.captures?.[0];
    if (!capture || capture.status !== 'COMPLETED') {
      throw new Error(`Capture not completed for order ${order.id}: ${capture?.status ?? 'missing'}`);
    }
    return { orderId: order.id, captureId: capture.id };
  }

  async refundCapture(captureId: string, requestId: string) {
    const res = await this.c.request<{ id: string; status: string }>(
      'POST',
      `/v2/payments/captures/${captureId}/refund`,
      { requestId, body: {} },
    );
    return { refundId: res.id, status: res.status };
  }

  async addTracking(a: TrackingArgs): Promise<void> {
    await this.c.request('POST', `/v2/checkout/orders/${a.orderId}/track`, {
      requestId: `track-${a.orderId}`,
      body: {
        capture_id: a.captureId,
        tracking_number: a.trackingNumber,
        carrier: a.carrier,
        notify_payer: false,
      },
    });
  }
}
