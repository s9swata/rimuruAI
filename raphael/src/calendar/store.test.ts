import { describe, it, expect } from "vitest";
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
