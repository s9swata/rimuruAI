import { streamText } from "ai";
import { MODELS, getModelForTier, getGroqModelId } from "./prompts";
import { 
  getGroqProvider, 
  getProvider, 
  shouldSkipProvider,
} from "./providers";
import type { ProviderPriorityConfig, BuiltInProvider, ModelSelection } from "../config/types";
import type { LanguageModelV3 } from "@ai-sdk/provider";

export async function streamChat(
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  providerPriority?: ProviderPriorityConfig[],
  rateLimitConfig?: Record<BuiltInProvider, { maxTokensPerDay: number; warnThreshold: number }>,
  modelSelection?: { orchestrator: ModelSelection; fast: ModelSelection; powerful: ModelSelection },
  tier: "fast" | "powerful" = "fast",
): Promise<void> {
  console.log("[streamChat] model:", model, "tier:", tier);

  const priority = providerPriority || [
    { provider: "groq", priority: 1, enabled: true },
    { provider: "cerebras", priority: 2, enabled: true },
    { provider: "openrouter", priority: 3, enabled: true },
    { provider: "gemini", priority: 4, enabled: true },
  ];

  const enabledProviders = priority
    .filter(p => p.enabled)
    .sort((a, b) => a.priority - b.priority);

  const config = rateLimitConfig || {
    groq: { maxTokensPerDay: 500_000, warnThreshold: 0.8 },
    cerebras: { maxTokensPerDay: 500_000, warnThreshold: 0.8 },
    openrouter: { maxTokensPerDay: 200_000, warnThreshold: 0.8 },
    anthropic: { maxTokensPerDay: 100_000, warnThreshold: 0.8 },
    openai: { maxTokensPerDay: 100_000, warnThreshold: 0.8 },
    gemini: { maxTokensPerDay: 150_000, warnThreshold: 0.8 },
    nvidia: { maxTokensPerDay: 100_000, warnThreshold: 0.8 },
  };

  let lastError: unknown = null;
  let textStream: AsyncIterable<string> | null = null;

  for (const configEntry of enabledProviders) {
    const providerName = configEntry.provider;
    
    // Check if we should skip due to rate limits
    const skipReason = shouldSkipProvider(providerName as BuiltInProvider, config);
    if (skipReason) {
      console.log(`[streamChat] Skipping ${providerName}: ${skipReason}`);
      continue;
    }
    
    console.log(`[streamChat] Trying ${providerName}...`);

    try {
      const { provider } = await getProvider(providerName as BuiltInProvider);
      
      // Get model - from selection or fallback to default
      let modelId: string;
      if (modelSelection && modelSelection[tier]) {
        modelId = modelSelection[tier].model;
      } else {
        modelId = model || getModelForTier(tier, providerName as BuiltInProvider);
      }
      
      // Handle Groq model ID prefix quirk
      if (providerName === "groq") {
        modelId = getGroqModelId(modelId);
      }
      
      const modelInstance = (provider as (id: string) => LanguageModelV3)(modelId);
      console.log(`[streamChat] Using ${providerName} model ${modelId}`);
      
      const result = streamText({
        model: modelInstance,
        messages,
        temperature: 0.7,
      });
      
      textStream = result.textStream;
      break;
    } catch (e) {
      lastError = e;
      const msg = String(e);
      console.warn(`[streamChat] ${providerName} failed:`, msg);
      
      // Continue to next provider on failure
    }
  }

  // If no provider worked, try a simple fallback
  if (!textStream) {
    console.warn("[streamChat] All providers failed, trying simple Groq fallback");
    try {
      const { provider } = await getGroqProvider();
      const result = streamText({
        model: provider(model || "llama-3.1-8b-instant"),
        messages,
        temperature: 0.7,
      });
      textStream = result.textStream;
    } catch (e) {
      console.error("[streamChat] Fallback also failed:", e);
      throw new Error(`All providers failed. Last error: ${String(lastError)}`);
    }
  }

  try {
    for await (const chunk of textStream!) {
      if (chunk) onChunk(chunk);
    }
    console.log("[streamChat] stream done");
    onDone();
  } catch (e) {
    console.error("[streamChat] streamText error:", String(e));
    throw e;
  }
}

export { getGroqProvider } from "./providers";
export { MODELS };
export { getAllProviderUsage } from "./providers";