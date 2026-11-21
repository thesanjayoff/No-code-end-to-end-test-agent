import type { HealKind } from "../types.js";

const ASSERTION_TOKENS = [
  "expect(",
  "tobevisible",
  "tobeenabled",
  "tobedisabled",
  "tocontaintext",
  "tohavevalue",
  "tohavecount",
  "tohaveurl",
  "expect_visible",
  "expect_text",
  "expect_value",
  "expect_enabled",
  "expect_disabled",
  "expect_count",
  "expect_url",
];

/**
 * The healer's one hard rule: it may change HOW an element is found or WHEN
 * the test waits, and nothing else. This function is the enforcement point
 * every heal proposal must pass through before it's ever shown to the user,
 * let alone applied. It is intentionally conservative -- it refuses rather
 * than guesses when a proposed change even looks like it touches an assertion.
 */
export function isAssertionMutation(kind: HealKind, before: string, after: string): boolean {
  const haystack = `${before}\n${after}`.toLowerCase();
  return ASSERTION_TOKENS.some((t) => haystack.includes(t));
}

export interface HealGuardInput {
  kind: HealKind;
  before: string;
  after: string;
  stepAction: string;
}

const ASSERTION_ACTIONS = new Set(["expect_visible", "expect_text", "expect_value", "expect_enabled", "expect_disabled", "expect_count", "expect_url"]);

export function assertHealIsAllowed(input: HealGuardInput): { allowed: true } | { allowed: false; reason: string } {
  if (ASSERTION_ACTIONS.has(input.stepAction)) {
    return { allowed: false, reason: `Step action "${input.stepAction}" is an assertion. The healer never changes assertions, expected values, or test intent -- a failed expectation is reported as a suspected bug instead.` };
  }
  if (isAssertionMutation(input.kind, input.before, input.after)) {
    return { allowed: false, reason: "The proposed change contains assertion-like text. Refusing to heal." };
  }
  if (input.kind !== "locator" && input.kind !== "wait") {
    return { allowed: false, reason: `Unsupported heal kind "${input.kind}". Only "locator" and "wait" heals are allowed.` };
  }
  return { allowed: true };
}
