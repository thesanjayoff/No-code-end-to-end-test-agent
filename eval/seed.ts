import { spawn } from "node:child_process";
import { createProject, loadProject } from "../src/storage/project.js";
import { authorTest } from "../src/authoring/author.js";
import type { TestSource } from "../src/parser/index.js";

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
  spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "demo-app/server.ts"], {
    env: { ...process.env, DEMO_APP_PORT: String(DEMO_APP_PORT) },
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
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

  const todoTests: TestSource[] = [
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
      steps: ['fill "What needs to be done?" with "Walk the dog"', "press Enter", 'check "Walk the dog"', 'expect "Walk the dog" to be visible'],
    },
  ];
  for (const source of todoTests) {
    console.log(`Authoring: ${source.title}`);
    const report = await authorTest({ project: todomvc, source, useAi: true });
    const failed = report.resolution.resolvedSteps.filter((s) => !s.resolutionOk);
    console.log(`  -> ${report.test.id} (${failed.length ? `${failed.length} step(s) need review` : "all steps resolved"})`);
  }

  console.log("Seeding complete.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDemoProjects().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
