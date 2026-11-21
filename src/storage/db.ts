import fs from "node:fs";
import Database from "better-sqlite3";
import { DATA_DIR, DB_PATH } from "../config/env.js";

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS tests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  start_url TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  environment TEXT NOT NULL,
  source_path TEXT NOT NULL,
  spec_path TEXT,
  step_map_path TEXT,
  destructive_approved INTEGER NOT NULL DEFAULT 0,
  quarantined INTEGER NOT NULL DEFAULT 0,
  quarantine_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  test_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL,
  browser TEXT NOT NULL,
  viewport TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  retries INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 1,
  trace_path TEXT,
  video_path TEXT,
  screenshot_paths TEXT NOT NULL DEFAULT '[]',
  console_errors TEXT NOT NULL DEFAULT '[]',
  network_errors TEXT NOT NULL DEFAULT '[]',
  step_results TEXT NOT NULL DEFAULT '[]',
  llm_calls_used INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS triage (
  run_id TEXT PRIMARY KEY,
  classification TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL,
  used_ai INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS heals (
  id TEXT PRIMARY KEY,
  test_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  before TEXT NOT NULL,
  after TEXT NOT NULL,
  before_evidence TEXT NOT NULL,
  after_evidence TEXT NOT NULL,
  rationale TEXT NOT NULL,
  auto_approvable INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT
);

CREATE TABLE IF NOT EXISTS bug_reports (
  id TEXT PRIMARY KEY,
  test_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  summary TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_usage (
  id TEXT PRIMARY KEY,
  test_id TEXT,
  purpose TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_test ON runs(test_id);
CREATE INDEX IF NOT EXISTS idx_heals_test ON heals(test_id);
`);
