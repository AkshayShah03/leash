import type { IntentVerdict, Outcome, RuleResult } from './types';

export interface Decision {
  outcome: Outcome;
  reasons: string[];
  intent: IntentVerdict | null;
}

export async function decide(
  rule: RuleResult,
  runIntent: () => Promise<IntentVerdict>,
  threshold: number,
): Promise<Decision> {
  if (!rule.ok) return { outcome: 'denied', reasons: rule.reasons, intent: null };

  let intent: IntentVerdict;
  try {
    intent = await runIntent();
  } catch (e) {
    return {
      outcome: 'pending_human',
      reasons: [`Intent check unavailable: ${(e as Error).message}`],
      intent: null,
    };
  }

  if (intent.score >= threshold) return { outcome: 'auto_approved', reasons: [], intent };
  return {
    outcome: 'pending_human',
    reasons: [`Intent score ${intent.score.toFixed(2)} below threshold ${threshold.toFixed(2)}: ${intent.reason}`],
    intent,
  };
}
