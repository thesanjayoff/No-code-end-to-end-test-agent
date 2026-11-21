import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { APP_NAME } from "../config/app.js";
import { ROOT_DIR, SERVER_PORT } from "../config/env.js";
import { createProject, listProjects, loadProject, saveProject } from "../storage/project.js";
import { authorTest, loadTestSource } from "../authoring/author.js";
import {
  getTest,
  listTests,
  listRuns,
  getRun,
  insertRun,
  listHeals,
  getHeal,
  listBugReports,
  llmUsageSummary,
  getTriage,
  healPrecision,
} from "../storage/repo.js";
import { runTests } from "../runner/run.js";
import { triageRun } from "../triage/run.js";
import { flakeStatsFor, runStabilityCheck } from "../flake/stability.js";
import { proposeHeal, applyHeal, revertHeal, rejectHeal } from "../healer/heal.js";
import { explore } from "../explore/explore.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

function asyncHandler(fn: (req: express.Request, res: express.Response) => Promise<void>) {
  return (req: express.Request, res: express.Response) => {
    fn(req, res).catch((err) => {
      console.error(err);
      res.status(400).json({ error: err?.message ?? String(err) });
    });
  };
}

// ---------- projects ----------

app.get("/api/projects", (_req, res) => res.json(listProjects()));

app.post(
  "/api/projects",
  asyncHandler(async (req, res) => {
    const { name, allowedDomains, environments, defaultEnvironment, productionDomains, confirmAuthorized } = req.body;
    if (!confirmAuthorized) {
      res.status(400).json({ error: "confirmAuthorized must be true: you must confirm you own or are authorized to test every listed domain." });
      return;
    }
    const project = createProject({ name, allowedDomains, environments, defaultEnvironment, productionDomains });
    res.json(project);
  })
);

app.get("/api/projects/:id", (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  res.json(p);
});

app.post("/api/projects/:id/allow", (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  if (!req.body.confirmAuthorized) return res.status(400).json({ error: "confirmAuthorized must be true" });
  p.allowedDomains.push(String(req.body.domain).toLowerCase());
  saveProject(p);
  res.json(p);
});

// ---------- tests ----------

app.get("/api/tests", (req, res) => res.json(listTests(req.query.projectId as string | undefined)));

app.get("/api/tests/:id", (req, res) => {
  const t = getTest(req.params.id);
  if (!t) return res.status(404).json({ error: "not found" });
  res.json(t);
});

app.get("/api/tests/:id/source", (req, res) => {
  const t = getTest(req.params.id);
  if (!t) return res.status(404).json({ error: "not found" });
  res.json(loadTestSource(t.projectId, t.id));
});

app.get("/api/tests/:id/spec", (req, res) => {
  const t = getTest(req.params.id);
  if (!t?.specPath || !fs.existsSync(t.specPath)) return res.status(404).json({ error: "not generated yet" });
  res.type("text/plain").send(fs.readFileSync(t.specPath, "utf-8"));
});

app.get("/api/tests/:id/stepmap", (req, res) => {
  const t = getTest(req.params.id);
  if (!t?.stepMapPath || !fs.existsSync(t.stepMapPath)) return res.status(404).json({ error: "not generated yet" });
  res.json(JSON.parse(fs.readFileSync(t.stepMapPath, "utf-8")));
});

app.post(
  "/api/tests/author",
  asyncHandler(async (req, res) => {
    const { projectId, source, existingTestId, destructiveApproved, headed, useAi } = req.body;
    const project = loadProject(projectId);
    if (!project) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    const report = await authorTest({ project, source, existingTestId, destructiveApproved, headed, useAi });
    res.json(report);
  })
);

app.get("/api/tests/:id/runs", (req, res) => res.json(listRuns(req.params.id)));
app.get("/api/tests/:id/flake", (req, res) => res.json(flakeStatsFor(req.params.id)));
app.get("/api/tests/:id/heals", (req, res) => res.json(listHeals(req.params.id)));
app.get("/api/tests/:id/bugs", (req, res) => res.json(listBugReports(req.params.id)));

app.post(
  "/api/tests/:id/run",
  asyncHandler(async (req, res) => {
    const t = getTest(String(req.params.id));
    if (!t) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const { browsers = ["chromium"], viewports = ["desktop"], headed = false, retries = 1, workers } = req.body ?? {};
    const runs = await runTests({ tests: [t], browsers, viewports, headed, retries, workers });
    for (const run of runs) {
      insertRun(run);
      if (run.status === "failed" || run.status === "flaky") await triageRun(run, t);
    }
    res.json(runs);
  })
);

app.post(
  "/api/tests/:id/stability",
  asyncHandler(async (req, res) => {
    const t = getTest(String(req.params.id));
    if (!t) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const result = await runStabilityCheck(t, Number(req.body?.iterations ?? 20));
    res.json({ ...result, runs: undefined });
  })
);

// ---------- runs / triage ----------

app.get("/api/runs/:id", (req, res) => {
  const r = getRun(req.params.id);
  if (!r) return res.status(404).json({ error: "not found" });
  res.json(r);
});

app.get("/api/runs/:id/triage", (req, res) => {
  const t = getTriage(req.params.id);
  if (!t) return res.status(404).json({ error: "not found" });
  res.json(t);
});

app.get(
  "/api/runs/:id/trace",
  asyncHandler(async (req, res) => {
    const run = getRun(String(req.params.id));
    if (!run?.tracePath || !fs.existsSync(run.tracePath)) {
      res.status(404).json({ error: "no trace for this run" });
      return;
    }
    res.download(run.tracePath);
  })
);

// ---------- comparison ----------

app.get("/api/tests/:id/compare/:runId", (req, res) => {
  const runs = listRuns(req.params.id, 1000);
  const current = runs.find((r) => r.id === req.params.runId);
  if (!current) return res.status(404).json({ error: "run not found" });
  const idx = runs.findIndex((r) => r.id === req.params.runId);
  const lastGood = runs.slice(idx + 1).find((r) => r.status === "passed");
  res.json({
    current,
    lastGood,
    stepDiff: diffSteps(lastGood?.stepResults ?? [], current.stepResults),
  });
});

function diffSteps(before: { index: number; status: string }[], after: { index: number; status: string }[]) {
  const beforeMap = new Map(before.map((s) => [s.index, s.status]));
  return after.map((s) => ({ index: s.index, before: beforeMap.get(s.index) ?? "n/a", after: s.status, changed: beforeMap.get(s.index) !== s.status }));
}

// ---------- heals ----------

app.post(
  "/api/heals/propose",
  asyncHandler(async (req, res) => {
    const { testId, runId, stepIndex, reason } = req.body;
    const test = getTest(testId);
    if (!test) {
      res.status(404).json({ error: "test not found" });
      return;
    }
    const project = loadProject(test.projectId)!;
    const result = await proposeHeal({ test, project, runId, failedStepIndex: stepIndex, reason: reason ?? "ui_drift" });
    res.json(result);
  })
);

app.post("/api/heals/:id/approve", (req, res) => {
  const h = getHeal(req.params.id);
  if (!h) return res.status(404).json({ error: "not found" });
  const t = getTest(h.testId)!;
  applyHeal(h, t);
  res.json({ ok: true });
});

app.post("/api/heals/:id/reject", (req, res) => {
  const h = getHeal(req.params.id);
  if (!h) return res.status(404).json({ error: "not found" });
  rejectHeal(h);
  res.json({ ok: true });
});

app.post("/api/heals/:id/revert", (req, res) => {
  const h = getHeal(req.params.id);
  if (!h) return res.status(404).json({ error: "not found" });
  const t = getTest(h.testId)!;
  revertHeal(h, t);
  res.json({ ok: true });
});

app.get("/api/heals", (req, res) => res.json(listHeals(req.query.testId as string | undefined)));
app.get("/api/heals/precision", (_req, res) => res.json(healPrecision()));

// ---------- bugs / llm usage ----------

app.get("/api/bugs", (req, res) => res.json(listBugReports(req.query.testId as string | undefined)));
app.get("/api/llm-usage", (_req, res) => res.json(llmUsageSummary()));

// ---------- explore ----------

app.post(
  "/api/explore",
  asyncHandler(async (req, res) => {
    const { projectId, startUrl, goal, maxPages } = req.body;
    const project = loadProject(projectId);
    if (!project) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    const report = await explore({ project, startUrl, goal, maxPages });
    res.json(report);
  })
);

// ---------- dashboard ----------

app.get("/api/dashboard", (_req, res) => {
  const projects = listProjects();
  const data = projects.map((p) => {
    const tests = listTests(p.id);
    const withStats = tests.map((t) => ({ test: t, flake: flakeStatsFor(t.id), lastRun: listRuns(t.id, 1)[0] }));
    return { project: p, tests: withStats };
  });
  res.json(data);
});

// ---------- static web UI (production build) ----------

const webDist = path.join(ROOT_DIR, "web", "dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}

app.listen(SERVER_PORT, () => {
  console.log(`${APP_NAME} API listening on http://localhost:${SERVER_PORT}`);
  if (!fs.existsSync(webDist)) {
    console.log(`(web UI not built -- run "npm run web:build", or "npm run web:dev" for the dev server on its own port)`);
  }
});
