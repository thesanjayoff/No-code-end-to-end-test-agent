#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import chalk from "chalk";
import { APP_NAME, APP_TAGLINE } from "../config/app.js";
import { createProject, listProjects, loadProject, saveProject } from "../storage/project.js";
import { authorTest, loadTestSource } from "../authoring/author.js";
import { getTest, listTests, listRuns, insertRun, listHeals, getHeal, decideHeal, healPrecision, listBugReports, llmUsageSummary } from "../storage/repo.js";
import { runTests } from "../runner/run.js";
import { triageRun } from "../triage/run.js";
import { runStabilityCheck, flakeStatsFor } from "../flake/stability.js";
import { proposeHeal, applyHeal, revertHeal, rejectHeal } from "../healer/heal.js";
import { SecretVault } from "../safety/secrets.js";
import { saveComponent, listComponents } from "../authoring/components.js";
import { explore } from "../explore/explore.js";
import { addSchedule, listSchedules, removeSchedule, startSchedulerDaemon, runScheduleNow } from "../scheduler/schedule.js";
import { toJUnitXml } from "../reports/junit.js";
import { renderHtmlReport } from "../reports/html.js";
import { getTriage } from "../storage/repo.js";
import { runExtraChecks } from "../checks/run.js";

const program = new Command();
program.name("testwise").description(`${APP_NAME} -- ${APP_TAGLINE}`).version("0.1.0");

// ---------- project ----------

const project = program.command("project").description("Manage Testwise projects (allow-listed domains, environments).");

project
  .command("create")
  .requiredOption("--name <name>", "project name")
  .requiredOption("--domain <domain>", "allow-listed domain (repeatable)", collect, [])
  .option("--production-domain <domain>", "domain to treat as production (blocked unless TESTWISE_ALLOW_PRODUCTION=true)", collect, [])
  .requiredOption("--base-url <env=url>", "environment base URL, e.g. --base-url staging=https://staging.example.com", collect, [])
  .option("--default-environment <name>", "default environment name", "staging")
  .requiredOption("--confirm-authorized", "confirms you own or are authorized to test every --domain given")
  .action((opts) => {
    const environments: Record<string, { baseUrl: string }> = {};
    for (const pair of opts.baseUrl as string[]) {
      const [env, url] = pair.split("=");
      environments[env] = { baseUrl: url };
    }
    const p = createProject({
      name: opts.name,
      allowedDomains: opts.domain,
      productionDomains: opts.productionDomain,
      environments,
      defaultEnvironment: opts.defaultEnvironment,
    });
    console.log(chalk.green(`Created project "${p.id}" with allow-list: ${p.allowedDomains.join(", ")}`));
  });

project.command("list").action(() => {
  for (const p of listProjects()) {
    console.log(`${chalk.bold(p.id)}  allow-list: ${p.allowedDomains.join(", ")}${p.productionDomains.length ? chalk.red("  [has production domains]") : ""}`);
  }
});

project
  .command("allow <projectId> <domain>")
  .description("Add a domain to a project's allow-list after confirming you own or are authorized to test it.")
  .requiredOption("--confirm-authorized", "confirms you own or are authorized to test this domain")
  .action((projectId, domain) => {
    const p = requireProject(projectId);
    p.allowedDomains.push(domain.toLowerCase());
    saveProject(p);
    console.log(chalk.green(`Added "${domain}" to project "${projectId}"'s allow-list.`));
  });

// ---------- test authoring ----------

const test = program.command("test").description("Author, inspect, and run tests.");

test
  .command("author <projectId> <sourceFile>")
  .description("Parse + resolve a plain-English test (YAML: title/startUrl/environment/tags/steps) into a deterministic Playwright test.")
  .option("--destructive-approved", "allow destructive-looking steps (delete/pay/submit/send) to actually run", false)
  .option("--headed", "run the resolution browser headed", false)
  .option("--no-ai", "disable LLM assistance during resolution")
  .action(async (projectId, sourceFile, opts) => {
    const p = requireProject(projectId);
    const source = YAML.parse(fs.readFileSync(path.resolve(sourceFile), "utf-8"));
    const report = await authorTest({ project: p, source, destructiveApproved: opts.destructiveApproved, headed: opts.headed, useAi: opts.ai !== false });

    if (report.parseWarnings.length) {
      console.log(chalk.yellow("Parse warnings:"));
      report.parseWarnings.forEach((w) => console.log(`  - ${w}`));
    }
    if (report.requiresDestructiveApproval) {
      console.log(chalk.red(`Destructive-looking steps found. Re-run with --destructive-approved after reviewing:`));
      report.destructiveFindings.forEach((f) => console.log(`  - Step ${f.stepIndex}: "${f.sentence}" (matched "${f.matched}")`));
      return;
    }

    console.log(chalk.bold(`\nTest "${report.test.id}" resolved:`));
    for (const s of report.resolution.resolvedSteps) {
      const mark = s.resolutionOk ? chalk.green("OK") : chalk.red("FAIL");
      const ai = s.usedAi ? chalk.cyan(" [AI-assisted]") : "";
      console.log(`  ${mark}  Step ${s.index}: ${s.sentence}${ai}${s.resolutionNote ? chalk.gray(`  -- ${s.resolutionNote}`) : ""}`);
    }
    if (report.resolution.injectionAlerts.length) {
      console.log(chalk.red(`\nPrompt-injection signals detected on the page (flagged, not followed):`));
      report.resolution.injectionAlerts.forEach((a) => console.log(`  - step ${a.stepIndex}: ${a.matches.join(", ")}`));
    }
    console.log(chalk.gray(`\nLLM calls used: ${report.resolution.llmCallsUsed}  (cost ~$${report.resolution.llmCostUsd.toFixed(4)})`));
    console.log(chalk.gray(`Generated: ${getTest(report.test.id)?.specPath}`));
  });

test.command("list [projectId]").action((projectId) => {
  for (const t of listTests(projectId)) {
    console.log(`${chalk.bold(t.id)}  "${t.title}"  ${t.quarantined ? chalk.magenta("[quarantined]") : ""}`);
  }
});

test.command("show <testId>").action((testId) => {
  const t = requireTest(testId);
  console.log(JSON.stringify(t, null, 2));
  const stats = flakeStatsFor(testId);
  console.log(chalk.gray(`\nRuns: ${stats.totalRuns}  pass rate: ${(stats.passRate * 100).toFixed(0)}%  flake rate: ${(stats.flakeRate * 100).toFixed(0)}%`));
});

test.command("approve-destructive <testId>").action((testId) => {
  const t = requireTest(testId);
  t.destructiveApproved = true;
  console.log(chalk.yellow(`Marked "${testId}" as destructive-approved. Re-run "testwise test author" to resolve it for real.`));
});

test
  .command("run <testIds...>")
  .option("--browser <browsers>", "comma-separated: chromium,firefox,webkit", "chromium")
  .option("--viewport <viewports>", "comma-separated: desktop,mobile", "desktop")
  .option("--headed", "run headed", false)
  .option("--retries <n>", "retries (tracked separately as flaky, not a clean pass)", "1")
  .option("--workers <n>", "parallel workers")
  .action(async (testIds: string[], opts) => {
    const tests = testIds.map((id) => requireTest(id));
    const runs = await runTests({
      tests,
      browsers: opts.browser.split(",") as any,
      viewports: opts.viewport.split(",") as any,
      headed: opts.headed,
      retries: Number(opts.retries),
      workers: opts.workers ? Number(opts.workers) : undefined,
    });
    for (const run of runs) {
      insertRun(run);
      const t = tests.find((x: (typeof tests)[number]) => x.id === run.testId)!;
      const line = `${run.status === "passed" ? chalk.green(run.status) : run.status === "flaky" ? chalk.yellow(run.status) : chalk.red(run.status)}  ${t.title} [${run.browser}/${run.viewport}] ${run.durationMs}ms`;
      console.log(line);
      if (run.status === "failed") {
        const triage = await triageRun(run, t);
        console.log(chalk.gray(`  triage: ${triage.classification} (confidence ${triage.confidence}) -- ${triage.summary}`));
      }
    }
  });

test
  .command("stability <testId>")
  .option("--iterations <n>", "number of repeated runs", "20")
  .action(async (testId, opts) => {
    const t = requireTest(testId);
    console.log(`Running "${t.title}" ${opts.iterations} times...`);
    const result = await runStabilityCheck(t, Number(opts.iterations));
    console.log(JSON.stringify({ ...result, runs: undefined }, null, 2));
    console.log(result.stable ? chalk.green("STABLE") : chalk.red(`UNSTABLE -- flake rate ${(result.flakeRate * 100).toFixed(0)}%`));
  });

// ---------- components ----------

const component = program.command("component").description('Reusable step sequences, referenced from a test with a "use <name>" step.');

component
  .command("save <projectId> <name> <stepsFile>")
  .description("stepsFile: a YAML/JSON file containing a top-level list of plain-English step sentences")
  .action((projectId, name, stepsFile) => {
    requireProject(projectId);
    const steps = YAML.parse(fs.readFileSync(path.resolve(stepsFile), "utf-8"));
    saveComponent(projectId, name, steps);
    console.log(chalk.green(`Saved component "${name}" for project "${projectId}".`));
  });

component.command("list <projectId>").action((projectId) => {
  requireProject(projectId);
  listComponents(projectId).forEach((n) => console.log(n));
});

// ---------- heals ----------

const heal = program.command("heal").description("Review and decide on proposed repairs (locator/wait only -- never assertions).");

heal.command("list [testId]").action((testId) => {
  for (const h of listHeals(testId)) {
    console.log(`${chalk.bold(h.id)}  [${h.status}]${h.autoApprovable ? chalk.cyan(" (auto-approvable)") : ""}  step ${h.stepIndex} (${h.kind})`);
    console.log(`  before: ${h.before}`);
    console.log(`  after:  ${h.after}`);
    console.log(chalk.gray(`  ${h.rationale}`));
  }
  const precision = healPrecision();
  console.log(chalk.gray(`\nHeal precision: ${(precision.precision * 100).toFixed(0)}% (${precision.approved} approved / ${precision.total} decided)`));
});

heal.command("approve <healId>").action((healId) => {
  const h = requireHeal(healId);
  const t = requireTest(h.testId);
  applyHeal(h, t);
  console.log(chalk.green(`Applied heal ${healId}.`));
});

heal.command("reject <healId>").action((healId) => {
  rejectHeal(requireHeal(healId));
  console.log(chalk.yellow(`Rejected heal ${healId}.`));
});

heal.command("revert <healId>").action((healId) => {
  const h = requireHeal(healId);
  const t = requireTest(h.testId);
  revertHeal(h, t);
  console.log(chalk.yellow(`Reverted heal ${healId}.`));
});

heal
  .command("propose <testId> <runId> <stepIndex>")
  .option("--reason <reason>", "ui_drift or flake", "ui_drift")
  .action(async (testId, runId, stepIndex, opts) => {
    const t = requireTest(testId);
    const p = requireProject(t.projectId);
    const result = await proposeHeal({ test: t, project: p, failedStepIndex: Number(stepIndex), runId, reason: opts.reason });
    if ("blocked" in result) console.log(chalk.red(`Blocked: ${result.blocked}`));
    else console.log(chalk.green(`Proposed heal ${result.id}. Review with "testwise heal list".`));
  });

// ---------- triage ----------

program
  .command("triage <runId>")
  .description("Show the triage classification for a run.")
  .action((runId) => {
    const t = getTriage(runId);
    if (!t) {
      console.log(chalk.red(`No triage recorded for run ${runId}.`));
      return;
    }
    console.log(JSON.stringify(t, null, 2));
  });

program.command("bugs [testId]").action((testId) => {
  for (const b of listBugReports(testId)) console.log(`${chalk.bold(b.id)}  step ${b.stepIndex}: ${b.summary}`);
});

// ---------- secrets ----------

const secret = program.command("secret").description("Local encrypted vault for credentials and test data.");

secret.command("set <name> <value>").option("--scope <scope>", "scope name", "global").action((name, value, opts) => {
  new SecretVault().set(name, value, opts.scope);
  console.log(chalk.green(`Stored secret "${name}" in scope "${opts.scope}".`));
});

secret.command("list").option("--scope <scope>", "scope name", "global").action((opts) => {
  new SecretVault().list(opts.scope).forEach((n) => console.log(n));
});

secret.command("delete <name>").option("--scope <scope>", "scope name", "global").action((name, opts) => {
  new SecretVault().delete(name, opts.scope);
  console.log(chalk.yellow(`Deleted secret "${name}".`));
});

// ---------- explore ----------

program
  .command("explore <projectId> <startUrl> <goal>")
  .option("--max-pages <n>", "max pages to crawl", "8")
  .action(async (projectId, startUrl, goal, opts) => {
    const p = requireProject(projectId);
    const report = await explore({ project: p, startUrl, goal, maxPages: Number(opts.maxPages) });
    console.log(report.markdownPlan);
    if (report.injectionAlerts.length) {
      console.log(chalk.red(`\nInjection signals seen during crawl (ignored, flagged only):`));
      report.injectionAlerts.forEach((a) => console.log(`  - ${a.url}: ${a.matches.join(", ")}`));
    }
  });

// ---------- schedule ----------

const schedule = program.command("schedule").description("Cron-style scheduling for test suites.");

schedule
  .command("add")
  .requiredOption("--test <testId>", "test id (repeatable)", collect, [])
  .requiredOption("--cron <expr>", "cron expression, e.g. \"0 */6 * * *\"")
  .option("--browser <browsers>", "comma-separated browsers", "chromium")
  .option("--viewport <viewports>", "comma-separated viewports", "desktop")
  .option("--webhook <url>", "webhook URL for failure notifications")
  .option("--email <address>", "email for failure notifications (requires TESTWISE_SMTP_WEBHOOK)")
  .action((opts) => {
    const s = addSchedule({
      testIds: opts.test,
      cronExpr: opts.cron,
      browsers: opts.browser.split(","),
      viewports: opts.viewport.split(","),
      webhookUrl: opts.webhook,
      notifyEmail: opts.email,
    });
    console.log(chalk.green(`Added schedule ${s.id}.`));
  });

schedule.command("list").action(() => listSchedules().forEach((s) => console.log(`${s.id}  ${s.cronExpr}  tests: ${s.testIds.join(", ")}`)));
schedule.command("remove <id>").action((id) => {
  removeSchedule(id);
  console.log(chalk.yellow(`Removed schedule ${id}.`));
});
schedule.command("start").action(() => {
  startSchedulerDaemon();
  setInterval(() => {}, 1 << 30);
});
schedule.command("run-now <id>").action(async (id) => {
  const s = listSchedules().find((x) => x.id === id);
  if (!s) return console.log(chalk.red(`No schedule ${id}.`));
  await runScheduleNow(s);
  console.log(chalk.green("Done."));
});

// ---------- webhook trigger (CI / post-deploy) ----------

program
  .command("trigger <testIds...>")
  .description("CLI trigger for CI/post-deploy hooks: runs tests and exits non-zero on failure.")
  .option("--browser <browsers>", "comma-separated browsers", "chromium")
  .action(async (testIds: string[], opts) => {
    const tests = testIds.map((id) => requireTest(id));
    const runs = await runTests({ tests, browsers: opts.browser.split(","), viewports: ["desktop"], retries: 1 });
    let failed = false;
    for (const run of runs) {
      insertRun(run);
      if (run.status === "failed") failed = true;
      console.log(`${run.status}  ${run.testId}`);
    }
    process.exit(failed ? 1 : 0);
  });

// ---------- reports ----------

const report = program.command("report").description("Export JUnit/JSON/static HTML reports.");

report
  .command("junit <runIds...>")
  .option("--out <file>", "output file", "junit.xml")
  .action((runIds, opts) => {
    // Resolve runs by scanning all tests' runs (simple, local-scale approach).
    const all = listTests().flatMap((t) => listRuns(t.id, 1000).map((r) => ({ test: t, run: r })));
    const matched = all.filter((e) => runIds.includes(e.run.id));
    fs.writeFileSync(opts.out, toJUnitXml(matched));
    console.log(chalk.green(`Wrote ${opts.out}`));
  });

report
  .command("html <projectId>")
  .option("--out <file>", "output file", "report.html")
  .action((projectId, opts) => {
    const p = requireProject(projectId);
    const tests = listTests(projectId);
    const entries = tests
      .map((t) => {
        const run = listRuns(t.id, 1)[0];
        if (!run) return undefined;
        return { test: t, run, triage: getTriage(run.id) };
      })
      .filter((e): e is NonNullable<typeof e> => !!e);
    fs.writeFileSync(opts.out, renderHtmlReport({ projectName: p.name, entries }));
    console.log(chalk.green(`Wrote ${opts.out}`));
  });

report.command("cost").action(() => {
  const summary = llmUsageSummary();
  console.log(`Total LLM spend: $${summary.totalCostUsd.toFixed(4)} across ${summary.calls} calls`);
  for (const [purpose, cost] of Object.entries(summary.byPurpose)) console.log(`  ${purpose}: $${cost.toFixed(4)}`);
});

// ---------- extra checks ----------

program
  .command("check <projectId> <url>")
  .description("Run optional extra checks (accessibility, perf, links, visual) against a live, allow-listed page.")
  .option("--axe", "run an axe-core accessibility scan")
  .option("--perf", "capture navigation performance timing")
  .option("--links", "check same-origin links (respects robots.txt)")
  .option("--visual", "compare a full-page screenshot against its stored baseline")
  .option("--approve-visual", "accept the current screenshot as the new baseline instead of diffing")
  .option("--name <name>", "baseline name for --visual (defaults to the URL path)")
  .action(async (projectId, url, opts) => {
    const p = requireProject(projectId);
    const absoluteUrl = /^https?:\/\//i.test(url) ? url : new URL(url, p.environments[p.defaultEnvironment]?.baseUrl).toString();
    const result = await runExtraChecks({
      project: p,
      url: absoluteUrl,
      axe: !!opts.axe,
      perf: !!opts.perf,
      links: !!opts.links,
      visual: !!opts.visual,
      visualName: opts.name,
      approveVisual: !!opts.approveVisual,
    });
    console.log(chalk.bold(`Checks for ${result.url}`));
    if (result.perf) {
      console.log(chalk.cyan("\nPerformance:"));
      console.log(`  DOMContentLoaded: ${result.perf.domContentLoadedMs.toFixed(0)}ms`);
      console.log(`  load: ${result.perf.loadEventMs.toFixed(0)}ms`);
      if (result.perf.firstContentfulPaintMs) console.log(`  FCP: ${result.perf.firstContentfulPaintMs.toFixed(0)}ms`);
    }
    if (result.axe) {
      console.log(chalk.cyan(`\nAccessibility: ${result.axe.length} violation type(s)`));
      result.axe.forEach((v) => console.log(`  [${v.impact ?? "?"}] ${v.id}: ${v.description} (${v.nodes} node(s))`));
    }
    if (result.links) {
      const broken = result.links.filter((l) => !l.ok);
      console.log(chalk.cyan(`\nLinks: ${result.links.length} checked, ${broken.length} broken`));
      broken.forEach((l) => console.log(`  ${chalk.red(String(l.status))} ${l.url}`));
    }
    if (result.visual) {
      if (result.visual.approvedChange) console.log(chalk.cyan("\nVisual: baseline updated."));
      else if (!result.visual.baselineExisted) console.log(chalk.cyan("\nVisual: no baseline existed; this screenshot is now the baseline."));
      else console.log(chalk.cyan(`\nVisual: ${(result.visual.diffRatio * 100).toFixed(2)}% of pixels differ from the baseline.`));
    }
  });

// ---------- serve / seed ----------

program.command("serve").action(async () => {
  await import("../server/index.js");
});

program.command("seed").action(async () => {
  const { seedDemoProjects } = await import("../demo/seed.js");
  await seedDemoProjects();
});

// ---------- helpers ----------

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function requireProject(id: string) {
  const p = loadProject(id);
  if (!p) throw new Error(`No project "${id}". Run "testwise project create" first.`);
  return p;
}

function requireTest(id: string) {
  const t = getTest(id);
  if (!t) throw new Error(`No test "${id}".`);
  return t;
}

function requireHeal(id: string) {
  const h = getHeal(id);
  if (!h) throw new Error(`No heal "${id}".`);
  return h;
}

program.parseAsync(process.argv);
