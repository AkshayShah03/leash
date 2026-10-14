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
await rl.question('2) After approving (you will land on example.com), press Enter... ');
rl.close();

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

await api.addTracking({ ...charge, trackingNumber: `LEASHSPIKE${runId.slice(0, 6)}`, carrier: 'USPS' });
console.log('tracking attached');

const refund = await api.refundCapture(charge.captureId, `spike-refund-${runId}`);
console.log('refunded:', refund);

console.log(`\nSUCCESS. Add to gateway/.env:\nPAYPAL_VAULT_ID=${vaultId}\n`);
