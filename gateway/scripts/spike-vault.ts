import { randomUUID } from 'node:crypto';
import { loadPayPalConfig } from '../src/config';
import { PayPalRest } from '../src/paypal/api';
import { PayPalClient } from '../src/paypal/client';

const api = new PayPalRest(new PayPalClient(loadPayPalConfig()));
const runId = randomUUID();

// Two steps so no interactive stdin is needed:
//   npm run spike            -> creates a setup token and prints the approve URL
//   npm run spike -- <token> -> after browser approval, vaults, charges $1, tracks, refunds
const setupTokenId = process.argv[2];
if (!setupTokenId) {
  const setup = await api.createSetupToken({
    returnUrl: 'https://example.com/leash/return',
    cancelUrl: 'https://example.com/leash/cancel',
  });
  console.log(`\n1) Open this URL and log in with your SANDBOX PERSONAL account:\n   ${setup.approveUrl}\n`);
  console.log(`2) After approving (you will land on example.com), run:\n   npm run spike -- ${setup.id}\n`);
  process.exit(0);
}

const { vaultId } = await api.createPaymentToken(setupTokenId);
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
