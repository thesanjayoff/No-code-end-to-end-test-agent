import path from "node:path";
import { chromium } from "playwright";
import type { ProjectConfig } from "../types.js";
import { assertAllowListed } from "../safety/allowlist.js";
import { runAxeScan, type AxeFinding } from "./axe.js";
import { capturePerfTiming, type PerfTiming } from "./perf.js";
import { checkLinks, type LinkCheckResult } from "./links.js";
import { compareToBaseline, approveBaseline, type VisualDiffResult } from "./visual.js";
import { PROJECTS_DIR } from "../config/env.js";

export interface ExtraChecksOptions {
  project: ProjectConfig;
  url: string;
  axe?: boolean;
  perf?: boolean;
  links?: boolean;
  visual?: boolean;
  visualName?: string;
  approveVisual?: boolean;
}

export interface ExtraChecksResult {
  url: string;
  axe?: AxeFinding[];
  perf?: PerfTiming;
  links?: LinkCheckResult[];
  visual?: VisualDiffResult;
}

function checksDir(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId, "checks");
}

/**
 * Runs the optional extra checks against a live, allow-listed page. These
 * are read-only diagnostics layered on top of a test, never a substitute
 * for one -- nothing here authors, resolves, or asserts anything.
 */
export async function runExtraChecks(opts: ExtraChecksOptions): Promise<ExtraChecksResult> {
  assertAllowListed(opts.url, opts.project);
  const browser = await chromium.launch({ headless: true });
  // @axe-core/playwright specifically requires a page created from an
  // explicit browser context (its own internal context lookup fails on the
  // browser.newPage() shortcut).
  const context = await browser.newContext();
  const page = await context.newPage();
  const result: ExtraChecksResult = { url: opts.url };

  try {
    await page.goto(opts.url, { waitUntil: "domcontentloaded" });

    if (opts.perf) {
      result.perf = await capturePerfTiming(page);
    }
    if (opts.axe) {
      result.axe = await runAxeScan(page);
    }
    if (opts.links) {
      result.links = await checkLinks(page, { maxLinks: 25, delayMs: 150 });
    }
    if (opts.visual) {
      const pathSlug = new URL(opts.url).pathname.replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "");
      const name = opts.visualName ?? (pathSlug || "home");
      const dir = checksDir(opts.project.id);
      const screenshotPath = path.join(dir, "visual", `${name}.current.png`);
      const baselinePath = path.join(dir, "visual", `${name}.baseline.png`);
      const diffPath = path.join(dir, "visual", `${name}.diff.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      if (opts.approveVisual) {
        approveBaseline(screenshotPath, baselinePath);
        result.visual = { baselineExisted: true, diffPixels: 0, totalPixels: 0, diffRatio: 0, approvedChange: true };
      } else {
        result.visual = await compareToBaseline({ screenshotPath, baselinePath, diffOutputPath: diffPath });
      }
    }
  } finally {
    await browser.close();
  }

  return result;
}
