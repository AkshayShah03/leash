import { describe, expect, it, vi } from 'vitest';
import { decide } from '../src/decision';

const pass = { ok: true } as const;

describe('decide', () => {
  it('denies on rule failure without calling the intent check', async () => {
    const intent = vi.fn();
    const d = await decide({ ok: false, reasons: ['over cap'] }, intent, 0.8);
    expect(d).toEqual({ outcome: 'denied', reasons: ['over cap'], intent: null });
    expect(intent).not.toHaveBeenCalled();
  });

  it('auto-approves when the score meets the threshold', async () => {
    const d = await decide(pass, async () => ({ score: 0.8, reason: 'matches' }), 0.8);
    expect(d).toEqual({ outcome: 'auto_approved', reasons: [], intent: { score: 0.8, reason: 'matches' } });
  });

  it('routes low scores to a human with the reason', async () => {
    const d = await decide(pass, async () => ({ score: 0.3, reason: 'gaming, not office' }), 0.8);
    expect(d.outcome).toBe('pending_human');
    expect(d.reasons).toEqual(['Intent score 0.30 below threshold 0.80: gaming, not office']);
  });

  it('routes to a human when the intent check fails', async () => {
    const d = await decide(pass, async () => { throw new Error('timeout'); }, 0.8);
    expect(d).toEqual({ outcome: 'pending_human', reasons: ['Intent check unavailable: timeout'], intent: null });
  });

  it('a perfect intent score never overrides a rule denial', async () => {
    const d = await decide({ ok: false, reasons: ['blocked'] }, async () => ({ score: 1, reason: 'buy it' }), 0);
    expect(d.outcome).toBe('denied');
  });
});
