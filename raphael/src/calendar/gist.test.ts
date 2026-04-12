import { describe, it, expect, vi, beforeEach } from "vitest";
import { readGist, writeGist, createGist } from "./gist";
import { CalendarState } from "./types";

const EMPTY_STATE: CalendarState = { events: [] };
const GIST_ID = "abc123";
const PAT = "ghp_test";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

beforeEach(() => mockFetch.mockReset());

describe("readGist", () => {
  it("returns parsed events from gist file content", async () => {
    const state: CalendarState = {
      events: [{ id: "1", title: "Test", start: "2026-04-12T10:00:00Z", end: "2026-04-12T11:00:00Z", description: "" }],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        files: { "raphael-calendar.json": { content: JSON.stringify(state) } },
      }),
    });
    const result = await readGist(GIST_ID, PAT);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("Test");
  });

  it("returns empty state when gist file is missing", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ files: {} }) });
    const result = await readGist(GIST_ID, PAT);
    expect(result).toEqual(EMPTY_STATE);
  });

  it("throws when fetch fails", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, text: async () => "Not Found" });
    await expect(readGist(GIST_ID, PAT)).rejects.toThrow("Gist fetch failed: 404");
  });
});

describe("writeGist", () => {
  it("PATCHes the gist with serialized state", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await writeGist(GIST_ID, PAT, EMPTY_STATE);
    const calls = mockFetch.mock.calls;
    expect(calls).toHaveLength(1);
    const [url, options] = calls[0];
    expect(url).toBe(`https://api.github.com/gists/${GIST_ID}`);
    expect(options.method).toBe("PATCH");
    expect(options.headers.Authorization).toBe(`Bearer ${PAT}`);
    expect(options.body).toContain('events');
  });

  it("throws when PATCH fails", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 422, text: async () => "Unprocessable" });
    await expect(writeGist(GIST_ID, PAT, EMPTY_STATE)).rejects.toThrow("Gist write failed: 422");
  });
});

describe("createGist", () => {
  it("POSTs and returns the new gist id", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: "newid999" }) });
    const id = await createGist(PAT, EMPTY_STATE);
    expect(id).toBe("newid999");
  });
});
