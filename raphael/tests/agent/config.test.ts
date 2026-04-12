import { describe, it, expect } from "vitest";
import { applyTrustLevel, DEFAULT_CONFIG } from "../../src/config/types";

describe("applyTrustLevel", () => {
  it("supervised sets all tools to requiresApproval: true", () => {
    const cfg = applyTrustLevel(DEFAULT_CONFIG, "supervised");
    for (const tool of Object.values(cfg.tools)) {
      expect(tool.requiresApproval).toBe(true);
    }
  });

  it("autonomous sets all tools to requiresApproval: false", () => {
    const cfg = applyTrustLevel(DEFAULT_CONFIG, "autonomous");
    for (const tool of Object.values(cfg.tools)) {
      expect(tool.requiresApproval).toBe(false);
    }
  });

  it("balanced only requires approval for side-effecting tools", () => {
    const cfg = applyTrustLevel(DEFAULT_CONFIG, "balanced");
    expect(cfg.tools["gmail.sendEmail"].requiresApproval).toBe(true);
    expect(cfg.tools["calendar.createEvent"].requiresApproval).toBe(true);
    expect(cfg.tools["gmail.draftEmail"].requiresApproval).toBe(false);
    expect(cfg.tools["x.getTimeline"].requiresApproval).toBe(false);
  });
});