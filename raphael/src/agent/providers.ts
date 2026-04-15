/**
 * AI provider instances — lazily initialized, cached after first use.
 * Built-in providers: Groq, Cerebras, Gemini, OpenAI, Anthropic, OpenRouter, NVIDIA
 * Custom: OpenAI-compatible endpoints via config.
 */

import { createGroq } from "@ai-sdk/groq";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createCerebras } from "@ai-sdk/cerebras";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { openrouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { invoke } from "@tauri-apps/api/core";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { CustomProviderConfig, BuiltInProvider, ProviderPriorityConfig } from "../config/types";
import { getModelForTier, getGroqModelId, type ModelTier } from "./prompts";

let _groqKeys: string[] = [];
let _cerebrasKeys: string[] = [];
let _openaiKeys: string[] = [];
let _anthropicKeys: string[] = [];
let _openrouterKeys: string[] = [];
let _nvidiaKeys: string[] = [];
let _geminiKeys: string[] = [];
let _customProviders: CustomProviderConfig[] = [];
let _groqLoaded = false;
let _cerebrasLoaded = false;
let _openaiLoaded = false;
let _anthropicLoaded = false;
let _openrouterLoaded = false;
let _nvidiaLoaded = false;
let _geminiLoaded = false;
let _customLoaded = false;

/** key → expiry timestamp (ms) */
const _rateLimitedUntil = new Map<string, number>();

const _providerCache = new Map<string, unknown>();

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function parseKeys(stored: string | null): string[] {
  if (!stored) return [];
  try {
    const arr = JSON.parse(stored);
    if (Array.isArray(arr)) return arr.filter(Boolean);
    if (typeof arr === "string") return [arr];
  } catch {}
  return stored.trim() ? [stored.trim()] : [];
}

// ---------------------------------------------------------------------------
// Key-rotation helpers
// ---------------------------------------------------------------------------

function pickKey(keys: string[]): string | null {
  const now = Date.now();
  const available = keys.filter((k) => {
    const until = _rateLimitedUntil.get(k);
    return !until || until <= now;
  });
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

function markRateLimited(key: string, durationMs = 60_000) {
  _rateLimitedUntil.set(key, Date.now() + durationMs);
  console.warn(
    `[Provider] Key ...${key.slice(-6)} rate limited for ${durationMs / 1000}s`,
  );
}

// ---------------------------------------------------------------------------
// Provider getters
// ---------------------------------------------------------------------------

export async function getGroqProvider(): Promise<{
  provider: ReturnType<typeof createGroq>;
  key: string;
}> {
  if (!_groqLoaded) {
    const stored = await invoke<string | null>("get_secret", {
      key: "groq_api_key",
    });
    _groqKeys = parseKeys(stored);
    _groqLoaded = true;
  }
  const key = pickKey(_groqKeys);
  if (!key)
    throw new Error(
      "Groq: no API keys configured or all keys are rate limited",
    );
  return { provider: createGroq({ apiKey: key }), key };
}

export async function getCerebrasProvider(): Promise<{
  provider: ReturnType<typeof createCerebras>;
  key: string;
}> {
  if (!_cerebrasLoaded) {
    const stored = await invoke<string | null>("get_secret", {
      key: "cerebras_api_key",
    });
    _cerebrasKeys = parseKeys(stored);
    _cerebrasLoaded = true;
  }
  const key = pickKey(_cerebrasKeys);
  if (!key)
    throw new Error(
      "Cerebras: no API keys configured or all keys are rate limited",
    );
  return { provider: createCerebras({ apiKey: key }), key };
}

export async function getOpenAIProvider(): Promise<{
  provider: ReturnType<typeof createOpenAI>;
  key: string;
}> {
  if (!_openaiLoaded) {
    const stored = await invoke<string | null>("get_secret", {
      key: "openai_api_key",
    });
    _openaiKeys = parseKeys(stored);
    _openaiLoaded = true;
  }
  const key = pickKey(_openaiKeys);
  if (!key)
    throw new Error(
      "OpenAI: no API keys configured or all keys are rate limited",
    );
  return { provider: createOpenAI({ apiKey: key }), key };
}

export async function getAnthropicProvider(): Promise<{
  provider: ReturnType<typeof createAnthropic>;
  key: string;
}> {
  if (!_anthropicLoaded) {
    const stored = await invoke<string | null>("get_secret", {
      key: "anthropic_api_key",
    });
    _anthropicKeys = parseKeys(stored);
    _anthropicLoaded = true;
  }
  const key = pickKey(_anthropicKeys);
  if (!key)
    throw new Error(
      "Anthropic: no API keys configured or all keys are rate limited",
    );
  return { provider: createAnthropic({ apiKey: key }), key };
}

export async function getOpenRouterProvider(): Promise<{
  provider: typeof openrouter;
  key: string;
}> {
  if (!_openrouterLoaded) {
    const stored = await invoke<string | null>("get_secret", {
      key: "openrouter_api_key",
    });
    _openrouterKeys = parseKeys(stored);
    _openrouterLoaded = true;
  }
  const key = pickKey(_openrouterKeys);
  if (!key)
    throw new Error(
      "OpenRouter: no API keys configured or all keys are rate limited",
    );
  return { provider: openrouter, key };
}

export async function getNvidiaProvider(): Promise<{
  provider: ReturnType<typeof createOpenAICompatible>;
  key: string;
}> {
  if (!_nvidiaLoaded) {
    const stored = await invoke<string | null>("get_secret", {
      key: "nvidia_api_key",
    });
    _nvidiaKeys = parseKeys(stored);
    _nvidiaLoaded = true;
  }
  const key = pickKey(_nvidiaKeys);
  if (!key)
    throw new Error(
      "NVIDIA: no API keys configured or all keys are rate limited",
    );
  const cacheKey = "nvidia";
  if (!_providerCache.has(cacheKey)) {
    _providerCache.set(cacheKey, createOpenAICompatible({
      name: "nvidia",
      baseURL: "https://integrate.api.nvidia.com/v1",
      apiKey: key,
    }));
  }
  return { 
    provider: _providerCache.get(cacheKey) as ReturnType<typeof createOpenAICompatible>,
    key
  };
}

export async function getGeminiProvider(): Promise<{
  provider: ReturnType<typeof createGoogleGenerativeAI>;
  key: string;
}> {
  if (!_geminiLoaded) {
    const stored = await invoke<string | null>("get_secret", {
      key: "gemini_api_key",
    });
    _geminiKeys = parseKeys(stored);
    _geminiLoaded = true;
  }
  const key = pickKey(_geminiKeys);
  if (!key)
    throw new Error(
      "Gemini API key not configured. Add it in Settings.",
    );
  return { provider: createGoogleGenerativeAI({ apiKey: key }), key };
}

export async function loadCustomProviders(): Promise<CustomProviderConfig[]> {
  if (!_customLoaded) {
    try {
      const stored = await invoke<string | null>("get_secret", {
        key: "custom_providers",
      });
      if (stored) {
        _customProviders = JSON.parse(stored);
      }
    } catch {
      _customProviders = [];
    }
    _customLoaded = true;
  }
  return _customProviders.filter((p) => p.enabled);
}

export async function getCustomProvider(
  config: CustomProviderConfig,
): Promise<{
  provider: ReturnType<typeof createOpenAICompatible>;
  model: (id: string) => LanguageModelV3;
  config: CustomProviderConfig;
}> {
  const cacheKey = `custom:${config.name}`;
  const cached = _providerCache.get(cacheKey);
  if (cached) {
    return {
      provider: cached as ReturnType<typeof createOpenAICompatible>,
      model: (id: string) =>
        (cached as ReturnType<typeof createOpenAICompatible>)(id) as LanguageModelV3,
      config,
    };
  }

  const provider = createOpenAICompatible({
    name: config.name,
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  });

  _providerCache.set(cacheKey, provider);

  return { provider, model: (id: string) => provider(id), config };
}

export async function getProvider(
  providerName: BuiltInProvider,
): Promise<{
  provider: unknown;
  key: string;
}> {
  switch (providerName) {
    case "groq": {
      const result = await getGroqProvider();
      return { provider: result.provider, key: result.key };
    }
    case "cerebras": {
      const result = await getCerebrasProvider();
      return { provider: result.provider, key: result.key };
    }
    case "openai": {
      const result = await getOpenAIProvider();
      return { provider: result.provider, key: result.key };
    }
    case "anthropic": {
      const result = await getAnthropicProvider();
      return { provider: result.provider, key: result.key };
    }
    case "openrouter": {
      const result = await getOpenRouterProvider();
      return { provider: result.provider, key: result.key };
    }
    case "nvidia": {
      const result = await getNvidiaProvider();
      return { provider: result.provider, key: result.key };
    }
    case "gemini": {
      const result = await getGeminiProvider();
      return { provider: result.provider, key: result.key };
    }
    default:
      throw new Error(`Unknown provider: ${providerName}`);
  }
}

export async function getAllProviders(): Promise<{
  groq: { provider: ReturnType<typeof createGroq>; key: string } | null;
  cerebras: { provider: ReturnType<typeof createCerebras>; key: string } | null;
  openai: { provider: ReturnType<typeof createOpenAI>; key: string } | null;
  anthropic: { provider: ReturnType<typeof createAnthropic>; key: string } | null;
  openrouter: { provider: unknown; key: string } | null;
  nvidia: { provider: ReturnType<typeof createOpenAICompatible>; key: string } | null;
  gemini: { provider: ReturnType<typeof createGoogleGenerativeAI>; key: string } | null;
  custom: Array<{ config: CustomProviderConfig; provider: ReturnType<typeof createOpenAICompatible> }>;
}> {
  let groq = null;
  let cerebras = null;
  let openai = null;
  let anthropic = null;
  let openrouter = null;
  let nvidia = null;
  let gemini = null;

  try {
    groq = await getGroqProvider();
  } catch {
    console.warn("[Provider] Groq not available");
  }

  try {
    cerebras = await getCerebrasProvider();
  } catch {
    console.warn("[Provider] Cerebras not available");
  }

  try {
    openai = await getOpenAIProvider();
  } catch {
    console.warn("[Provider] OpenAI not available");
  }

  try {
    anthropic = await getAnthropicProvider();
  } catch {
    console.warn("[Provider] Anthropic not available");
  }

  try {
    openrouter = await getOpenRouterProvider();
  } catch {
    console.warn("[Provider] OpenRouter not available");
  }

  try {
    nvidia = await getNvidiaProvider();
  } catch {
    console.warn("[Provider] NVIDIA not available");
  }

  try {
    gemini = await getGeminiProvider();
  } catch {
    console.warn("[Provider] Gemini not available");
  }

  const customConfigs = await loadCustomProviders();
  const custom = await Promise.all(
    customConfigs.map(async (config) => {
      const { provider } = await getCustomProvider(config);
      return { config, provider };
    }),
  );

  return { groq, cerebras, openai, anthropic, openrouter, nvidia, gemini, custom };
}

// ---------------------------------------------------------------------------
// Retry wrapper (Groq only — others fallback is handled at call-site)
// ---------------------------------------------------------------------------

export async function withGroqRetry<T>(
  fn: (provider: ReturnType<typeof createGroq>, key: string) => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { provider, key } = await getGroqProvider();
    try {
      return await fn(provider, key);
    } catch (e) {
      lastErr = e;
      const msg = String(e);
      if (
        msg.includes("429") ||
        msg.includes("rate_limit") ||
        msg.includes("Too Many Requests") ||
        msg.includes("RateLimitError")
      ) {
        console.warn(
          `[Provider] 429 on key ...${key.slice(-6)}, rotating (attempt ${attempt + 1}/${maxRetries})`,
        );
        markRateLimited(key);
      } else {
        throw e;
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

/** Invalidate cached keys (call after user updates settings). */
export function resetProviderCache() {
  _groqKeys = [];
  _cerebrasKeys = [];
  _openaiKeys = [];
  _anthropicKeys = [];
  _openrouterKeys = [];
  _nvidiaKeys = [];
  _geminiKeys = [];
  _customProviders = [];
  _groqLoaded = false;
  _cerebrasLoaded = false;
  _openaiLoaded = false;
  _anthropicLoaded = false;
  _openrouterLoaded = false;
  _nvidiaLoaded = false;
  _geminiLoaded = false;
  _customLoaded = false;
  _providerCache.clear();
}

// ---------------------------------------------------------------------------
// Multi-provider fallback with smart rate limiting
// ---------------------------------------------------------------------------

interface ProviderUsage {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  lastReset: number;
  consecutiveFailures: number;
}

const _providerUsage = new Map<BuiltInProvider, ProviderUsage>();
const DAILY_RESET_MS = 24 * 60 * 60 * 1000;

function getUsage(provider: BuiltInProvider): ProviderUsage {
  let usage = _providerUsage.get(provider);
  const now = Date.now();
  
  if (!usage || now - usage.lastReset > DAILY_RESET_MS) {
    usage = { totalTokens: 0, promptTokens: 0, completionTokens: 0, lastReset: now, consecutiveFailures: 0 };
    _providerUsage.set(provider, usage);
  }
  return usage;
}

function recordUsage(provider: BuiltInProvider, usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number }) {
  const stats = getUsage(provider);
  stats.promptTokens += usage.promptTokens ?? 0;
  stats.completionTokens += usage.completionTokens ?? 0;
  stats.totalTokens += usage.totalTokens ?? 0;
  stats.consecutiveFailures = 0;
  _providerUsage.set(provider, stats);
}

function recordFailure(provider: BuiltInProvider) {
  const stats = getUsage(provider);
  stats.consecutiveFailures++;
  _providerUsage.set(provider, stats);
}

function shouldSkipProvider(
  provider: BuiltInProvider,
  rateLimitConfig: Record<BuiltInProvider, { maxTokensPerDay: number; warnThreshold: number }>,
): string | null {
  const usage = getUsage(provider);
  const config = rateLimitConfig[provider];
  
  if (!config) return null;
  
  const usageRatio = usage.totalTokens / config.maxTokensPerDay;
  
  // Skip if over threshold
  if (usageRatio >= config.warnThreshold) {
    return `near daily limit (${Math.round(usageRatio * 100)}%)`;
  }
  
  // Skip if too many consecutive failures (likely rate limited)
  if (usage.consecutiveFailures >= 3) {
    return "too many consecutive failures";
  }
  
  return null;
}

export { shouldSkipProvider };

export async function generateTextWithFallback(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  tier: ModelTier,
  priorityConfig: ProviderPriorityConfig[],
  rateLimitConfig?: Record<BuiltInProvider, { maxTokensPerDay: number; warnThreshold: number }>,
  modelSelection?: { orchestrator: { provider: string; model: string }; fast: { provider: string; model: string }; powerful: { provider: string; model: string } },
): Promise<{
  text: string;
  finishReason: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  provider: string;
  model: string;
}> {
  const enabledProviders = priorityConfig
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

  for (const configEntry of enabledProviders) {
    const providerName = configEntry.provider;
    
    // Smart pre-check: skip providers near their limits
    const skipReason = shouldSkipProvider(providerName, config);
    if (skipReason) {
      console.log(`[Provider] Skipping ${providerName}: ${skipReason}`);
      continue;
    }
    
    console.log(`[Provider] Trying ${providerName} for ${tier}...`);

    try {
      const { provider } = await getProvider(providerName);
      
      // Get model for tier - either from config or default
      let modelId: string;
      if (modelSelection) {
        const selection = modelSelection[tier];
        modelId = selection.model;
      } else {
        modelId = getModelForTier(tier, providerName as BuiltInProvider);
      }
      
      // Handle Groq model ID prefix quirk
      if (providerName === "groq") {
        modelId = getGroqModelId(modelId);
      }
      
      const model = (provider as (id: string) => LanguageModelV3)(modelId);

      console.log(`[Provider] Calling ${providerName} model ${modelId}...`);

      const result = await generateText({
        model,
        messages,
        temperature: 0,
      });

      console.log(`[Provider] Success with ${providerName}:`, result.finishReason);
      
      // Record successful usage
      const usage = {
        promptTokens: (result.usage as { promptTokens?: number })?.promptTokens ?? 0,
        completionTokens: (result.usage as { completionTokens?: number })?.completionTokens ?? 0,
        totalTokens: (result.usage as { totalTokens?: number })?.totalTokens ?? 0,
      };
      recordUsage(providerName, usage);

      return {
        text: result.text,
        finishReason: result.finishReason || "unknown",
        usage,
        provider: providerName,
        model: modelId,
      };
    } catch (e) {
      lastError = e;
      const msg = String(e);
      console.warn(`[Provider] ${providerName} failed:`, msg);
      
      recordFailure(providerName);

      // Mark key as rate limited for certain errors
      if (msg.includes("429") || msg.includes("rate_limit") || msg.includes("Too Many Requests")) {
        try {
          const { key } = await getProvider(providerName);
          markRateLimited(key);
        } catch {}
      }
    }
  }

  // All providers failed
  throw new Error(`All providers failed. Last error: ${String(lastError)}`);
}

// ---------------------------------------------------------------------------
// Usage tracking exports
// ---------------------------------------------------------------------------

export function getProviderUsage(provider: BuiltInProvider): { totalTokens: number; promptTokens: number; completionTokens: number } | null {
  const usage = _providerUsage.get(provider);
  if (!usage) return null;
  return {
    totalTokens: usage.totalTokens,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
  };
}

export function getAllProviderUsage(): Record<BuiltInProvider, { totalTokens: number; promptTokens: number; completionTokens: number }> {
  const result = {} as Record<BuiltInProvider, { totalTokens: number; promptTokens: number; completionTokens: number }>;
  for (const [provider, usage] of _providerUsage) {
    result[provider] = {
      totalTokens: usage.totalTokens,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
    };
  }
  return result;
}

export function resetAllUsage() {
  _providerUsage.clear();
}