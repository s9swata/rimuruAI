/**
 * AI provider instances — lazily initialized, cached after first use.
 * Primary: Groq (all tiers) with multi-key rotation + rate-limit tracking.
 * Gemini kept as fallback provider.
 */

import { createGroq } from "@ai-sdk/groq";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { invoke } from "@tauri-apps/api/core";

let _groqKeys: string[] = [];
let _geminiKeys: string[] = [];
let _groqLoaded = false;
let _geminiLoaded = false;

/** key → expiry timestamp (ms) */
const _rateLimitedUntil = new Map<string, number>();

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

// ---------------------------------------------------------------------------
// Retry wrapper (Groq only — Gemini fallback is handled at call-site)
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
        throw e; // non-rate-limit error — don't retry
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
  _geminiKeys = [];
  _groqLoaded = false;
  _geminiLoaded = false;
}
