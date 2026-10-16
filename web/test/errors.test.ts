import { describe, it, expect } from 'vitest';
import { ApiError } from '../src/lib/api';
import { humanizeError } from '../src/lib/errors';

describe('humanizeError', () => {
  const cases: [string, unknown, { conflict?: string } | undefined, string][] = [
    ['invalid_request', new ApiError(400, 'invalid_request'), undefined, 'Some of those values are not valid. Check the form and try again.'],
    ['invalid_json', new ApiError(400, 'invalid_json'), undefined, 'The request was malformed. Refresh and try again.'],
    ['forbidden', new ApiError(403, 'forbidden'), undefined, "You don't have permission to do that."],
    ['unauthorized', new ApiError(401, 'unauthorized'), undefined, 'Your session expired — unlock again.'],
    ['scout_unavailable', new ApiError(502, 'scout_unavailable'), undefined, 'Scout is unavailable right now. Try again in a moment.'],
    ['cap>budget', new ApiError(400, 'perOrderCapCents must not exceed monthlyBudgetCents'), undefined, "Per-order cap can't be more than the monthly budget"],
    ['409 with context', new ApiError(409, 'invalid_state'), { conflict: 'Already decided' }, 'Already decided'],
    ['409 without context', new ApiError(409), undefined, 'That action is no longer available.'],
    ['network', new TypeError('fetch failed'), undefined, "Can't reach the Leash server"],
    ['unknown code', new ApiError(500, 'internal_error'), undefined, 'Something went wrong. Try again.'],
    ['no code', new ApiError(500), undefined, 'Something went wrong. Try again.'],
    ['non-error', 'weird', undefined, "Can't reach the Leash server"],
  ];
  it.each(cases)('%s', (_n, err, opts, expected) => {
    expect(humanizeError(err, opts)).toBe(expected);
  });
});
