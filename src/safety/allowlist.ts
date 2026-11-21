import type { ProjectConfig } from "../types.js";
import { PRODUCTION_LOCK } from "../config/env.js";

export class AllowListViolation extends Error {
  constructor(public url: string, public reason: string) {
    super(`Blocked navigation to ${url}: ${reason}`);
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function matchesDomain(host: string, allowed: string): boolean {
  const a = allowed.toLowerCase().replace(/^\*\./, "");
  return host === a || host.endsWith(`.${a}`);
}

/**
 * Checks a navigation target against a project's allow-list. This is the
 * single choke point every browser-driving code path (resolver, runner,
 * explorer) must call before `page.goto` or following a link.
 */
export function checkAllowListed(url: string, project: ProjectConfig): { ok: true } | { ok: false; reason: string } {
  const host = hostOf(url);
  if (!host) return { ok: false, reason: `Could not parse a hostname from "${url}".` };

  const isAllowed = project.allowedDomains.some((d) => matchesDomain(host, d));
  if (!isAllowed) {
    return {
      ok: false,
      reason: `"${host}" is not in project "${project.id}"'s allow-list (${project.allowedDomains.join(", ")}). Add it with "testwise project allow" after confirming you own or are authorized to test it.`,
    };
  }

  const isProduction = project.productionDomains.some((d) => matchesDomain(host, d));
  if (isProduction && !PRODUCTION_LOCK) {
    return {
      ok: false,
      reason: `"${host}" is marked as production. Set TESTWISE_ALLOW_PRODUCTION=true to run read-only checks against production, or use a staging environment.`,
    };
  }

  return { ok: true };
}

export function assertAllowListed(url: string, project: ProjectConfig): void {
  const result = checkAllowListed(url, project);
  if (!result.ok) throw new AllowListViolation(url, result.reason);
}
