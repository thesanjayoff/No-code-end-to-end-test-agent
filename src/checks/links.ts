import type { Page } from "playwright";

export interface LinkCheckResult {
  url: string;
  status: number | "error";
  ok: boolean;
}

async function isAllowedByRobots(baseUrl: string, targetPath: string): Promise<boolean> {
  try {
    const res = await fetch(new URL("/robots.txt", baseUrl).toString());
    if (!res.ok) return true;
    const text = await res.text();
    const disallowed = text
      .split("\n")
      .filter((l) => l.trim().toLowerCase().startsWith("disallow:"))
      .map((l) => l.split(":")[1]?.trim())
      .filter(Boolean) as string[];
    return !disallowed.some((d) => d && targetPath.startsWith(d));
  } catch {
    return true;
  }
}

/** Collects same-origin links on the current page and checks their status, respecting robots.txt and a small per-request delay. */
export async function checkLinks(page: Page, opts: { maxLinks?: number; delayMs?: number } = {}): Promise<LinkCheckResult[]> {
  const origin = new URL(page.url()).origin;
  const hrefs: string[] = await page.$$eval("a[href]", (as) => as.map((a) => (a as HTMLAnchorElement).href));
  const sameOrigin = [...new Set(hrefs)].filter((h) => h.startsWith(origin)).slice(0, opts.maxLinks ?? 25);

  const results: LinkCheckResult[] = [];
  for (const url of sameOrigin) {
    const allowed = await isAllowedByRobots(origin, new URL(url).pathname);
    if (!allowed) {
      results.push({ url, status: "error", ok: false });
      continue;
    }
    try {
      const res = await fetch(url, { method: "GET" });
      results.push({ url, status: res.status, ok: res.ok });
    } catch {
      results.push({ url, status: "error", ok: false });
    }
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
  }
  return results;
}
