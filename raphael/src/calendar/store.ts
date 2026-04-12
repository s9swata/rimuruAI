import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { CalendarEvent } from "./types";
import { readGist, writeGist, createGist } from "./gist";
import { ToolResult } from "../agent/dispatcher";

interface CalendarStore {
  events: CalendarEvent[];
  addEvent: (event: CalendarEvent) => void;
  removeEvent: (id: string) => void;
  updateEvent: (id: string, patch: Partial<CalendarEvent>) => void;
  reset: () => void;
  loadFromGist: () => Promise<void>;
}

export const useCalendarStore = create<CalendarStore>((set, get) => ({
  events: [],

  addEvent: (event) => {
    set((s) => ({ events: [...s.events, event] }));
    syncToGist(get().events);
  },

  removeEvent: (id) => {
    set((s) => ({ events: s.events.filter((e) => e.id !== id) }));
    syncToGist(get().events);
  },

  updateEvent: (id, patch) => {
    set((s) => ({ events: s.events.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
    syncToGist(get().events);
  },

  reset: () => set({ events: [] }),

  loadFromGist: async () => {
    const pat = await invoke<string | null>("get_secret", { key: "github_pat" });
    if (!pat) return;
    let gistId = await invoke<string | null>("get_secret", { key: "github_gist_id" });
    if (!gistId) {
      gistId = await createGist(pat, { events: [] });
      await invoke("set_secret", { key: "github_gist_id", value: gistId });
    }
    const state = await readGist(gistId, pat);
    set({ events: state.events });
  },
}));

async function syncToGist(events: CalendarEvent[]) {
  try {
    const pat = await invoke<string | null>("get_secret", { key: "github_pat" });
    if (!pat) return;
    const gistId = await invoke<string | null>("get_secret", { key: "github_gist_id" });
    if (!gistId) return;
    await writeGist(gistId, pat, { events });
  } catch (e) {
    console.error("[Calendar] Gist sync failed:", e);
  }
}

export const calendarService = {
  listEvents: async (_params: Record<string, unknown>): Promise<ToolResult> => {
    const { events } = useCalendarStore.getState();
    return { success: true, data: { events } };
  },

  createEvent: async (params: Record<string, unknown>): Promise<ToolResult> => {
    const event: CalendarEvent = {
      id: crypto.randomUUID(),
      title: String(params.title ?? "Untitled"),
      start: String(params.start ?? new Date().toISOString()),
      end: String(params.end ?? new Date().toISOString()),
      description: String(params.description ?? ""),
    };
    useCalendarStore.getState().addEvent(event);
    return { success: true, data: { eventId: event.id } };
  },

  checkAvailability: async (params: Record<string, unknown>): Promise<ToolResult> => {
    const { events } = useCalendarStore.getState();
    const from = params.from ? new Date(String(params.from)) : new Date(0);
    const to = params.to ? new Date(String(params.to)) : new Date(8640000000000000);
    const busy = events
      .filter((e) => new Date(e.end) > from && new Date(e.start) < to)
      .map((e) => ({ start: e.start, end: e.end }));
    return { success: true, data: { busy } };
  },
};
