import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useApi } from "../useApi";
import { StatusBadge } from "../components/StatusBadge";
import { EmptyState, ErrorState, Spinner } from "../components/States";

export function TestDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string>();
  const [stability, setStability] = useState<{ passed: number; failed: number; flaky: number; passRate: number; flakeRate: number }>();

  const { data: test, error, loading, reload } = useApi(() => api.test(id), [id]);
  const { data: source } = useApi(() => api.testSource(id), [id]);
  const { data: spec } = useApi(() => api.testSpec(id).catch(() => undefined as unknown as string), [id]);
  const { data: runs, reload: reloadRuns } = useApi(() => api.testRuns(id), [id]);
  const { data: flake } = useApi(() => api.testFlake(id), [id]);

  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!test) return <EmptyState title="Test not found." />;

  async function run(headed: boolean) {
    setRunning(true);
    setRunError(undefined);
    try {
      await api.runTest(id, { headed });
      reloadRuns();
    } catch (err: any) {
      setRunError(err?.message ?? String(err));
    } finally {
      setRunning(false);
    }
  }

  async function runStability() {
    setRunning(true);
    setRunError(undefined);
    try {
      const result = await api.stabilityCheck(id, 20);
      setStability(result);
      reloadRuns();
    } catch (err: any) {
      setRunError(err?.message ?? String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>{test.title}</h1>
          <p className="mono" style={{ color: "var(--text-muted)", margin: "0.3rem 0 0" }}>
            {test.startUrl} &middot; env: {test.environment}
          </p>
          <div style={{ marginTop: "0.4rem" }}>
            {test.tags.map((t) => (
              <span key={t} className="badge badge-skipped" style={{ marginRight: "0.3rem" }}>
                {t}
              </span>
            ))}
            {test.quarantined && <span className="badge badge-quarantined">quarantined: {test.quarantineReason}</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn btn-primary" disabled={running} onClick={() => run(false)}>
            {running ? "Running…" : "Run"}
          </button>
          <button className="btn" disabled={running} onClick={() => run(true)}>
            Run headed
          </button>
          <button className="btn" disabled={running} onClick={runStability} title="Run 20 times to check for flakiness">
            Stability check (20x)
          </button>
        </div>
      </div>

      {runError && <ErrorState message={runError} />}
      {stability && (
        <div className="card" style={{ padding: "0.75rem 1rem", margin: "1rem 0" }}>
          Stability (20 runs): {stability.passed} passed, {stability.failed} failed, {stability.flaky} flaky &middot; pass rate{" "}
          {(stability.passRate * 100).toFixed(0)}%, flake rate {(stability.flakeRate * 100).toFixed(0)}%
        </div>
      )}
      {flake && flake.totalRuns > 0 && (
        <p style={{ color: "var(--text-muted)" }}>
          All-time: {flake.totalRuns} runs &middot; {(flake.passRate * 100).toFixed(0)}% pass rate &middot; {(flake.flakeRate * 100).toFixed(0)}% flake rate &middot; avg{" "}
          {(flake.avgDurationMs / 1000).toFixed(1)}s
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginTop: "1.25rem" }}>
        <div className="card" style={{ padding: "1rem" }}>
          <h3 style={{ marginTop: 0 }}>Plain-English steps (source of truth)</h3>
          {source?.steps.length ? (
            <ol style={{ paddingLeft: "1.2rem" }}>
              {source.steps.map((s, i) => (
                <li key={i} style={{ marginBottom: "0.35rem" }}>
                  {s}
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="No source steps found." />
          )}
        </div>
        <div className="card" style={{ padding: "1rem", overflow: "auto" }}>
          <h3 style={{ marginTop: 0 }}>Generated Playwright code (deterministic, zero LLM at replay)</h3>
          {spec ? (
            <pre className="mono" style={{ background: "var(--code-bg)", padding: "0.75rem", borderRadius: 6, overflow: "auto" }}>
              {spec}
            </pre>
          ) : (
            <EmptyState title="Not generated yet." hint="Author this test to resolve its steps into a deterministic spec." />
          )}
        </div>
      </div>

      <div className="card" style={{ padding: "1rem", marginTop: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>Run history</h3>
        {!runs?.length ? (
          <EmptyState title="No runs yet." hint='Click "Run" above.' />
        ) : (
          <table>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: "0.78rem" }}>
                <th style={{ padding: "0.3rem 0.5rem" }}>Status</th>
                <th style={{ padding: "0.3rem 0.5rem" }}>Browser/viewport</th>
                <th style={{ padding: "0.3rem 0.5rem" }}>Duration</th>
                <th style={{ padding: "0.3rem 0.5rem" }}>Started</th>
                <th style={{ padding: "0.3rem 0.5rem" }}></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "0.5rem" }}>
                    <StatusBadge status={r.status} />
                  </td>
                  <td style={{ padding: "0.5rem" }}>
                    {r.browser}/{r.viewport}
                  </td>
                  <td style={{ padding: "0.5rem" }}>{(r.durationMs / 1000).toFixed(1)}s</td>
                  <td style={{ padding: "0.5rem" }}>{new Date(r.startedAt).toLocaleString()}</td>
                  <td style={{ padding: "0.5rem" }}>
                    {(r.status === "failed" || r.status === "flaky") && (
                      <button className="btn" onClick={() => navigate(`/runs/${r.id}`)}>
                        Investigate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ marginTop: "1rem" }}>
        <Link to="/">&larr; Back to dashboard</Link>
      </p>
    </div>
  );
}
