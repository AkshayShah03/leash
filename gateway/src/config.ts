import { SANDBOX_BASE_URL, type PayPalConfig } from './paypal/client';

export function loadPayPalConfig(env: Record<string, string | undefined> = process.env): PayPalConfig {
  const clientId = env.PAYPAL_CLIENT_ID;
  const clientSecret = env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set (see .env.example)');
  }
  return { clientId, clientSecret, baseUrl: env.PAYPAL_BASE_URL || SANDBOX_BASE_URL };
}
