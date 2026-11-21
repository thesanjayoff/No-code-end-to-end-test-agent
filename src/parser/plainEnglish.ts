import type { ParsedStep, StepAction, StepKind } from "../types.js";

const GHERKIN_PREFIX = /^(given|when|then|and|but)\s+/i;

const GENERIC_TARGET_WORDS = new Set(["button", "link", "field", "box", "item", "it", "this", "that", "element"]);

function stripGherkin(sentence: string): { body: string; gherkin?: ParsedStep["gherkin"] } {
  const m = sentence.match(GHERKIN_PREFIX);
  if (!m) return { body: sentence };
  const kw = m[1].toLowerCase() as ParsedStep["gherkin"];
  const rest = sentence.slice(m[0].length).replace(/^I'?m?\s+/i, "").replace(/^I\s+/i, "");
  return { body: rest, gherkin: kw };
}

/** Pulls a quoted or trailing literal value out of a sentence fragment, e.g. `fill username with "bob"`. */
function extractQuoted(text: string): { value?: string; rest: string } {
  const m = text.match(/["“]([^"”]+)["”]/);
  if (!m) return { rest: text };
  return { value: m[1], rest: (text.slice(0, m.index) + text.slice((m.index ?? 0) + m[0].length)).trim() };
}

function warnIfAmbiguous(target: string | undefined, warnings: string[]): void {
  if (!target) return;
  const normalized = target.toLowerCase().trim();
  const words = normalized.split(/\s+/);
  const lastWord = words[words.length - 1]?.replace(/[^a-z]/g, "");
  const meaningfulWords = words.filter((w) => !["the", "a", "an", "this", "that"].includes(w));
  const hasQualifier = meaningfulWords.length > 1 || /["“]/.test(target);
  if (GENERIC_TARGET_WORDS.has(lastWord) && !hasQualifier) {
    warnings.push(`Ambiguous target "${target}" -- which ${lastWord}? Add a label, e.g. "the Submit button".`);
  }
}

// Matches a quoted string as one atomic token first, so a separator word
// (e.g. "to") that happens to appear *inside* a quoted label or value --
// "What needs to be done?" -- doesn't get mistaken for the real separator.
const Q = `("[^"]*"|'[^']*'|[^"']+?)`;

interface Rule {
  pattern: RegExp;
  action: StepAction;
  kind: StepKind;
  build: (m: RegExpMatchArray, sentence: string) => Partial<ParsedStep>;
}

const RULES: Rule[] = [
  {
    pattern: /^(go to|open|navigate to|visit)\s+(.+)$/i,
    action: "goto",
    kind: "action",
    build: (m) => ({ data: m[2].trim().replace(/^["“]|["”]$/g, "") }),
  },
  {
    pattern: new RegExp(`^(fill|type|enter)\\s+${Q}\\s+(with|as|to)\\s+(.+)$`, "i"),
    action: "fill",
    kind: "action",
    build: (m) => ({ targetDescription: extractQuoted(m[2]).value ?? m[2].trim(), data: extractQuoted(m[4]).value ?? m[4].trim() }),
  },
  {
    pattern: new RegExp(`^(type|enter)\\s+${Q}\\s+(into|in)\\s+(.+)$`, "i"),
    action: "fill",
    kind: "action",
    build: (m) => ({ targetDescription: m[4].trim(), data: extractQuoted(m[2]).value ?? m[2].trim() }),
  },
  {
    pattern: new RegExp(`^(select|choose|pick)\\s+${Q}\\s+(from|in|for)\\s+(.+)$`, "i"),
    action: "select",
    kind: "action",
    build: (m) => ({ targetDescription: m[4].trim(), data: extractQuoted(m[2]).value ?? m[2].trim() }),
  },
  {
    pattern: /^uncheck\s+(.+)$/i,
    action: "uncheck",
    kind: "action",
    build: (m) => ({ targetDescription: m[1].trim() }),
  },
  {
    pattern: /^check\s+(.+)$/i,
    action: "check",
    kind: "action",
    build: (m) => ({ targetDescription: m[1].trim() }),
  },
  {
    pattern: new RegExp(`^upload\\s+${Q}\\s+(?:to|into)\\s+(.+)$`, "i"),
    action: "upload",
    kind: "action",
    build: (m) => ({ data: extractQuoted(m[1]).value ?? m[1].trim(), targetDescription: m[2].trim() }),
  },
  {
    pattern: /^upload\s+(.+)$/i,
    action: "upload",
    kind: "action",
    build: (m) => ({ data: extractQuoted(m[1]).value ?? m[1].trim() }),
  },
  {
    pattern: /^hover (over|on)\s+(.+)$/i,
    action: "hover",
    kind: "action",
    build: (m) => ({ targetDescription: m[2].trim() }),
  },
  {
    pattern: /^press\s+(.+)$/i,
    action: "press",
    kind: "action",
    build: (m) => ({ data: m[1].trim() }),
  },
  {
    pattern: /^wait\s+(?:for\s+)?(\d+)\s*(ms|milliseconds|seconds|s)?$/i,
    action: "wait",
    kind: "action",
    build: (m) => {
      const n = Number(m[1]);
      const unit = (m[2] ?? "ms").toLowerCase();
      const ms = unit.startsWith("s") ? n * 1000 : n;
      return { data: String(ms) };
    },
  },
  {
    // Disambiguates a repeated item, e.g. `click "Add to cart" for "Wireless Mouse"`:
    // scopes the search to whichever item/row contains the context text.
    pattern: new RegExp(`^(click|tap)\\s+${Q}\\s+for\\s+${Q}$`, "i"),
    action: "click",
    kind: "action",
    build: (m) => ({ targetDescription: extractQuoted(m[2]).value ?? m[2].trim(), contextDescription: extractQuoted(m[3]).value ?? m[3].trim() }),
  },
  {
    pattern: /^(click|tap|press)(?:\s+on)?\s+(.+)$/i,
    action: "click",
    kind: "action",
    build: (m) => ({ targetDescription: m[2].trim() }),
  },
  {
    pattern: /^expect\s+the\s+url\s+to\s+(be|contain)\s+(.+)$/i,
    action: "expect_url",
    kind: "assertion",
    build: (m) => ({ data: m[1].toLowerCase(), expected: extractQuoted(m[2]).value ?? m[2].trim() }),
  },
  {
    pattern: /^expect\s+(\d+)\s+(.+)$/i,
    action: "expect_count",
    kind: "assertion",
    build: (m) => ({ targetDescription: m[2].trim(), expected: m[1] }),
  },
  {
    pattern: /^expect\s+(.+?)\s+to\s+(be\s+)?(visible|present|shown)$/i,
    action: "expect_visible",
    kind: "assertion",
    build: (m) => ({ targetDescription: m[1].trim() }),
  },
  {
    pattern: /^expect\s+(.+?)\s+to\s+be\s+enabled$/i,
    action: "expect_enabled",
    kind: "assertion",
    build: (m) => ({ targetDescription: m[1].trim() }),
  },
  {
    pattern: /^expect\s+(.+?)\s+to\s+be\s+disabled$/i,
    action: "expect_disabled",
    kind: "assertion",
    build: (m) => ({ targetDescription: m[1].trim() }),
  },
  {
    pattern: /^expect\s+(.+?)\s+to\s+have\s+value\s+(.+)$/i,
    action: "expect_value",
    kind: "assertion",
    build: (m) => ({ targetDescription: m[1].trim(), expected: extractQuoted(m[2]).value ?? m[2].trim() }),
  },
  {
    pattern: /^expect\s+(.+?)\s+to\s+(show|display|contain|say|have\s+text)\s+(.+)$/i,
    action: "expect_text",
    kind: "assertion",
    build: (m) => ({ targetDescription: m[1].trim(), expected: extractQuoted(m[3]).value ?? m[3].trim() }),
  },
];

/** Splits "expect X to show A and the Pay button to be enabled" into two assertion clauses. */
function splitCompoundExpect(body: string): string[] {
  if (!/^expect\s+/i.test(body)) return [body];
  const parts = body.split(/\s+and\s+(?=the\s|[a-z0-9"“])/i);
  if (parts.length <= 1) return [body];
  return parts.map((p, i) => (i === 0 || /^expect\b/i.test(p) ? p : `expect ${p}`));
}

export function parseSentence(rawSentence: string, index: number): ParsedStep[] {
  const trimmed = rawSentence.trim().replace(/\.$/, "");
  const { body, gherkin } = stripGherkin(trimmed);
  const clauses = splitCompoundExpect(body);

  return clauses.map((clause, clauseIdx) => {
    const warnings: string[] = [];
    let matched: Rule | undefined;
    let m: RegExpMatchArray | null = null;
    for (const rule of RULES) {
      m = clause.match(rule.pattern);
      if (m) {
        matched = rule;
        break;
      }
    }

    const useComponentMatch = clause.match(/^use\s+(?:component\s+)?["“]?([a-z0-9 _-]+?)["”]?$/i);

    const base: ParsedStep = {
      index: clauseIdx === 0 ? index : index + clauseIdx * 0.1,
      sentence: rawSentence.trim(),
      kind: "action",
      action: "unknown",
      warnings,
      gherkin,
    };

    if (useComponentMatch) {
      base.kind = "component";
      base.componentName = useComponentMatch[1].trim();
      return base;
    }

    if (!matched || !m) {
      warnings.push(`Could not confidently parse step "${clause}". It will need manual review before resolving.`);
      base.targetDescription = clause;
      return base;
    }

    const built = matched.build(m, clause);
    Object.assign(base, built);
    base.action = matched.action;
    base.kind = matched.kind;
    warnIfAmbiguous(base.targetDescription, warnings);
    return base;
  });
}
