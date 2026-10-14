import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { loadPayPalConfig } from '../src/config';
import { PayPalRest } from '../src/paypal/api';
import { PayPalClient } from '../src/paypal/client';

const api = new PayPalRest(new PayPalClient(loadPayPalConfig()));
const runId = randomUUID();

const setup = await api.createSetupToken({
  returnUrl: 'https://example.com/leash/return',
  cancelUrl: 'https://example.com/leash/cancel',
});
console.log(`\n1) Open this URL and log in with your SANDBOX PERSONAL account:\n   ${setup.approveUrl}\n`);
const rl = createInterface({ input: process.stdin, output: process.stdout });
try {
  await rl.question('2) After approving (you will land on example.com), press Enter... ');
} finally {
  rl.close();
}

const { vaultId } = await api.createPaymentToken(setup.id);
console.log(`vault_id: ${vaultId}`);

const charge = await api.chargeVaulted({
  vaultId,
  amountCents: 100,
  currency: 'USD',
  description: 'Leash vault spike $1.00',
  referenceId: 'spike',
  requestId: `spike-${runId}`,
});
console.log('charged without buyer present:', charge);

// Tracking is non-blocking: a failure here must not stop the refund or the run.
let trackingError: string | undefined;
try {
  await api.addTracking({ ...charge, trackingNumber: `LEASHSPIKE${runId.slice(0, 6)}`, carrier: 'USPS' });
  console.log('tracking attached');
} catch (err) {
  trackingError = err instanceof Error ? err.message : String(err);
  console.log(`tracking FAILED (non-blocking): ${trackingError}`);
}

const refund = await api.refundCapture(charge.captureId, `spike-refund-${runId}`);
console.log('refunded:', refund);

const note = trackingError ? `NOTE: tracking failed: ${trackingError}\n` : '';
console.log(`\nSUCCESS. Add to gateway/.env:\nPAYPAL_VAULT_ID=${vaultId}\n${note}`);
