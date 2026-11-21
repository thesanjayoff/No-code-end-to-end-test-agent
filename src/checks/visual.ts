import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

export interface VisualDiffResult {
  baselineExisted: boolean;
  diffPixels: number;
  totalPixels: number;
  diffRatio: number;
  diffImagePath?: string;
  approvedChange: boolean;
}

/**
 * Compares a fresh screenshot against a stored baseline. With no baseline,
 * the screenshot becomes the baseline (first run). Approving a diff (by
 * calling `approveBaseline`) replaces the baseline with the new screenshot.
 */
export async function compareToBaseline(opts: { screenshotPath: string; baselinePath: string; diffOutputPath: string }): Promise<VisualDiffResult> {
  if (!fs.existsSync(opts.baselinePath)) {
    fs.mkdirSync(path.dirname(opts.baselinePath), { recursive: true });
    fs.copyFileSync(opts.screenshotPath, opts.baselinePath);
    return { baselineExisted: false, diffPixels: 0, totalPixels: 0, diffRatio: 0, approvedChange: false };
  }

  const baseline = PNG.sync.read(fs.readFileSync(opts.baselinePath));
  const current = PNG.sync.read(fs.readFileSync(opts.screenshotPath));
  const { width, height } = baseline;
  if (current.width !== width || current.height !== height) {
    return { baselineExisted: true, diffPixels: width * height, totalPixels: width * height, diffRatio: 1, approvedChange: false };
  }

  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(baseline.data, current.data, diff.data, width, height, { threshold: 0.1 });
  fs.mkdirSync(path.dirname(opts.diffOutputPath), { recursive: true });
  fs.writeFileSync(opts.diffOutputPath, PNG.sync.write(diff));

  return {
    baselineExisted: true,
    diffPixels,
    totalPixels: width * height,
    diffRatio: diffPixels / (width * height),
    diffImagePath: opts.diffOutputPath,
    approvedChange: false,
  };
}

export function approveBaseline(screenshotPath: string, baselinePath: string): void {
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.copyFileSync(screenshotPath, baselinePath);
}
