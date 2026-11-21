#!/usr/bin/env node
// Thin launcher so `testwise` works as an installed binary
// (`npm link` / `npm install -g`). Runs the built CLI if present,
// otherwise falls back to tsx against the TypeScript source so a fresh
// clone works before its first `npm run build`.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const builtCli = path.join(root, "dist", "cli", "index.js");
const args = process.argv.slice(2);

// shell: true on Windows joins argv with plain spaces (no auto-quoting), so
// any argument containing a space -- including this repo's own path -- has
// to be quoted by hand.
const q = (s) => (/\s/.test(s) ? `"${s}"` : s);

const child = existsSync(builtCli)
  ? spawn(process.execPath, [builtCli, ...args], { stdio: "inherit" })
  : spawn("npx", ["tsx", q(path.join(root, "src", "cli", "index.ts")), ...args.map(q)], { stdio: "inherit", shell: true, cwd: root });

child.on("exit", (code) => process.exit(code ?? 1));
