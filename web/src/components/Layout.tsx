import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { APP_NAME, APP_TAGLINE } from "../appConfig";
import { useTheme } from "../useTheme";

const SHORTCUTS: Array<[string, string]> = [
  ["d", "Go to dashboard"],
  ["t", "Toggle dark / light mode"],
  ["?", "Show / hide this help"],
  ["Esc", "Close dialogs"],
];

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || (el as HTMLElement).isContentEditable;
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [theme, toggleTheme] = useTheme();
  const [showHelp, setShowHelp] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(document.activeElement)) return;
      if (e.key === "Escape") {
        setShowHelp(false);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") setShowHelp((s) => !s);
      else if (e.key === "d") navigate("/");
      else if (e.key === "t") toggleTheme();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, toggleTheme]);

  return (
    <div style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.75rem 1.25rem",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-elevated)",
        }}
      >
        <Link to="/" style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", color: "var(--text)" }}>
          <strong style={{ fontSize: "1.05rem" }}>{APP_NAME}</strong>
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{APP_TAGLINE}</span>
        </Link>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button className="btn" onClick={() => setShowHelp(true)} title="Keyboard shortcuts (?)">
            ?
          </button>
          <button className="btn" onClick={toggleTheme} title="Toggle theme (t)">
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </header>
      <main style={{ flex: 1, padding: "1.5rem", maxWidth: 1200, width: "100%", margin: "0 auto" }}>{children}</main>

      {showHelp && (
        <div
          role="dialog"
          aria-label="Keyboard shortcuts"
          onClick={() => setShowHelp(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div className="card" style={{ padding: "1.25rem 1.5rem", minWidth: 280 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Keyboard shortcuts</h3>
            <table>
              <tbody>
                {SHORTCUTS.map(([key, desc]) => (
                  <tr key={key}>
                    <td style={{ padding: "0.25rem 0.75rem 0.25rem 0" }}>
                      <kbd className="mono" style={{ border: "1px solid var(--border)", borderRadius: 4, padding: "0.1rem 0.4rem" }}>
                        {key}
                      </kbd>
                    </td>
                    <td style={{ color: "var(--text-muted)" }}>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
