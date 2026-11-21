import type { ParsedStep } from "../types.js";

/**
 * Keyword/intent signals for actions that look irreversible: payments,
 * deletions, order submission, and sending messages. These require explicit
 * per-test approval (`destructiveApproved` on the TestDefinition) before the
 * resolver or runner is allowed to execute them for real.
 */
const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\bdelete\b/i,
  /\bremove\s+(my|the|this)?\s*account\b/i,
  /\bpay\b/i,
  /\bcheckout\b/i,
  /\bplace\s+(the\s+)?order\b/i,
  /\bsubmit\s+(the\s+)?order\b/i,
  /\bconfirm\s+purchase\b/i,
  /\bsend\s+(the\s+)?message\b/i,
  /\bsend\s+email\b/i,
  /\bpublish\b/i,
  /\bcancel\s+(my\s+)?subscription\b/i,
  /\btransfer\s+funds\b/i,
  /\bwire\b/i,
  /\bdeactivate\b/i,
  /\bunsubscribe\b/i,
];

export interface DestructiveFinding {
  stepIndex: number;
  sentence: string;
  matched: string;
}

export function findDestructiveSteps(steps: ParsedStep[]): DestructiveFinding[] {
  const findings: DestructiveFinding[] = [];
  for (const step of steps) {
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      const match = step.sentence.match(pattern);
      if (match) {
        findings.push({ stepIndex: step.index, sentence: step.sentence, matched: match[0] });
        break;
      }
    }
  }
  return findings;
}

export interface DestructiveGuardResult {
  requiresApproval: boolean;
  findings: DestructiveFinding[];
}

/**
 * Guard entry point: callers (CLI authoring flow, resolver) must call this
 * before running a test that was not yet marked `destructiveApproved`, and
 * refuse to proceed for real if `requiresApproval` is true.
 */
export function evaluateDestructiveGuard(steps: ParsedStep[], destructiveApproved: boolean): DestructiveGuardResult {
  const findings = findDestructiveSteps(steps);
  return { requiresApproval: findings.length > 0 && !destructiveApproved, findings };
}
