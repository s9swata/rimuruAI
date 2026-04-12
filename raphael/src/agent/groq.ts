import Groq from "groq-sdk";
import { invoke } from "@tauri-apps/api/core";

/** Strip <think>...</think> reasoning blocks emitted by Qwen3 / DeepSeek-R1 style models.
 *  Also handles truncated (unclosed) think blocks caused by max_tokens limits. */
function stripThinking(text: string): string {
  // Strip complete blocks first
  let result = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  // Strip any remaining unclosed block (truncated by token limit)
  const openIdx = result.indexOf("<think>");
  if (openIdx !== -1) result = result.slice(0, openIdx).trim();
  return result;
}

let _client: Groq | null = null;
let _apiKey: string | null = null;

export async function getGroqClient(): Promise<Groq> {
  if (_client) return _client;
  _apiKey = await invoke<string | null>("get_secret", { key: "groq_api_key" });
  console.log("[Groq] Got API key:", _apiKey ? "yes" : "no");
  if (!_apiKey) throw new Error("Groq API key not configured");
  _client = new Groq({ apiKey: _apiKey, dangerouslyAllowBrowser: true });
  console.log("[Groq] Client initialized");
  return _client;
}

async function fetchDirect(
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  maxTokens = 4096,
): Promise<string> {
  if (!_apiKey) throw new Error("No API key");
  console.log("[Groq] Using fetch direct to https://api.groq.com/openai/v1/chat/completions");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${_apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      max_tokens: maxTokens,
    }),
  });
  
  console.log("[Groq] Fetch response status:", res.status);
  const text = await res.text();
  console.log("[Groq] Fetch response preview:", text.substring(0, 200));
  
  if (!text.startsWith("{")) {
    throw new Error(`Got non-JSON response: ${text.substring(0, 500)}`);
  }
  
  const json = JSON.parse(text);
  return stripThinking(json.choices?.[0]?.message?.content ?? "");
}

export async function streamChat(
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  onChunk: (chunk: string) => void,
  onDone: () => void,
): Promise<void> {
  console.log("[Groq] streamChat called with model:", model);
  
  // Try fetch first with streaming
  try {
    if (!_apiKey) {
      await getGroqClient();
    }
    console.log("[Groq] Using fetch for streaming...");
    
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${_apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });
    
    console.log("[Groq] Fetch stream status:", res.status);
    
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Fetch failed: ${res.status} - ${text.substring(0, 200)}`);
    }
    
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    
    if (!reader) {
      throw new Error("No response body reader");
    }
    
    console.log("[Groq] Fetch stream started");
    let buffer = "";
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data: ")) {
          const data = trimmed.slice(6);
          if (data === "[DONE]") {
            console.log("[Groq] Stream done (fetch)");
            onDone();
            return;
          }
          try {
            const json = JSON.parse(data);
            const text = json.choices?.[0]?.delta?.content;
            if (text) onChunk(text);
          } catch {}
        }
      }
    }
    
    console.log("[Groq] Stream done (fetch)");
    onDone();
    return;
  } catch (e) {
    console.log("[Groq] Fetch stream failed, trying SDK:", e);
  }
  
  // Fallback to SDK
  const groq = await getGroqClient();
  console.log("[Groq] Calling Groq SDK...");
  
  try {
    const stream = await groq.chat.completions.create({
      model,
      messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 1024,
    });
    console.log("[Groq] SDK Stream started");
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? "";
      if (text) onChunk(text);
    }
    console.log("[Groq] Stream done (SDK)");
    onDone();
  } catch (e) {
    console.error("[Groq] SDK stream error:", e);
    throw e;
  }
}

export async function completeJSON(
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  maxTokens = 4096,
): Promise<string> {
  console.log("[Groq] completeJSON called with model:", model);

  // Try fetch first (bypasses SDK issues)
  try {
    return await fetchDirect(model, messages, maxTokens);
  } catch (e) {
    console.log("[Groq] Fetch failed, trying SDK:", e);
  }

  // Fallback to SDK
  const groq = await getGroqClient();
  console.log("[Groq] Calling Groq SDK...");

  try {
    const response = await groq.chat.completions.create({
      model,
      messages,
      stream: false,
      temperature: 0,
      max_tokens: maxTokens,
    });
    console.log("[Groq] SDK Response received");
    const content = stripThinking(response.choices[0]?.message?.content ?? "");
    console.log("[Groq] Content length:", content.length);
    return content;
  } catch (e: unknown) {
    console.error("[Groq] SDK error full:", e);
    let errorDetails = String(e);
    if (e && typeof e === 'object') {
      const err = e as { message?: string; response?: { status?: number; statusText?: string } };
      errorDetails = JSON.stringify({
        message: err.message,
        status: err.response?.status,
        statusText: err.response?.statusText
      });
    }
    console.error("[Groq] Error details:", errorDetails);
    throw new Error(`Groq API error: ${errorDetails}`);
  }
}