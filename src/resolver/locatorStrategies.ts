import type { Locator, Page } from "playwright";
import type { LocatorCandidate } from "../locator/rank.js";

const STOPWORDS = new Set(["the", "a", "an", "this", "that", "for", "on", "in", "my"]);

/** Common "repeated item/row" container selectors, used to scope a "click X for Y" step to the right instance. */
export const CONTEXT_CONTAINER_SELECTOR = 'li, tr, [class*="item" i], [class*="product" i], [class*="row" i], [class*="card" i]';

const ROLE_HINTS: Array<{ keywords: string[]; role: string }> = [
  { keywords: ["button"], role: "button" },
  { keywords: ["link"], role: "link" },
  { keywords: ["checkbox"], role: "checkbox" },
  { keywords: ["radio"], role: "radio" },
  { keywords: ["field", "input", "textbox", "box"], role: "textbox" },
  { keywords: ["dropdown", "select", "menu"], role: "combobox" },
  { keywords: ["tab"], role: "tab" },
  { keywords: ["heading", "title"], role: "heading" },
  { keywords: ["icon"], role: "img" },
  { keywords: ["checkout"], role: "button" },
];

function extractQuotedOrCore(description: string): { name: string; roleHint?: string } {
  const quoted = description.match(/["“]([^"”]+)["”]/);
  const roleHint = ROLE_HINTS.find((r) => r.keywords.some((k) => description.toLowerCase().includes(k)))?.role;
  if (quoted) return { name: quoted[1], roleHint };

  const words = description
    .replace(/["“”]/g, "")
    .split(/\s+/)
    .filter((w) => !STOPWORDS.has(w.toLowerCase()));
  // Drop a trailing generic noun like "button"/"link" from the accessible name guess.
  if (words.length > 1 && ROLE_HINTS.some((r) => r.keywords.includes(words[words.length - 1].toLowerCase()))) {
    words.pop();
  }
  return { name: words.join(" ") || description, roleHint };
}

function slugForTestId(description: string): string {
  return description
    .toLowerCase()
    .replace(/["“”]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Builds candidate locators for a natural-language target description, in
 * the stability order the spec requires: role+accessible-name, label,
 * test id, visible text, CSS last. Each candidate carries both a human
 * `code` string (for the generated test / diffs) and a `locate` function
 * usable during the live resolution run.
 */
export function buildLocatorCandidates(description: string): Array<LocatorCandidate & { locate: (page: Page | Locator) => Locator }> {
  const { name, roleHint } = extractQuotedOrCore(description);
  const testId = slugForTestId(name);
  const candidates: Array<LocatorCandidate & { locate: (page: Page | Locator) => Locator }> = [];

  const rolesToTry = roleHint ? [roleHint] : ["button", "link", "textbox", "checkbox", "combobox"];
  for (const role of rolesToTry) {
    candidates.push({
      strategy: "role",
      code: `getByRole('${role}', { name: '${name.replace(/'/g, "\\'")}' })`,
      description: `role=${role} name="${name}"`,
      matchCount: -1,
      locate: (p) => p.getByRole(role as any, { name, exact: false }),
    });
  }

  candidates.push({
    strategy: "label",
    code: `getByLabel('${name.replace(/'/g, "\\'")}')`,
    description: `label="${name}"`,
    matchCount: -1,
    locate: (p) => p.getByLabel(name, { exact: false }),
  });

  candidates.push({
    strategy: "placeholder",
    code: `getByPlaceholder('${name.replace(/'/g, "\\'")}')`,
    description: `placeholder="${name}"`,
    matchCount: -1,
    locate: (p) => p.getByPlaceholder(name, { exact: false }),
  });

  candidates.push({
    strategy: "testid",
    code: `getByTestId('${testId}')`,
    description: `data-testid="${testId}"`,
    matchCount: -1,
    locate: (p) => p.getByTestId(testId),
  });

  candidates.push({
    strategy: "text",
    code: `getByText('${name.replace(/'/g, "\\'")}')`,
    description: `text="${name}"`,
    matchCount: -1,
    locate: (p) => p.getByText(name, { exact: false }),
  });

  // True last resort: guess a CSS id from the description's significant
  // words. This only ever helps when it happens to match -- it's not ranked
  // above anything else and a miss just falls out during candidate scoring.
  if (testId) {
    candidates.push({
      strategy: "css",
      code: `locator('#${testId}')`,
      description: `css id="#${testId}"`,
      matchCount: -1,
      locate: (p) => p.locator(`#${testId}`),
    });
  }

  return candidates;
}
