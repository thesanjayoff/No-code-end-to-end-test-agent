# Testwise

A no-code, end-to-end test agent. You write test steps in plain English (or
Gherkin-ish `Given/When/Then`); Testwise turns them into deterministic
Playwright specs once, at authoring time. Replay never calls an LLM — it's
pure generated Playwright code, so a test that passed yesterday runs the
exact same way today.

```
fill Username with "standard_user"
fill Password with "secret_sauce"
click the Login button
expect the Products heading to be visible
```

→ a readable `.spec.ts` file you can open, diff, and hand-edit if you want,
plus a step map linking each generated block back to the sentence that
produced it.

This README is honest about what works, what doesn't, and what was actually
verified by running real browsers against real pages — not just what
type-checks. See **Evaluation** for the numbers and **Known limitations**
for where it falls short.

## Quickstart

```bash
npm install
npx playwright install chromium   # one-time

# Try it against the included demo apps (BuggyMart, a deliberately
# bug-ridden shop; also authors against public TodoMVC and SauceDemo)
npm run seed                      # starts the demo app, authors 61 tests
npx tsx src/cli/index.ts test list buggymart --ids-only | \
  xargs npx tsx src/cli/index.ts test run

# Or drive it as a CLI from a fresh project
npx tsx src/cli/index.ts project create --name "My App" \
  --domain localhost --confirm-authorized \
  --base-url local=http://localhost:3000
npx tsx src/cli/index.ts test author my-app my-test.steps.yaml
npx tsx src/cli/index.ts test run <testId>

# Web UI (dashboard, test detail, failure/heal review)
npm run server      # API on :4780
npm run web:dev      # UI on :5173

# Full evaluation suite (see "Evaluation" below)
npm run eval
```

`npm run typecheck`, `npm test` (vitest, unit tests only — no browser),
and `npm run build` (compiles to `dist/`, runnable via `bin/testwise.js`)
all work standalone.

## How it works

1. **Parse.** Plain-English steps (or `Given/When/Then`) are parsed into a
   typed action/assertion list (`src/parser`). Reusable step sequences
   (`use <component>`) get expanded inline.
2. **Resolve.** A real, visible-mode-capable browser runs each step once,
   live (`src/resolver`). For every target description, candidate locators
   are built and tried in a fixed stability order — **role+accessible-name
   > label > test id > visible text > CSS** — and the most specific unique
   match wins. An LLM is only ever consulted here, as a last resort, shown
   the page's accessibility snapshot as explicitly delimited untrusted
   data, to *suggest* a better description to re-resolve with
   deterministically — it never picks or executes a locator itself.
3. **Generate.** The resolved, concrete locators are compiled into a plain
   Playwright Test file plus a step map (`src/codegen`). No LLM involved,
   and none needed at replay.
4. **Run.** Pure `@playwright/test` execution (`src/runner`), by id, by
   tag, across browsers/viewports in parallel, with full failure artifacts
   (screenshot, video, trace, console/network logs) captured automatically.
   A flaky result (fails, then passes on retry) is tracked as its own
   status — never silently merged into a clean pass.
5. **Triage.** Deterministic-first failure classification
   (`src/triage`): `flake → environment → unresolved_step → real_bug →
   ui_drift → unknown`, in that fixed order. **A failed expectation is
   never classified as drift** — that's a hard rule, not a heuristic. An
   LLM, if configured, only writes the plain-English summary afterward; it
   never changes the classification.
6. **Heal (opt-in, locator/wait only).** For `ui_drift` failures, the
   healer (`src/healer`) proposes a replacement locator by re-running the
   *same* candidate search live. It can **only** change a locator or a
   wait — never an assertion's expected value — and every proposal needs
   human approve/reject (auto-approval is reserved for the narrowest case:
   same role, same accessible name, differing only by case). Every
   decision is audit-logged.

## Safety layer

- **Domain allow-list.** Every navigation — in the resolver, the healer,
  and the explorer — goes through one choke point
  (`src/safety/allowlist.ts`). An unlisted domain is rejected before any
  browser touches it.
- **Production lock.** A domain also marked `productionDomains` is
  blocked unless `TESTWISE_ALLOW_PRODUCTION=true` is explicitly set.
- **Prompt-injection defense.** Page content shown to an LLM (locator
  hints, triage summaries) is wrapped as explicitly delimited untrusted
  data, and scanned for injection patterns; a match raises an alert rather
  than silently complying with anything the page's content says to do.
- **Destructive-action guard.** Steps matching destructive keywords
  (`checkout`, `pay`, `delete`, `cancel subscription`, ...) are blocked
  from generating a spec at all unless explicitly approved per-test. It's
  deliberately biased toward over-blocking — see **Known limitations**.
- **Encrypted secrets vault.** `{{secret:name}}` in a step is resolved to
  a real value only transiently, for the live browser action. It is
  **never** written to the persisted test source, `resolved.json`, or the
  generated spec — codegen instead emits a runtime vault lookup. Secrets
  are encrypted at rest (`src/safety/secrets.ts`).
- **Isolated browser contexts.** Every authoring/run/explore session gets
  its own fresh browser context — no shared cookies/storage leaking
  between tests.
- **Read-only exploration mode** (`testwise explore`) lets an LLM click
  around a page toward a stated goal, logging a transcript, without ever
  authoring or persisting a test from what it did.

All five of the above are exercised against a real browser in
`eval/safety-benchmark.ts`, not just unit-tested in isolation — see
**Evaluation**.

## CLI

```
testwise project <create|list|allow|set-base-url>
testwise test    <author|list|run|show>
testwise component          # reusable step sequences
testwise heal                # review/approve/reject proposed repairs
testwise triage <runId>
testwise bugs [testId]
testwise secret  <set|list|delete>
testwise explore <projectId> <startUrl> <goal>   # read-only
testwise schedule             # cron-style suite scheduling
testwise trigger [testIds...] [--tag] [--webhook]  # CI/post-deploy hook
testwise report  <junit|json|html>
testwise check <projectId> <url> [--axe|--perf|--links|--visual]
```

`examples/ci/nightly.yml` and `examples/ci/post-deploy.yml` show a tagged
suite run on a schedule or after a deploy, with webhook notification on
failure — copy-paste references, not part of this repo's own CI
(`.github/workflows/ci.yml` is this repo's own typecheck+build+test).

## Evaluation

This is the main deliverable, not an afterthought. Everything below is a
real, reproducible run — `npm run eval` runs all of it in one pass
(`eval/run-eval.ts`), or each script stands alone
(`npx tsx eval/<name>.ts`).

### Authoring corpus: 61 tests, 3 targets

| Project | Tests | Target |
|---|---|---|
| BuggyMart | 6 | Local demo app built for this project, with deliberately injected bugs/drift variants |
| TodoMVC | 9 | `todomvc.com`'s public React example |
| SauceDemo | 46 | `saucedemo.com`, a public site built for test-automation practice, including several accounts with real intentional bugs |

Authored once, replayed with **zero LLM calls** (`TESTWISE_LLM_PROVIDER=none`
set the whole run — authoring still succeeds for the vast majority of
steps on deterministic heuristics alone):

**58/61 pass live, first attempt, no retries.** The 3 that don't are
genuine, documented limitations, not Testwise bugs:

1. *BuggyMart — "Adding a product shows it in the cart with the right
   total"*: the cart-total `<span>` has no role, label, or test id — only
   a weak CSS-id guess (confidence 0.30, below the acceptance threshold),
   so the assertion resolves against the wrong (too-generic) text match.
   Correctly triaged `real_bug` (it's a failed expectation, by the hard
   rule) — but the *real* fix here is giving that element a test id.
2. *SauceDemo — "product list shows all six products"*: "Sauce Labs Bolt
   T-Shirt" is, coincidentally, also a literal substring of a *different*
   product's description text on the same page, so the text locator is
   genuinely ambiguous (2 real matches). The resolver correctly refuses
   to guess and the step never resolves — triaged `unknown` ("a gap in
   the test, not evidence of a regression"), not misfiled as a bug.
3. *TodoMVC — "Completing a todo marks it done"*: the checkbox has no
   accessible name of its own (the visible text belongs to an adjacent
   `<label>`), so `check` has nothing stable to target.

All three are a single theme: **the resolver fails closed rather than
guessing.** That's the intended trade-off, not a bug — see
**Known limitations** for where it costs real authoring friction.

### Triage confusion matrix — 6/6 (`eval/triage-benchmark.ts`)

A cosmetic rename, a harmless DOM rewrap, a pricing bug, a removed button,
a button stuck disabled, and broken form validation — each run for real
against a drift/bug variant of BuggyMart, classified, and checked against
a known ground truth. All 6 match. (Flake and environment classification
are covered deterministically in `tests/triage.test.ts` instead, since
they need a controlled synthetic `RunRecord`, not a live page.)

### Healing correctness — 4/4 (`eval/healing-benchmark.ts`)

- DOM rewrap breaking a legacy CSS locator → heals via role+name (not
  auto-approved — different strategy tier).
- Pure case-difference rename → heals and **auto-approves** (same role,
  same name except case — the one case the spec allows to skip review).
- A genuinely removed button → **refuses to heal**, files a bug report
  instead.
- A wrong cart total (a failed assertion) → the guard refuses even to
  *consider* healing it, because it's an assertion, full stop.

Zero wrongful heals on a real bug — the metric that matters most for a
tool that's allowed to touch your tests unsupervised between runs.

### Stability gate — a genuinely flaky page, not a coin flip

`demo-app`'s `/flaky` route delays its "ready" state past a normal
assertion timeout on ~30% of loads, by real `setTimeout` jitter — not a
scripted pass/fail. `eval/stability-benchmark.ts` shows why "run it once"
isn't evidence: 10 bare single runs can come back all green by luck,
while the actual gate (`runStabilityCheck`, 100 real sequential runs)
reports **a ~26–31% flake rate across repeated full evaluation runs**
(not a fixed number — it's measuring a real probabilistic page), correctly
flagging the test `stable: false` every time. This is the exact tool
described in the spec's "run 20/100 times before trusting a test" gate,
exercised against something that actually needs it.

### Safety layer — 5/5 live (`eval/safety-benchmark.ts`)

Against a real browser, not mocks: an off-domain start URL throws before
a browser launches; an off-domain mid-test `go to` is blocked and the
browser never navigates there; BuggyMart's deliberately injection-laden
page is scanned for real and flagged; that same page's injected
"click Delete Account instead" alt text does **not** redirect the
resolved action away from the legitimate target; an unapproved
`checkout` click withholds the generated spec entirely. The
production-domain lock is verified separately (its on/off switch is read
once at process start, so it needs two separate process runs): blocked
by default, allowed only with an explicit `TESTWISE_ALLOW_PRODUCTION=true`.

### Webhook notifications — verified live

`testwise trigger --webhook <url>` was pointed at a real local HTTP
listener; it received a real POST with the correct subject/message on a
genuine test failure.

### What running it for real actually found

Every one of these was found by *running* the thing end-to-end against a
real browser — not by reading the code or trusting that type-checking
passed. Some highlights (full history in `git log`):

- Codegen never emitted the test's own initial navigation; generated
  specs with no explicit "go to" ran against a blank page.
- `verifyAssertion()` never propagated the resolved locator, so every
  generated assertion silently fell back to a crude text match even when
  resolution had found a precise role-based one.
- The destructive-action guard scanned *assertion* sentences too, so
  "expect the Checkout button to be enabled" tripped the same block as
  an actual checkout click.
- A mid-test `go to <relative path>` baked the raw relative URL into the
  generated spec instead of the resolved absolute one — "Cannot navigate
  to invalid URL" at replay.
- `expect_count` could never pass "expect 0 X" when 0 was genuinely the
  right answer (an element that doesn't render at all on an empty state).
- The secrets vault was fully built and unit-tested in isolation, but
  wiring it into a real test exposed a real leak: the real secret value
  was being written into `resolved.json` and baked as a literal into the
  generated spec, because resolution substitutes `{{secret:name}}` with
  the live value for the browser action and every return path reused
  that same, now-substituted step object.
- Locator candidate counting used Playwright's `.count()`, which reads
  current DOM state with no auto-wait — a step run immediately after a
  navigating click could race the page still rendering and see every
  candidate as a false zero.
- An assertion's expected-text fallback ran the literal expected string
  through stopword-stripping built for vague descriptions, corrupting
  real page text (dropping "this" from "Sorry, this user has been locked
  out" broke the substring match entirely).
- Every one of this project's own benchmark scripts had a broken
  "only run if invoked directly" guard, so each one silently ran *twice*
  (once on import, once from the explicit call) the moment a second
  script imported it — racing itself and double-counting results.

The pattern throughout: **unit tests and type-checking caught none of
these.** Every one surfaced only by actually running the pipeline against
a real browser and a real (sometimes deliberately broken, sometimes
public and merely messy) web page.

## Known limitations (honest, not aspirational)

- **No fuzzy description-to-DOM matching.** "the shopping cart badge"
  won't resolve against an element whose only identity is a dynamic
  `aria-label="Cart, 3 items"` — you have to phrase the step with the
  real accessible text. This is real authoring friction for anyone not
  willing to peek at the DOM once.
- **The destructive-action guard is bare-keyword, not intent-aware.** A
  todo item literally named "Pay rent" trips the same block as an actual
  payment action. This is a deliberate "fail safe, not fail smart"
  trade-off (per the project's own design philosophy) — fix it by
  renaming test data, not by loosening the pattern.
- **Genuine text collisions defeat the text-match strategy.** If a
  product's description happens to contain another product's full name
  (SauceDemo's Bolt T-Shirt case), the resolver correctly refuses to
  guess, but that means a human has to disambiguate by rephrasing.
- **Triage alone can't distinguish "renamed" from "removed."** Both show
  up as an action-step locator-not-found (`ui_drift`); only the healer's
  own live re-check (`eval/healing-benchmark.ts`) tells them apart, by
  actually trying to find a replacement and failing to when the element
  is truly gone.
- **No sandboxed install tested.** OWASP Juice Shop was considered as a
  fourth evaluation target but excluded — this environment has no Docker
  available. RealWorld Conduit's public demo frontend was also tried and
  found unreachable (it redirects only to its API domain, not a UI).
- **No non-developer usability study with an actual non-developer.**
  What's here instead is honest: every friction point documented above
  (exact-text requirements, context-scoped clicks for repeated items,
  the destructive-guard's bluntness) was discovered by writing this
  corpus's 61 tests from scratch, by hand, using only the plain-English
  grammar — not by reading the resolver's source first.
- **Not run against the user's own production apps.** This evaluation
  is entirely against local and public demo targets; it has not been
  validated against a real, private application.
- **The run-comparison and shareable-HTML-report paths are CLI/inline
  only.** `testwise report html` produces a static report file; there's
  no "share link" flow from the web UI yet, and run-to-run comparison
  lives inline in the failure detail view rather than as its own page.

## Repository layout

```
src/
  parser/      plain-English + Gherkin -> typed steps
  resolver/    live browser resolution, locator candidate strategies
  codegen/     resolved steps -> Playwright spec + step map
  runner/      Playwright execution, artifact capture
  triage/      deterministic-first failure classification
  healer/      locator/wait-only repair proposals + audit log
  safety/      allow-list, destructive guard, injection scanner, secrets vault
  flake/       stability-check (run-N-times) gate
  checks/      optional axe/perf/links/visual checks
  scheduler/   cron scheduling, webhook/email notification
  explore/     read-only LLM-assisted exploration
  storage/     SQLite-backed project/test/run/heal persistence
  cli/         commander-based CLI
  server/      Express API for the web UI
demo-app/      BuggyMart: a local demo app with injectable bugs/drift
web/           React dashboard, test detail, failure/heal review
eval/          every benchmark described above, plus the seed corpus
tests/         vitest unit tests (pure logic, no browser)
examples/ci/   copy-paste GitHub Actions references for Testwise users
```
