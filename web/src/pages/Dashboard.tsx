import { Link } from "react-router-dom";
import { api } from "../api";
import { useApi } from "../useApi";
import { StatusBadge } from "../components/StatusBadge";
import { EmptyState, ErrorState, Spinner } from "../components/States";

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ padding: "0.9rem 1.1rem", minWidth: 140 }}>
      <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.02em" }}>{label}</div>
      <div style={{ fontSize: "1.3rem", fontWeight: 600, marginTop: "0.15rem" }}>{value}</div>
    </div>
  );
}

export function Dashboard() {
  const { data: dashboard, error, loading, reload } = useApi(() => api.dashboard(), []);
  const { data: usage } = useApi(() => api.llmUsage(), []);
  const { data: healPrecision } = useApi(() => api.healPrecision(), []);

  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!dashboard?.length) return <EmptyState title="No projects yet" hint='Create one with "testwise project create", then author a test.' />;

  const allTests = dashboard.flatMap((d) => d.tests);
  const totalRuns = allTests.reduce((n, t) => n + t.flake.totalRuns, 0);
  const passRate = totalRuns ? allTests.reduce((n, t) => n + t.flake.passed, 0) / totalRuns : 0;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Dashboard</h1>
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <StatTile label="Projects" value={String(dashboard.length)} />
        <StatTile label="Tests" value={String(allTests.length)} />
        <StatTile label="Pass rate" value={totalRuns ? `${(passRate * 100).toFixed(0)}%` : "—"} />
        <StatTile label="Heal precision" value={healPrecision && healPrecision.total > 0 ? `${(healPrecision.precision * 100).toFixed(0)}%` : "—"} />
        <StatTile label="LLM spend" value={usage ? `$${usage.totalCostUsd.toFixed(4)}` : "—"} />
        <StatTile label="Replay LLM calls" value="0 (always)" />
      </div>

      {dashboard.map(({ project, tests }) => (
        <section key={project.id} className="card" style={{ padding: "1rem 1.25rem", marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem", marginBottom: "0.5rem" }}>
            <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{project.name}</h2>
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>allow-list: {project.allowedDomains.join(", ")}</span>
            {project.productionDomains.length > 0 && (
              <span className="badge" style={{ background: "color-mix(in srgb, var(--red) 18%, transparent)", color: "var(--red)" }}>
                has production domains
              </span>
            )}
          </div>
          {tests.length === 0 ? (
            <EmptyState title="No tests authored in this project yet." />
          ) : (
            <table>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: "0.78rem" }}>
                  <th style={{ padding: "0.3rem 0.5rem" }}>Test</th>
                  <th style={{ padding: "0.3rem 0.5rem" }}>Last run</th>
                  <th style={{ padding: "0.3rem 0.5rem" }}>Pass rate</th>
                  <th style={{ padding: "0.3rem 0.5rem" }}>Flake rate</th>
                  <th style={{ padding: "0.3rem 0.5rem" }}>Tags</th>
                </tr>
              </thead>
              <tbody>
                {tests.map(({ test, flake, lastRun }) => (
                  <tr key={test.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.5rem" }}>
                      <Link to={`/tests/${test.id}`}>{test.title}</Link>
                      {test.quarantined && <span className="badge badge-quarantined" style={{ marginLeft: "0.5rem" }}>quarantined</span>}
                    </td>
                    <td style={{ padding: "0.5rem" }}>{lastRun ? <StatusBadge status={lastRun.status} /> : <span style={{ color: "var(--text-muted)" }}>never run</span>}</td>
                    <td style={{ padding: "0.5rem" }}>{flake.totalRuns ? `${(flake.passRate * 100).toFixed(0)}%` : "—"}</td>
                    <td style={{ padding: "0.5rem" }}>{flake.totalRuns ? `${(flake.flakeRate * 100).toFixed(0)}%` : "—"}</td>
                    <td style={{ padding: "0.5rem" }}>{test.tags.map((t) => (
                      <span key={t} className="badge badge-skipped" style={{ marginRight: "0.3rem" }}>{t}</span>
                    ))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}
