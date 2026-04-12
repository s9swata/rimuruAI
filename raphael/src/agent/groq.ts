import Groq from "groq-sdk";
import { invoke } from "@tauri-apps/api/core";

let _client: Groq | null = null;

export async function getGroqClient(): Promise<Groq> {
  if (_client) return _client;
  const key = await invoke<string | null>("get_secret", { key: "groq_api_key" });
  if (!key) throw new Error("Groq API key not configured");
  _client = new Groq({ apiKey: key, dangerouslyAllowBrowser: true });
  return _client;
}

export async function streamChat(
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  onChunk: (chunk: string) => void,
  onDone: () => void,
): Promise<void> {
  const groq = await getGroqClient();
  const stream = await groq.chat.completions.create({
    model,
    messages,
    stream: true,
    temperature: 0.7,
    max_tokens: 1024,
  });
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content ?? "";
    if (text) onChunk(text);
  }
  onDone();
}

export async function completeJSON(
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
): Promise<string> {
  const groq = await getGroqClient();
  const response = await groq.chat.completions.create({
    model,
    messages,
    stream: false,
    temperature: 0,
    max_tokens: 512,
  });
  return response.choices[0]?.message?.content ?? "";
}