import { useState } from "react";
import type { CompoundCardState } from "../store/chat";
import type { ExecutedTool } from "../agent/compound";

interface Props {
  card: CompoundCardState;
}

function summary(tool: ExecutedTool): string {
  const args = typeof tool.arguments === "string"
    ? tool.arguments
    : tool.arguments
      ? JSON.stringify(tool.arguments)
      : "";
  if (tool.type === "web_search" || tool.type === "browser_search" || tool.type === "browser_automation") {
    return args.length > 80 ? args.slice(0, 80) + "…" : args;
  }
  if (tool.type === "visit_website") {
    try {
      const parsed = typeof tool.arguments === "string" ? JSON.parse(tool.arguments) : tool.arguments;
      const url = (parsed as { url?: string })?.url;
      if (url) return url;
    } catch {}
    return args;
  }
  return args.length > 80 ? args.slice(0, 80) + "…" : args;
}

function sources(tool: ExecutedTool): Array<{ title?: string; url?: string }> {
  const out: Array<{ title?: string; url?: string }> = [];
  const results = tool.search_results?.results;
  if (Array.isArray(results)) {
    for (const r of results) {
      out.push({ title: r.title, url: r.url });
    }
  }
  return out;
}

export default function CompoundCard({ card }: Props) {
  const [expanded, setExpanded] = useState(false);

  const color =
    card.status === "error"
      ? "var(--danger)"
      : card.status === "running"
        ? "var(--accent)"
        : "var(--text-muted)";

  const stepCount = card.steps.length;
  const headerLabel =
    card.status === "running"
      ? `⟳ ${card.model} researching…`
      : card.status === "error"
        ? `✗ ${card.model} failed`
        : stepCount > 0
          ? `✓ ${card.model} · ${stepCount} step${stepCount === 1 ? "" : "s"}`
          : `✓ ${card.model} · no tools used`;

  return (
    <div
      style={{
        margin: "6px 0",
        padding: "8px 12px",
        background: "var(--bg-surface)",
        borderLeft: `2px solid ${color}`,
        borderRadius: "0 var(--radius) var(--radius) 0",
        fontSize: 12,
      }}
    >
      <div
        onClick={() => stepCount > 0 && setExpanded((v) => !v)}
        style={{
          color,
          cursor: stepCount > 0 ? "pointer" : "default",
          userSelect: "none",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>{headerLabel}</span>
        {stepCount > 0 && (
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            {expanded ? "▾" : "▸"}
          </span>
        )}
      </div>

      {card.error && (
        <div style={{ marginTop: 6, color: "var(--danger)", fontSize: 11, whiteSpace: "pre-wrap" }}>
          {card.error}
        </div>
      )}

      {expanded && stepCount > 0 && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {card.steps.map((step, i) => {
            const srcs = sources(step);
            return (
              <div key={i} style={{ borderTop: "1px solid var(--accent-dim)", paddingTop: 6 }}>
                <div style={{ color: "var(--accent)", fontSize: 11, marginBottom: 2 }}>
                  {i + 1}. {step.type}
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 4 }}>
                  {summary(step)}
                </div>
                {srcs.length > 0 && (
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11 }}>
                    {srcs.slice(0, 5).map((s, j) => (
                      <li key={j} style={{ marginBottom: 2 }}>
                        {s.url ? (
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "var(--accent)", textDecoration: "none" }}
                          >
                            {s.title || s.url}
                          </a>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>{s.title}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
