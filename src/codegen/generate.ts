import fs from "node:fs";
import path from "node:path";
import type { ResolvedStep } from "../types.js";
import { parseSecretPlaceholder } from "../safety/secrets.js";

/**
 * Renders a step value for the generated spec. A literal is baked in as a
 * plain string, same as always. A `{{secret:name}}` placeholder is instead
 * rendered as a runtime vault lookup -- the real value is decrypted only
 * when the test actually runs, and is never written into this file, so a
 * generated spec stays safe to read, diff, and commit.
 */
function valueExpr(data: string | undefined): string {
  const name = parseSecretPlaceholder(data ?? "");
  if (!name) return JSON.stringify(data ?? "");
  return `__testwiseVault.get(${JSON.stringify(name)}) ?? (() => { throw new Error('Secret "${name}" was not found in the vault.'); })()`;
}

export interface StepMapEntry {
  stepIndex: number;
  sentence: string;
  usedAi: boolean;
  locatorStrategy?: string;
  stepTitle: string;
}

export interface GenerateResult {
  code: string;
  stepMap: StepMapEntry[];
}

function assertionLine(step: ResolvedStep, varName: string): string {
  const expected = (step.expected ?? "").replace(/'/g, "\\'");
  switch (step.action) {
    case "expect_visible":
      return `await expect(${varName}.first()).toBeVisible();`;
    case "expect_enabled":
      return `await expect(${varName}.first()).toBeEnabled();`;
    case "expect_disabled":
      return `await expect(${varName}.first()).toBeDisabled();`;
    case "expect_text":
      return `await expect(${varName}.first()).toContainText('${expected}');`;
    case "expect_value":
      return `await expect(${varName}.first()).toHaveValue('${expected}');`;
    case "expect_count":
      return `await expect(${varName}).toHaveCount(${step.expected});`;
    default:
      return `// unsupported assertion: ${step.sentence}`;
  }
}

function stepTitleFor(step: ResolvedStep): string {
  return `Step ${step.index}: ${step.sentence}`;
}

/**
 * Renders resolved steps into a readable Playwright Test file and a step
 * map that links each generated block back to the original sentence. Each
 * step runs inside its own `test.step(...)`, so the JSON reporter's nested
 * step results give true per-step pass/fail even when a later step never
 * runs. Console errors and failed/5xx network requests are captured natively
 * and attached to the test, with no LLM involvement anywhere in this file --
 * replay is pure Playwright.
 */
export function generateSpec(opts: { title: string; startUrl: string; steps: ResolvedStep[] }): GenerateResult {
  const stepMap: StepMapEntry[] = [];
  let varCounter = 0;
  const blocks: string[] = [];
  const usesVault = opts.steps.some((s) => (s.action === "fill" || s.action === "select") && !!parseSecretPlaceholder(s.data ?? ""));

  // The start URL is the test's initial navigation, mirroring the resolver:
  // emit it unless the author's own first step is already a "go to".
  if (opts.steps[0]?.action !== "goto") {
    const title = `Step 0: go to ${opts.startUrl}`;
    blocks.push(`  await test.step(${JSON.stringify(title)}, async () => {\n    await page.goto(${JSON.stringify(opts.startUrl)});\n  });`);
    stepMap.push({ stepIndex: 0, sentence: `go to ${opts.startUrl}`, usedAi: false, stepTitle: title });
  }

  for (const step of opts.steps) {
    const inner: string[] = [];
    if (!step.resolutionOk && step.kind === "action") {
      inner.push(`    throw new Error(${JSON.stringify(`Unresolved step: ${step.sentence} -- ${step.resolutionNote ?? ""}`)});`);
    } else {
      switch (step.action) {
        case "goto":
          inner.push(`    await page.goto(${JSON.stringify(step.data ?? "")});`);
          break;
        case "wait":
          inner.push(`    await page.waitForTimeout(${step.data});`);
          break;
        case "press":
          inner.push(`    await page.keyboard.press(${JSON.stringify(step.data ?? "Enter")});`);
          break;
        case "click":
        case "fill":
        case "select":
        case "check":
        case "uncheck":
        case "hover":
        case "upload": {
          varCounter += 1;
          const varName = `el${varCounter}`;
          const locatorExpr = step.locator?.code ?? `getByText(${JSON.stringify(step.targetDescription ?? "")})`;
          inner.push(`    const ${varName} = page.${locatorExpr};`);
          if (step.action === "click") inner.push(`    await ${varName}.first().click();`);
          else if (step.action === "fill") inner.push(`    await ${varName}.first().fill(${valueExpr(step.data)});`);
          else if (step.action === "select") inner.push(`    await ${varName}.first().selectOption(${valueExpr(step.data)});`);
          else if (step.action === "check") inner.push(`    await ${varName}.first().check();`);
          else if (step.action === "uncheck") inner.push(`    await ${varName}.first().uncheck();`);
          else if (step.action === "hover") inner.push(`    await ${varName}.first().hover();`);
          else if (step.action === "upload") inner.push(`    await ${varName}.first().setInputFiles(${JSON.stringify(step.data ?? "")});`);
          break;
        }
        case "expect_url": {
          if (step.data === "contain") {
            const escaped = (step.expected ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            inner.push(`    await expect(page).toHaveURL(new RegExp(${JSON.stringify(escaped)}));`);
          } else {
            inner.push(`    await expect(page).toHaveURL(${JSON.stringify(step.expected ?? "")});`);
          }
          break;
        }
        case "expect_visible":
        case "expect_enabled":
        case "expect_disabled":
        case "expect_text":
        case "expect_value":
        case "expect_count": {
          varCounter += 1;
          const varName = `assert${varCounter}`;
          const locatorExpr = step.locator?.code ?? `getByText(${JSON.stringify(step.targetDescription ?? "")})`;
          inner.push(`    const ${varName} = page.${locatorExpr};`);
          inner.push(`    ${assertionLine(step, varName)}`);
          break;
        }
        default:
          inner.push(`    // skipped unparsed step: ${step.sentence}`);
      }
    }

    const title = stepTitleFor(step);
    blocks.push(`  await test.step(${JSON.stringify(title)}, async () => {\n${inner.join("\n")}\n  });`);
    stepMap.push({ stepIndex: step.index, sentence: step.sentence, usedAi: step.usedAi, locatorStrategy: step.locator?.strategy, stepTitle: title });
  }

  const code = [
    `import { test, expect } from '@playwright/test';`,
    ...(usesVault ? [`import { SecretVault } from '../../../src/safety/secrets.js';`] : []),
    ``,
    `// Generated by Testwise. Do not hand-edit locators here --`,
    `// edit the plain-English steps and regenerate instead.`,
    ...(usesVault
      ? [`// Secrets below are looked up from the local encrypted vault at run time --`, `// never baked into this file. See: testwise secret set <name> <value>.`, `const __testwiseVault = new SecretVault();`]
      : []),
    `test('${opts.title.replace(/'/g, "\\'")}', async ({ page }, testInfo) => {`,
    `  const consoleErrors: string[] = [];`,
    `  const networkErrors: string[] = [];`,
    `  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });`,
    `  page.on('requestfailed', (req) => { networkErrors.push(\`\${req.method()} \${req.url()} - \${req.failure()?.errorText}\`); });`,
    `  page.on('response', (res) => { if (res.status() >= 500) networkErrors.push(\`\${res.status()} \${res.url()}\`); });`,
    `  try {`,
    blocks.join("\n\n"),
    `  } finally {`,
    `    await testInfo.attach('console-errors.json', { body: Buffer.from(JSON.stringify(consoleErrors)), contentType: 'application/json' });`,
    `    await testInfo.attach('network-errors.json', { body: Buffer.from(JSON.stringify(networkErrors)), contentType: 'application/json' });`,
    `  }`,
    `});`,
    ``,
  ].join("\n");

  return { code, stepMap };
}

export function writeGeneratedFiles(opts: { specPath: string; stepMapPath: string; result: GenerateResult }): void {
  fs.mkdirSync(path.dirname(opts.specPath), { recursive: true });
  fs.writeFileSync(opts.specPath, opts.result.code, "utf-8");
  fs.writeFileSync(opts.stepMapPath, JSON.stringify(opts.result.stepMap, null, 2), "utf-8");
}
