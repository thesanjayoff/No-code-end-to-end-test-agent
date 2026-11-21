export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ padding: "3rem 1rem", textAlign: "center", color: "var(--text-muted)" }}>
      <p style={{ fontSize: "1rem", margin: 0 }}>{title}</p>
      {hint && <p style={{ fontSize: "0.85rem", marginTop: "0.4rem" }}>{hint}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div style={{ padding: "2rem 1rem", textAlign: "center" }}>
      <p style={{ color: "var(--red)", margin: 0 }}>{message}</p>
      {onRetry && (
        <button className="btn" style={{ marginTop: "0.75rem" }} onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Spinner() {
  return <div style={{ padding: "2rem 1rem", textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>;
}
