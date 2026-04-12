import { createGroq } from "@ai-sdk/groq";
import { streamText } from "ai";
import { invoke } from "@tauri-apps/api/core";

let _apiKey: string | null = null;

export async function getGroqProvider() {
  if (!_apiKey) {
    _apiKey = await invoke<string | null>("get_secret", { key: "groq_api_key" });
    console.log("[Groq] Got API key:", _apiKey ? "yes" : "no");
    if (!_apiKey) throw new Error("Groq API key not configured");
  }
  return createGroq({ apiKey: _apiKey });
}

export async function streamChat(
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  onChunk: (chunk: string) => void,
  onDone: () => void,
): Promise<void> {
  console.log("[Groq] streamChat called with model:", model);
  
  const groq = await getGroqProvider();
  console.log("[Groq] Calling createGroq provider via Vercel AI SDK...");
  
  try {
    const { textStream } = streamText({
      model: groq(model),
      messages,
      temperature: 0.7,
    });
    
    console.log("[Groq] streamText started");
    for await (const chunk of textStream) {
      if (chunk) onChunk(chunk);
    }
    console.log("[Groq] Stream done (AI SDK)");
    onDone();
  } catch (e) {
    console.error("[Groq] AI SDK stream error:", e);
    throw e;
  }
}