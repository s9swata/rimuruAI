import { describe, it, expect } from "vitest";
import { pickModel } from "../../src/agent/router";
import { MODELS } from "../../src/agent/prompts";

describe("pickModel", () => {
  it("returns MODELS.fast for 'fast' tier", () => {
    expect(pickModel("fast")).toBe(MODELS.fast);
  });

  it("returns MODELS.powerful for 'powerful' tier", () => {
    expect(pickModel("powerful")).toBe(MODELS.powerful);
  });
});