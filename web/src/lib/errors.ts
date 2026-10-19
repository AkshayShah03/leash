import { ApiError } from './api';

const BY_CODE: Record<string, string> = {
  invalid_request: 'Some of those values are not valid. Check the form and try again.',
  invalid_json: 'The request was malformed. Refresh and try again.',
  forbidden: "You don't have permission to do that.",
  unauthorized: 'Your session expired — unlock again.',
  rate_limited: 'Too many requests — try again in a few minutes.',
  scout_unavailable: 'Scout is unavailable right now. Try again in a moment.',
  'perOrderCapCents must not exceed monthlyBudgetCents': "Per-order cap can't be more than the monthly budget",
};

/** Maps gateway errors to user-facing text. `conflict` is the caller's context-specific text for HTTP 409. */
export function humanizeError(e: unknown, opts: { conflict?: string } = {}): string {
  if (e instanceof ApiError) {
    if (e.status === 409) return opts.conflict ?? 'That action is no longer available.';
    if (e.code && BY_CODE[e.code]) return BY_CODE[e.code];
    return 'Something went wrong. Try again.';
  }
  return "Can't reach the Leash server";
}
