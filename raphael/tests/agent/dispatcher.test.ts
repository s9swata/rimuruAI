import { describe, it, expect } from "vitest";
import { requiresApprovalCheck } from "../../src/agent/dispatcher";
import { DEFAULT_CONFIG, RaphaelConfig } from "../../src/config/types";

describe("requiresApprovalCheck", () => {
  const balancedConfig: RaphaelConfig = {
    ...DEFAULT_CONFIG,
    trustLevel: "balanced",
  };

  it("returns true for gmail.sendEmail with balanced trust level", () => {
    expect(requiresApprovalCheck("gmail.sendEmail", balancedConfig)).toBe(true);
  });

  it("returns false for x.getTimeline", () => {
    expect(requiresApprovalCheck("x.getTimeline", balancedConfig)).toBe(false);
  });

  it("returns false for unknown tool", () => {
    expect(requiresApprovalCheck("unknown.tool", balancedConfig)).toBe(false);
  });
});