import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseOrchestration } from "../../src/agent/orchestrator";

describe("parseOrchestration", () => {
  it("parses valid tool call with json fences", () => {
    const raw = "```json\n{\"model\":\"fast\",\"tool\":\"gmail.listEmails\",\"params\":{\"maxResults\":5},\"intent\":\"List recent emails\"}\n```";
    const result = parseOrchestration(raw);
    expect(result).toEqual({
      model: "fast",
      tool: "gmail.listEmails",
      params: { maxResults: 5 },
      intent: "List recent emails",
    });
  });

  it("parses valid tool call without json fences", () => {
    const raw = "{\"model\":\"powerful\",\"tool\":\"gmail.sendEmail\",\"params\":{\"to\":\"test@example.com\",\"subject\":\"Test\",\"body\":\"Hello\"},\"intent\":\"Send email\"}";
    const result = parseOrchestration(raw);
    expect(result).toEqual({
      model: "powerful",
      tool: "gmail.sendEmail",
      params: { to: "test@example.com", subject: "Test", body: "Hello" },
      intent: "Send email",
    });
  });

  it("returns no-tool response when tool is null", () => {
    const raw = "```json\n{\"model\":\"fast\",\"tool\":null,\"params\":null,\"intent\":\"Greeting\"}\n```";
    const result = parseOrchestration(raw);
    expect(result).toEqual({
      model: "fast",
      tool: null,
      params: null,
      intent: "Greeting",
    });
  });

  it("throws on invalid JSON", () => {
    const raw = "```json\n{invalid json}\n```";
    expect(() => parseOrchestration(raw)).toThrow();
  });

  it("throws on missing required fields", () => {
    const raw = "{\"model\":\"fast\"}";
    expect(() => parseOrchestration(raw)).toThrow();
  });
});