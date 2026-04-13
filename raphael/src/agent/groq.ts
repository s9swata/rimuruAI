import { streamText } from "ai";
import { MODELS } from "./prompts";
import { withGroqRetry, getGeminiProvider } from "./providers";

export async function streamChat(
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  onChunk: (chunk: string) => void,
  onDone: () => void,
): Promise<void> {
  console.log("[streamChat] model:", model);

  // Groq is primary with automatic key rotation + rate-limit retry.
  // Gemini is fallback only if Groq exhausts all retries / all keys are limited.
  let textStream: AsyncIterable<string>;

  try {
    const result = await withGroqRetry(async (provider) => {
      const modelInstance = provider(model);
      return streamText({
        model: modelInstance,
        messages,
        temperature: 0.7,
      });
    });
    textStream = result.textStream;
    console.log("[streamChat] using Groq provider:", model);
  } catch (e) {
    console.error("[streamChat] Groq failed, falling back to Gemini:", e);
    const { provider: gemini } = await getGeminiProvider();
    const result = streamText({
      model: gemini("gemini-flash-latest"),
      messages,
      temperature: 0.7,
    });
    textStream = result.textStream;
    console.log("[streamChat] using Gemini fallback");
  }

  try {
    for await (const chunk of textStream) {
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
