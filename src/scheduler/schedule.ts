import fs from "node:fs";
import path from "node:path";
import cron from "node-cron";
import { nanoid } from "nanoid";
import { DATA_DIR } from "../config/env.js";
import { getTest } from "../storage/repo.js";
import { runTests } from "../runner/run.js";
import { insertRun } from "../storage/repo.js";
import { triageRun } from "../triage/run.js";
import { notify } from "./notify.js";

const SCHEDULES_FILE = path.join(DATA_DIR, "schedules.json");

export interface Schedule {
  id: string;
  testIds: string[];
  cronExpr: string;
  browsers: Array<"chromium" | "firefox" | "webkit">;
  viewports: Array<"desktop" | "mobile">;
  webhookUrl?: string;
  notifyEmail?: string;
  createdAt: string;
}

function readAll(): Schedule[] {
  if (!fs.existsSync(SCHEDULES_FILE)) return [];
  return JSON.parse(fs.readFileSync(SCHEDULES_FILE, "utf-8"));
}

function writeAll(schedules: Schedule[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
}

export function addSchedule(input: Omit<Schedule, "id" | "createdAt">): Schedule {
  if (!cron.validate(input.cronExpr)) throw new Error(`Invalid cron expression: "${input.cronExpr}"`);
  const schedule: Schedule = { ...input, id: nanoid(8), createdAt: new Date().toISOString() };
  const all = readAll();
  all.push(schedule);
  writeAll(all);
  return schedule;
}

export function listSchedules(): Schedule[] {
  return readAll();
}

export function removeSchedule(id: string): void {
  writeAll(readAll().filter((s) => s.id !== id));
}

export async function runScheduleNow(schedule: Schedule): Promise<void> {
  const tests = schedule.testIds.map(getTest).filter((t): t is NonNullable<typeof t> => !!t);
  if (tests.length === 0) return;

  const runs = await runTests({ tests, browsers: schedule.browsers, viewports: schedule.viewports, retries: 1 });
  const failures: string[] = [];
  for (const run of runs) {
    insertRun(run);
    const test = tests.find((t) => t.id === run.testId)!;
    const triage = await triageRun(run, test);
    if (run.status === "failed") failures.push(`"${test.title}" failed [${triage.classification}]: ${triage.summary}`);
  }

  const summary =
    failures.length === 0
      ? `All ${runs.length} scheduled test(s) passed.`
      : `${failures.length}/${runs.length} scheduled test(s) failed:\n- ${failures.join("\n- ")}`;

  await notify({ webhookUrl: schedule.webhookUrl, email: schedule.notifyEmail, subject: `Testwise schedule ${schedule.id}`, message: summary });
}

/** Long-running process: registers every saved schedule as a node-cron job. Intended for `testwise schedule start`. */
export function startSchedulerDaemon(): void {
  const schedules = readAll();
  for (const schedule of schedules) {
    cron.schedule(schedule.cronExpr, () => {
      runScheduleNow(schedule).catch((err) => console.error(`Schedule ${schedule.id} failed:`, err));
    });
    console.log(`Registered schedule ${schedule.id} (${schedule.cronExpr}) for ${schedule.testIds.length} test(s).`);
  }
  console.log(`${schedules.length} schedule(s) active. Press Ctrl+C to stop.`);
}
