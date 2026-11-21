import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createProject, loadProject } from "../storage/project.js";
import { authorTest } from "../authoring/author.js";
import type { TestSource } from "../parser/index.js";
import { ROOT_DIR } from "../config/env.js";
import { SAUCEDEMO_TESTS } from "./saucedemoTests.js";

export const DEMO_APP_PORT = Number(process.env.DEMO_APP_PORT ?? 4799);
export const DEMO_APP_URL = `http://localhost:${DEMO_APP_PORT}`;

export async function ensureDemoAppRunning(): Promise<void> {
  try {
    const res = await fetch(`${DEMO_APP_URL}/health`, { signal: AbortSignal.timeout(1000) });
    if (res.ok) return;
  } catch {
    /* not running yet */
  }
  console.log("Starting the BuggyMart demo app...");
  const child = spawn("npx", ["tsx", "demo-app/server.ts"], {
    cwd: ROOT_DIR,
    env: { ...process.env, DEMO_APP_PORT: String(DEMO_APP_PORT) },
    stdio: "inherit",
    shell: true,
  });
  child.unref();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(`${DEMO_APP_URL}/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      /* keep polling */
    }
  }
  throw new Error("Demo app did not come up in time.");
}

export const BUGGYMART_TESTS: TestSource[] = [
  {
    title: "Home page shows the product list",
    startUrl: "/?variant=baseline",
    environment: "local",
    tags: ["smoke"],
    steps: ["expect the Shop heading to be visible", 'expect "Wireless Mouse" to be visible'],
  },
  {
    title: "Adding a product shows it in the cart with the right total",
    startUrl: "/?variant=baseline",
    environment: "local",
    tags: ["smoke", "cart"],
    steps: [
      'click "Add to cart" for "Wireless Mouse"',
      "click the Cart link",
      'expect the cart total to show "$19.99"',
      "expect the Checkout button to be enabled",
    ],
  },
  {
    title: "Empty cart disables checkout",
    startUrl: "/cart?variant=baseline",
    environment: "local",
    tags: ["cart"],
    steps: ["expect the Checkout button to be disabled"],
  },
  {
    title: "Login with valid credentials succeeds",
    startUrl: "/login",
    environment: "local",
    tags: ["smoke", "auth"],
    steps: [
      'fill username with "standard_user"',
      'fill password with "secret_sauce"',
      "click the Log in button",
      'expect the welcome text to show "You are logged in"',
    ],
  },
  {
    title: "Login with invalid credentials shows an error",
    startUrl: "/login",
    environment: "local",
    tags: ["auth"],
    steps: [
      'fill username with "wrong_user"',
      'fill password with "wrong_pass"',
      "click the Log in button",
      'expect the login error to show "Invalid username or password"',
    ],
  },
  {
    title: "Contact form rejects an invalid email",
    startUrl: "/contact",
    environment: "local",
    tags: ["forms"],
    steps: [
      'fill name with "Jordan"',
      'fill email with "not-an-email"',
      'fill message with "Hello there"',
      "click the Send button",
      'expect the contact result to show "valid email"',
    ],
  },
];

export const TODOMVC_TESTS: TestSource[] = [
  {
    title: "Adding a todo shows it in the list",
    startUrl: "/",
    environment: "local",
    tags: ["smoke"],
    steps: ['fill "What needs to be done?" with "Buy milk"', "press Enter", 'expect "Buy milk" to be visible'],
  },
  {
    title: "Completing a todo marks it done",
    startUrl: "/",
    environment: "local",
    tags: ["smoke"],
    // "check" by name doesn't resolve here -- TodoMVC's checkbox has no
    // accessible name of its own (the label isn't associated with it via
    // for/aria-labelledby), so this intentionally needs-review step is
    // kept as a documented authoring limitation rather than reworded to
    // force a pass.
    steps: ['fill "What needs to be done?" with "Walk the dog"', "press Enter", 'check "Walk the dog"', 'expect "Walk the dog" to be visible'],
  },
  {
    title: "Adding two todos shows a count of 2 items left",
    startUrl: "/",
    environment: "local",
    tags: ["smoke"],
    steps: [
      'fill "What needs to be done?" with "Buy milk"',
      "press Enter",
      'fill "What needs to be done?" with "Walk the dog"',
      "press Enter",
      'expect "2 items left" to be visible',
    ],
  },
  {
    title: "A single todo shows the singular '1 item left'",
    startUrl: "/",
    environment: "local",
    tags: ["smoke"],
    steps: ['fill "What needs to be done?" with "Buy milk"', "press Enter", 'expect "1 item left" to be visible'],
  },
  {
    title: "The Active filter link is visible once a todo exists",
    startUrl: "/",
    environment: "local",
    tags: ["filters"],
    steps: ['fill "What needs to be done?" with "Buy milk"', "press Enter", "expect the Active link to be visible"],
  },
  {
    title: "The All filter link is visible once a todo exists",
    startUrl: "/",
    environment: "local",
    tags: ["filters"],
    steps: ['fill "What needs to be done?" with "Buy milk"', "press Enter", "expect the All link to be visible"],
  },
  {
    title: "The Completed filter link is visible once a todo exists",
    startUrl: "/",
    environment: "local",
    tags: ["filters"],
    steps: ['fill "What needs to be done?" with "Buy milk"', "press Enter", "expect the Completed link to be visible"],
  },
  {
    title: "Adding several todos keeps them all visible under All",
    startUrl: "/",
    environment: "local",
    tags: ["smoke"],
    steps: [
      'fill "What needs to be done?" with "Buy milk"',
      "press Enter",
      'fill "What needs to be done?" with "Walk the dog"',
      "press Enter",
      'fill "What needs to be done?" with "Water the plants"',
      "press Enter",
      'expect "Buy milk" to be visible',
      'expect "Walk the dog" to be visible',
      'expect "Water the plants" to be visible',
    ],
  },
  {
    title: "The input placeholder prompts for a new todo",
    startUrl: "/",
    environment: "local",
    tags: ["smoke"],
    steps: ['expect "What needs to be done?" to be visible'],
  },
];

export async function seedDemoProjects(): Promise<void> {
  await ensureDemoAppRunning();

  let project = loadProject("buggymart");
  if (!project) {
    project = createProject({
      name: "BuggyMart",
      allowedDomains: ["localhost"],
      environments: { local: { baseUrl: DEMO_APP_URL } },
      defaultEnvironment: "local",
    });
    console.log(`Created project "${project.id}".`);
  }

  for (const source of BUGGYMART_TESTS) {
    console.log(`Authoring: ${source.title}`);
    const report = await authorTest({ project, source, useAi: true });
    const failed = report.resolution.resolvedSteps.filter((s) => !s.resolutionOk);
    console.log(`  -> ${report.test.id} (${failed.length ? `${failed.length} step(s) need review` : "all steps resolved"})`);
  }

  let todomvc = loadProject("todomvc");
  if (!todomvc) {
    todomvc = createProject({
      name: "TodoMVC",
      allowedDomains: ["todomvc.com"],
      environments: { local: { baseUrl: "https://todomvc.com/examples/react/dist/" } },
      defaultEnvironment: "local",
    });
    console.log(`Created project "${todomvc.id}".`);
  }

  for (const source of TODOMVC_TESTS) {
    console.log(`Authoring: ${source.title}`);
    const report = await authorTest({ project: todomvc, source, useAi: true });
    const failed = report.resolution.resolvedSteps.filter((s) => !s.resolutionOk);
    console.log(`  -> ${report.test.id} (${failed.length ? `${failed.length} step(s) need review` : "all steps resolved"})`);
  }

  let saucedemo = loadProject("saucedemo");
  if (!saucedemo) {
    saucedemo = createProject({
      name: "SauceDemo",
      allowedDomains: ["saucedemo.com"],
      environments: { local: { baseUrl: "https://www.saucedemo.com" } },
      defaultEnvironment: "local",
    });
    console.log(`Created project "${saucedemo.id}".`);
  }

  for (const source of SAUCEDEMO_TESTS) {
    console.log(`Authoring: ${source.title}`);
    // "checkout" trips the destructive-action guard; SauceDemo's checkout
    // never charges anything real, so this seed corpus pre-approves it.
    const report = await authorTest({ project: saucedemo, source, useAi: true, destructiveApproved: true });
    const failed = report.resolution.resolvedSteps.filter((s) => !s.resolutionOk);
    console.log(`  -> ${report.test.id} (${failed.length ? `${failed.length} step(s) need review` : "all steps resolved"})`);
  }

  console.log("Seeding complete.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedDemoProjects().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
