import { describe, expect, it } from 'vitest';
import { formatTime, formatUsd, parseUsdToCents, safeHref, eventLabel, statusLabel, statusTone } from '../src/lib/format';
import type { ProposalStatus } from '../src/lib/types';

describe('formatUsd', () => {
  it('formats cents', () => {
    expect(formatUsd(5999)).toBe('$59.99');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(5)).toBe('$0.05');
    expect(formatUsd(6000)).toBe('$60.00');
    expect(formatUsd(123456789)).toBe('$1,234,567.89');
  });
  it('returns a dash for invalid input', () => {
    expect(formatUsd(-1)).toBe('—');
    expect(formatUsd(1.5)).toBe('—');
    expect(formatUsd(NaN)).toBe('—');
    expect(formatUsd(Infinity)).toBe('—');
  });
});

describe('parseUsdToCents', () => {
  it('parses valid dollars', () => {
    expect(parseUsdToCents('59.99')).toBe(5999);
    expect(parseUsdToCents('60')).toBe(6000);
    expect(parseUsdToCents('0.5')).toBe(50);
    expect(parseUsdToCents(' 12.30 ')).toBe(1230);
  });
  it('rejects invalid input', () => {
    for (const bad of ['1.005', 'abc', '-1', '', '1.', '.5', '1e3', '$5', '1,000']) {
      expect(parseUsdToCents(bad)).toBeNull();
    }
  });
});

describe('safeHref', () => {
  it('allows http(s) only', () => {
    expect(safeHref('https://example.com/a')).toBe('https://example.com/a');
    expect(safeHref('http://example.com')).toBe('http://example.com');
    expect(safeHref('HTTPS://example.com')).toBe('HTTPS://example.com');
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('data:text/html,<b>x</b>')).toBeUndefined();
    expect(safeHref('/relative')).toBeUndefined();
    expect(safeHref('//evil.com')).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
    expect(safeHref(null)).toBeUndefined();
    expect(safeHref('')).toBeUndefined();
  });
});

describe('status mapping', () => {
  const cases: Array<[ProposalStatus, string, string]> = [
    ['tracked', 'Bought · tracking', 'success'],
    ['captured', 'Bought', 'success'],
    ['auto_approved', 'Paying…', 'progress'],
    ['human_approved', 'Paying…', 'progress'],
    ['pending_human', 'Needs your OK', 'warning'],
    ['denied', 'Blocked', 'danger'],
    ['refunded', 'Refunded', 'neutral'],
    ['failed', 'Failed', 'danger'],
    ['proposed', 'Checking…', 'progress'],
  ];
  it.each(cases)('%s', (s, label, tone) => {
    expect(statusLabel(s)).toBe(label);
    expect(statusTone(s)).toBe(tone);
  });
});

describe('formatTime', () => {
  it('formats valid ISO and dashes invalid', () => {
    expect(formatTime('2026-10-16T10:00:00Z')).not.toBe('—');
    expect(formatTime('nope')).toBe('—');
    expect(formatTime('')).toBe('—');
  });
  it('only includes seconds when asked', () => {
    const iso = '2026-10-16T10:00:07Z';
    expect(formatTime(iso, true).length).toBeGreaterThan(formatTime(iso).length);
  });
});

describe('eventLabel', () => {
  it.each([
    ['proposed', 'Proposed'], ['auto_approved', 'Approved by AI check'], ['human_approved', 'Approved by you'],
    ['pending_human', 'Sent to you for approval'], ['denied', 'Denied'], ['captured', 'Paid'],
    ['tracked', 'Tracking added'], ['refunded', 'Refunded'], ['failed', 'Failed'],
  ] as const)('%s', (s, label) => expect(eventLabel(s)).toBe(label));
});
