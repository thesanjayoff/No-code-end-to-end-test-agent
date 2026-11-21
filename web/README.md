# Testwise web UI

A dashboard, test detail, and failure/triage/heal review UI for Testwise,
talking to the API server in `src/server/index.ts`.

## Development

```
npm run server   # from the repo root: starts the API on :4780
cd web && npm run dev   # starts Vite on its own port, proxying /api to :4780
```

## Production

```
npm run web:build   # from the repo root: builds web/dist
npm run server       # src/server/index.ts serves web/dist as static files
                      # on the same port as the API (:4780) once it exists
```

## Pages

- `/` -- dashboard: every project's tests, pass/flake rates, LLM spend, heal precision.
- `/tests/:id` -- a test's plain-English steps next to its generated Playwright code, run history, and run controls.
- `/runs/:id` -- a failed/flaky run's triage classification and evidence, step results, a diff against the last good run, and the heal review flow (approve/reject/revert with a before/after diff).

Keyboard shortcuts: `d` dashboard, `t` toggle theme, `?` shortcuts help, `Esc` close dialogs.
