import { MODELS, ModelTier } from "./prompts";

export function pickModel(tier: "fast" | "powerful"): string {
  return MODELS[tier];
}