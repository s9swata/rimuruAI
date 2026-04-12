import { useState } from "react";
import { useCalendarStore } from "../calendar/store";
import { CalendarEvent } from "../calendar/types";

export default function CalendarView() {
  const { events, addEvent, removeEvent } = useCalendarStore();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", start: "", end: "", description: "" });
  const [error, setError] = useState("");

  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));

  function formatDateTime(iso: string) {
    try {
      return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch { return iso; }
  }

  function handleAdd() {
    if (!form.title.trim()) { setError("Title required"); return; }
    if (!form.start) { setError("Start time required"); return; }
    if (!form.end) { setError("End time required"); return; }
    if (new Date(form.end) <= new Date(form.start)) { setError("End must be after start"); return; }
    addEvent({ id: crypto.randomUUID(), title: form.title, start: new Date(form.start).toISOString(), end: new Date(form.end).toISOString(), description: form.description });
    setForm({ title: "", start: "", end: "", description: "" });
    setShowAdd(false);
    setError("");
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "var(--bg-surface)", color: "var(--text)",
    border: "1px solid var(--accent-dim)", borderRadius: "var(--radius)",
    padding: "6px 10px", fontFamily: "var(--font-mono)", fontSize: 11, outline: "none",
  };

  return (
    <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", color: "var(--accent)" }}>CALENDAR</span>
        <button onClick={() => setShowAdd((v) => !v)} style={{ background: "none", border: "1px solid var(--accent-dim)", borderRadius: "var(--radius)", color: "var(--text-muted)", padding: "3px 10px", fontSize: 11, cursor: "pointer" }}>
          {showAdd ? "Cancel" : "+ Event"}
        </button>
      </div>

      {showAdd && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px", background: "var(--bg-surface)", borderRadius: "var(--radius)", border: "1px solid var(--accent-dim)" }}>
          <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={inputStyle} />
          <input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} style={inputStyle} />
          <input type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} style={inputStyle} />
          <input placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={inputStyle} />
          {error && <div style={{ color: "var(--danger)", fontSize: 11 }}>{error}</div>}
          <button onClick={handleAdd} style={{ alignSelf: "flex-end", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", padding: "5px 16px", fontSize: 11, cursor: "pointer" }}>
            Save
          </button>
        </div>
      )}

      {sorted.length === 0 && !showAdd && (
        <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", padding: "16px 0" }}>
          No events. Hit + Event to add one.
        </div>
      )}

      {sorted.map((event: CalendarEvent) => (
        <div key={event.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "8px 10px", background: "var(--bg-surface)", borderRadius: "var(--radius)", border: "1px solid var(--accent-dim)" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{event.title}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              {formatDateTime(event.start)} → {formatDateTime(event.end)}
            </div>
            {event.description && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{event.description}</div>}
          </div>
          <button onClick={() => removeEvent(event.id)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>
      ))}
    </div>
  );
}
