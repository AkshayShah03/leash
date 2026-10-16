import { describe, expect, it } from 'vitest';
import { signSession, verifySession } from '../src/session';
const S = 'x'.repeat(32);
describe('session tokens', () => {
  it('round-trips and expires', () => {
    const t = signSession(S, 1000, 5000);
    expect(verifySession(S, t, 2000)).toBe(true);
    expect(verifySession(S, t, 7000)).toBe(false);
  });
  it('rejects tampering, wrong secret and junk', () => {
    const t = signSession(S, 1000, 5000);
    const [exp, sig] = t.split('.');
    expect(verifySession(S, `${Number(exp) + 1}.${sig}`, 2000)).toBe(false);
    expect(verifySession('y'.repeat(32), t, 2000)).toBe(false);
    for (const junk of [undefined, '', 'abc', '1.2.3', '.']) expect(verifySession(S, junk, 2000)).toBe(false);
  });
});
