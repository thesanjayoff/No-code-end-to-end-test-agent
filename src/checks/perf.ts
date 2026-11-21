import type { Page } from "playwright";

export interface PerfTiming {
  domContentLoadedMs: number;
  loadEventMs: number;
  firstContentfulPaintMs?: number;
  transferSizeBytes?: number;
}

/** Captures basic navigation performance timing for the current page via the Navigation Timing API. */
export async function capturePerfTiming(page: Page): Promise<PerfTiming> {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return {
      domContentLoadedMs: nav ? nav.domContentLoadedEventEnd - nav.startTime : 0,
      loadEventMs: nav ? nav.loadEventEnd - nav.startTime : 0,
      firstContentfulPaintMs: fcp ? fcp.startTime : undefined,
      transferSizeBytes: nav?.transferSize,
    };
  });
}
