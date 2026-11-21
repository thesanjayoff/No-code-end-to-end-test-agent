import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { CompareResult } from "../api";
import { useApi } from "../useApi";
import { StatusBadge } from "../components/StatusBadge";
import { EmptyState, ErrorState, Spinner } from "../components/States";
import type { BugReport, HealProposal, TriageResult } from "../types";

const CLASSIFICATION_HINT: Record<string, string> = {
  flake: "Passed on retry -- most likely a timing issue, not a real problem.",
  environment: "Looks like the environment (network/server) was the issue, not the test or the app.",
  ui_drift: "The element the test relies on couldn't be found -- the UI likely moved or was renamed, not a behavior change.",
  real_bug: "An expected result did not hold. Testwise never calls this drift -- a failed expectation is always a suspected real bug.",
  unknown: "Could not confidently classify this failure from the available evidence.",
};

function HealCard({ heal, onDecide }: { heal: HealProposal; onDecide: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  async function act(action: "approve" | "reject" | "revert") {
    setBusy(true);
    setErr(undefined);
    try {
      if (action === "approve") await api.approveHeal(heal.id);
      else if (action === "reject") await api.rejectHeal(heal.id);
      else await api.revertHeal(heal.id);
      onDecide();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>
          Heal proposal ({heal.kind}) &middot; step {heal.stepIndex}
        </strong>
        <span
          className="badge"
          style={{
            background: heal.status === "approved" ? "color-mix(in srgb, var(--green) 18%, transparent)" : heal.status === "rejected" ? "color-mix(in srgb, var(--red) 18%, transparent)" : "color-mix(in srgb, var(--text-muted) 18%, transparent)",
            color: heal.status === "approved" ? "var(--green)" : heal.status === "rejected" ? "var(--red)" : "var(--text-muted)",
          }}
        >
          {heal.status}
        </span>
      </div>
      <p style={{ color: "var(--text-muted)", marginBottom: "0.5rem" }}>{heal.rationale}</p>
      <div className="mono" style={{ background: "var(--code-bg)", padding: "0.6rem", borderRadius: 6 }}>
        <div style={{ color: "var(--red)" }}>- {heal.before}</div>
        <div style={{ color: "var(--green)" }}>+ {heal.after}</div>
      </div>
      <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
        Evidence before: {heal.beforeEvidence}
        <br />
        Evidence after: {heal.afterEvidence}
      </p>
      {heal.autoApprovable && heal.status === "pending" && (
        <p style={{ fontSize: "0.82rem", color: "var(--accent)" }}>Eligible for auto-approval (same strategy, high-confidence rename match).</p>
      )}
      {err && <p style={{ color: "var(--red)" }}>{err}</p>}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
        {heal.status === "pending" && (
          <>
            <button className="btn btn-primary" disabled={busy} onClick={() => act("approve")}>
              Approve
            </button>
            <button className="btn btn-danger" disabled={busy} onClick={() => act("reject")}>
              Reject
            </button>
          </>
        )}
        {heal.status === "approved" && (
          <button className="btn" disabled={busy} onClick={() => act("revert")}>
            Revert
          </button>
        )}
      </div>
    </div>
  );
}

export function FailureDetail() {
  const { id = "" } = useParams();
  const { data: run, error, loading, reload } = useApi(() => api.run(id), [id]);
  const { data: triage } = useApi<TriageResult | undefined>(() => api.runTriage(id).catch(() => undefined), [id]);
  const { data: heals, reload: reloadHeals } = useApi<HealProposal[]>(() => (run ? api.testHeals(run.testId) : Promise.resolve([])), [run?.testId]);
  const { data: bugs } = useApi<BugReport[]>(() => (run ? api.testBugs(run.testId) : Promise.resolve([])), [run?.testId]);
  const { data: compare } = useApi<CompareResult | undefined>(() => (run ? api.compare(run.testId, run.id) : Promise.resolve(undefined)), [run?.testId, run?.id]);
  const [proposing, setProposing] = useState(false);
  const [proposeMsg, setProposeMsg] = useState<string>();

  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!run) return <EmptyState title="Run not found." />;

  const failedStep = run.stepResults.find((s) => s.status === "failed");
  const relevantHeals = (heals ?? []).filter((h) => h.runId === run.id);
  const relevantBugs = (bugs ?? []).filter((b) => b.runId === run.id);
  const canPropose = triage && (triage.classification === "ui_drift" || triage.classification === "flake") && relevantHeals.length === 0;

  async function proposeHeal() {
    if (!failedStep || !triage) return;
    setProposing(true);
    setProposeMsg(undefined);
    try {
      const result = await api.proposeHeal(run!.testId, run!.id, failedStep.index, triage.classification === "flake" ? "flake" : "ui_drift");
      if ("blocked" in result) setProposeMsg(`Not healed: ${result.blocked}`);
      reloadHeals();
    } catch (e: any) {
      setProposeMsg(e?.message ?? String(e));
    } finally {
      setProposing(false);
    }
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>
        Run <span className="mono">{run.id}</span>
      </h1>
      <p>
        <Link to={`/tests/${run.testId}`}>&larr; Back to test</Link>
      </p>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1rem" }}>
        <StatusBadge status={run.status} />
        <span className="mono" style={{ color: "var(--text-muted)" }}>
          {run.browser}/{run.viewport} &middot; {(run.durationMs / 1000).toFixed(1)}s &middot; {run.attempts} attempt(s), {run.retries} retr{run.retries === 1 ? "y" : "ies"}
        </span>
      </div>

      {triage && (
        <div className="card" style={{ padding: "1rem", marginBottom: "1rem" }}>
          <h3 style={{ marginTop: 0 }}>
            Triage: <span style={{ textTransform: "uppercase" }}>{triage.classification}</span>{" "}
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>(confidence {(triage.confidence * 100).toFixed(0)}%)</span>
          </h3>
          <p style={{ color: "var(--text-muted)" }}>{CLASSIFICATION_HINT[triage.classification]}</p>
          <ul style={{ fontSize: "0.85rem" }}>
            {triage.evidence.map((e, i) => (
              <li key={i} className="mono">
                [{e.signal}] {e.detail}
              </li>
            ))}
          </ul>
          {canPropose && (
            <button className="btn btn-primary" disabled={proposing} onClick={proposeHeal}>
              {proposing ? "Proposing…" : "Propose a heal"}
            </button>
          )}
          {proposeMsg && <p style={{ color: "var(--text-muted)" }}>{proposeMsg}</p>}
          {triage.classification === "real_bug" && (
            <p style={{ color: "var(--red)" }}>Testwise does not propose heals for failed expectations -- this needs a human to decide whether the app or the test is wrong.</p>
          )}
        </div>
      )}

      {relevantHeals.map((h) => (
        <div key={h.id} style={{ marginBottom: "1rem" }}>
          <HealCard heal={h} onDecide={reloadHeals} />
        </div>
      ))}

      {relevantBugs.map((b) => (
        <div key={b.id} className="card" style={{ padding: "1rem", marginBottom: "1rem", borderColor: "var(--red)" }}>
          <strong style={{ color: "var(--red)" }}>Suspected bug filed</strong>
          <p>{b.summary}</p>
          <ul style={{ fontSize: "0.85rem" }}>
            {b.evidence.map((e, i) => (
              <li key={i} className="mono">
                {e}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="card" style={{ padding: "1rem", marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>Step results</h3>
        <ol style={{ paddingLeft: "1.2rem" }}>
          {run.stepResults.map((s) => (
            <li key={s.index} style={{ marginBottom: "0.4rem" }}>
              <StatusBadge status={s.status} /> <span style={{ marginLeft: "0.4rem" }}>{s.sentence}</span>
              {s.error && (
                <pre className="mono" style={{ background: "var(--code-bg)", padding: "0.5rem", borderRadius: 6, marginTop: "0.3rem", whiteSpace: "pre-wrap" }}>
                  {s.error}
                </pre>
              )}
            </li>
          ))}
        </ol>
      </div>

      {compare?.lastGood && (
        <div className="card" style={{ padding: "1rem", marginBottom: "1rem" }}>
          <h3 style={{ marginTop: 0 }}>
            Compared to last good run <span className="mono">{compare.lastGood.id}</span> ({new Date(compare.lastGood.startedAt).toLocaleString()})
          </h3>
          <table>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: "0.78rem" }}>
                <th>Step</th>
                <th>Before</th>
                <th>After</th>
              </tr>
            </thead>
            <tbody>
              {compare.stepDiff.map((d) => (
                <tr key={d.index} style={{ background: d.changed ? "color-mix(in srgb, var(--yellow) 10%, transparent)" : undefined }}>
                  <td style={{ padding: "0.3rem 0.5rem" }}>{d.index}</td>
                  <td style={{ padding: "0.3rem 0.5rem" }}>{d.before}</td>
                  <td style={{ padding: "0.3rem 0.5rem" }}>{d.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", gap: "1rem", fontSize: "0.85rem" }}>
        {run.tracePath && <a href={`/api/runs/${run.id}/trace`}>Download trace</a>}
        {run.consoleErrors.length > 0 && <span>{run.consoleErrors.length} console error(s) captured</span>}
        {run.networkErrors.length > 0 && <span>{run.networkErrors.length} network error(s) captured</span>}
      </div>
    </div>
  );
}
