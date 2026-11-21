# CI and trigger examples

These show how a *project using Testwise* would run its tests -- not
Testwise's own CI (that's `.github/workflows/ci.yml` at the repo root).
Copy whichever fits and fill in your project id, test ids, and secrets.

## Ways to run Testwise tests outside the CLI's interactive use

1. **`testwise trigger <testIds...>`** -- the one command these examples
   build on. Runs the given tests headless, exits non-zero if any failed
   (so CI marks the job failed), and can notify a webhook on failure:

   ```
   testwise trigger smoke-checkout-abc123 smoke-login-def456 \
     --browser chromium,webkit \
     --webhook "$SLACK_WEBHOOK_URL"
   ```

2. **`testwise schedule add/start`** -- a long-running cron daemon, for
   when you want scheduling done by Testwise itself rather than by CI
   (`post-deploy.yml` and `nightly.yml` below use CI's own scheduler
   instead, which is usually simpler to operate since it needs no
   always-on process).

3. **A webhook into your own infra** -- `testwise trigger` is just a CLI
   exit code; anything that can run a shell command on a schedule or a
   post-deploy hook (a cloud function, a cron job on a VM, your deploy
   tool's post-deploy step) can drive it the same way these examples do.

## Files

- `nightly.yml` -- runs a tagged suite on a schedule (e.g. every 6 hours),
  notifying a webhook on failure.
- `post-deploy.yml` -- triggered from a `repository_dispatch` event your
  deploy pipeline sends after a successful deploy, so smoke tests always
  run against what was *actually* just shipped.
