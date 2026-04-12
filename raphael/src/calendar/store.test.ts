import { describe, it, expect, beforeEach, vi } from "vitest";
import { CalendarEvent } from "./types";

describe("CalendarEvent type", () => {
  it("accepts a valid event shape", () => {
    const event: CalendarEvent = {
      id: "abc-123",
      title: "Standup",
      start: "2026-04-12T10:00:00Z",
      end: "2026-04-12T10:30:00Z",
      description: "",
    };
    expect(event.id).toBe("abc-123");
  });
});

import { useCalendarStore, calendarService } from "./store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("./gist", () => ({
  readGist: vi.fn().mockResolvedValue({ events: [] }),
  writeGist: vi.fn().mockResolvedValue(undefined),
  createGist: vi.fn().mockResolvedValue("gist-123"),
}));

beforeEach(() => useCalendarStore.getState().reset());

describe("calendarStore", () => {
  it("adds an event", () => {
    useCalendarStore.getState().addEvent({ id: "1", title: "Standup", start: "2026-04-12T10:00:00Z", end: "2026-04-12T10:30:00Z", description: "" });
    expect(useCalendarStore.getState().events).toHaveLength(1);
  });

  it("removes an event by id", () => {
    const store = useCalendarStore.getState();
    store.addEvent({ id: "2", title: "Review", start: "2026-04-13T14:00:00Z", end: "2026-04-13T15:00:00Z", description: "" });
    store.removeEvent("2");
    expect(useCalendarStore.getState().events).toHaveLength(0);
  });

  it("updates an event", () => {
    const store = useCalendarStore.getState();
    store.addEvent({ id: "3", title: "Old", start: "2026-04-14T09:00:00Z", end: "2026-04-14T10:00:00Z", description: "" });
    store.updateEvent("3", { title: "New" });
    expect(useCalendarStore.getState().events[0].title).toBe("New");
  });
});

describe("calendarService", () => {
  it("listEvents returns success with events array", async () => {
    useCalendarStore.getState().addEvent({ id: "4", title: "Lunch", start: "2026-04-12T12:00:00Z", end: "2026-04-12T13:00:00Z", description: "" });
    const result = await calendarService.listEvents({});
    expect(result.success).toBe(true);
    expect(Array.isArray((result.data as { events: unknown[] }).events)).toBe(true);
  });

  it("createEvent adds to store and returns success", async () => {
    const result = await calendarService.createEvent({ title: "Sprint", start: "2026-04-15T09:00:00Z", end: "2026-04-15T10:00:00Z", description: "" });
    expect(result.success).toBe(true);
    expect(useCalendarStore.getState().events.some(e => e.title === "Sprint")).toBe(true);
  });

  it("checkAvailability returns busy slots", async () => {
    useCalendarStore.getState().addEvent({ id: "5", title: "Busy", start: "2026-04-16T10:00:00Z", end: "2026-04-16T11:00:00Z", description: "" });
    const result = await calendarService.checkAvailability({ from: "2026-04-16T00:00:00Z", to: "2026-04-16T23:59:59Z" });
    expect(result.success).toBe(true);
    expect((result.data as { busy: unknown[] }).busy).toHaveLength(1);
  });
});
