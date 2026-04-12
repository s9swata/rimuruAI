import { CalendarState } from "./types";

const FILENAME = "raphael-calendar.json";
const API = "https://api.github.com/gists";

export async function readGist(gistId: string, pat: string): Promise<CalendarState> {
  const res = await fetch(`${API}/${gistId}`, {
    headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`Gist fetch failed: ${res.status}`);
  const data = await res.json();
  const file = data.files?.[FILENAME];
  if (!file) return { events: [] };
  try {
    return JSON.parse(file.content) as CalendarState;
  } catch {
    return { events: [] };
  }
}

export async function writeGist(gistId: string, pat: string, state: CalendarState): Promise<void> {
  const res = await fetch(`${API}/${gistId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ files: { [FILENAME]: { content: JSON.stringify(state, null, 2) } } }),
  });
  if (!res.ok) throw new Error(`Gist write failed: ${res.status}`);
}

export async function createGist(pat: string, state: CalendarState): Promise<string> {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      description: "Raphael Calendar",
      public: false,
      files: { [FILENAME]: { content: JSON.stringify(state, null, 2) } },
    }),
  });
  if (!res.ok) throw new Error(`Gist create failed: ${res.status}`);
  const data = await res.json();
  if (!data.id) throw new Error("Gist create returned no id");
  return data.id as string;
}
