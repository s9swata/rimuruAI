import { GoogleGenAI } from "@google/genai";
import { invoke } from "@tauri-apps/api/core";

let genaiClient: GoogleGenAI | null = null;
let cachedApiKey: string | null = null;

const uploadedFileNames = new Set<string>();

async function getGenAIClient(): Promise<GoogleGenAI> {
  if (genaiClient && cachedApiKey) return genaiClient;

  const apiKey = await invoke<string | null>("get_secret", {
    key: "gemini_api_key",
  });
  if (!apiKey) {
    throw new Error("Gemini API key not configured. Add it in Settings.");
  }

  // Keys are stored as JSON arrays ["key1","key2"] by the multi-key UI — extract first
  let resolvedKey = apiKey.trim();
  if (resolvedKey.startsWith("[")) {
    try {
      const arr = JSON.parse(resolvedKey) as string[];
      resolvedKey = arr.find((k) => k.length > 0) ?? resolvedKey;
    } catch {}
  }

  cachedApiKey = resolvedKey;
  genaiClient = new GoogleGenAI({ apiKey: resolvedKey });
  return genaiClient;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] || result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function saveFileToTemp(file: File): Promise<string> {
  const base64 = await blobToBase64(file);
  const filePath = await invoke<string>("save_temp_file", {
    fileName: file.name,
    data: base64,
  });
  console.log("[fileAnalysis] Saved file to temp:", filePath);
  return filePath;
}

async function embedFileViaRust(filePath: string, mimeType: string): Promise<number[]> {
  console.log("[fileAnalysis] Calling Rust embed_file with filePath:", filePath, "mimeType:", mimeType);
  try {
    const embedding = await invoke<number[]>("embed_file", {
      filePath,
      mimeType,
    });
    console.log("[fileAnalysis] Rust embed_file result length:", embedding.length);
    return embedding;
  } catch (error) {
    console.error("[fileAnalysis] Rust embed_file error:", error);
    throw error;
  }
}

export async function embedContent(
  content: string | File,
  mimeType?: string,
): Promise<number[]> {
  if (content instanceof File) {
    const filePath = await saveFileToTemp(content);
    return embedFileViaRust(filePath, mimeType || content.type);
  }
  
  const client = await getGenAIClient();

  const contents = [
    {
      text: content,
    },
  ];

  const response = await client.models.embedContent({
    model: "gemini-embedding-001",
    contents,
  });

  return response.embeddings?.[0]?.values ?? [];
}

async function extractTextWithGemini(file: File): Promise<string> {
  const client = await getGenAIClient();

  const uploadedFile = await client.files.upload({
    file,
    config: { mimeType: file.type },
  });

  console.log("[fileAnalysis] Gemini file uploaded:", uploadedFile.uri);

  const isImage = file.type.startsWith("image/");
  const prompt = isImage
    ? "Describe this image in detail. Include all visible text, objects, layout, colors, and any other relevant information."
    : "Extract all text from this document verbatim. Preserve question numbers, answer choices, headings, and structure exactly as they appear. Output only the extracted text, nothing else.";

  const response = await client.models.generateContent({
    model: "gemini-flash-latest",
    contents: [
      {
        parts: [
          {
            fileData: {
              mimeType: file.type,
              fileUri: uploadedFile.uri,
            },
          },
          { text: prompt },
        ],
      },
    ],
  });

  return response.text ?? "";
}

function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start += chunkSize - overlap;
  }
  return chunks;
}

export async function analyzeDocument(file: File): Promise<{
  fileName: string;
  fileType: string;
  chunksStored?: number;
  error?: string;
}> {
  const fileName = file.name;
  const fileType = file.type;
  console.log("[fileAnalysis] Analyzing document:", fileName, fileType);

  const supported = fileType === "application/pdf" || fileType === "text/plain" || fileType.startsWith("image/");
  if (!supported) {
    return { fileName, fileType, error: `Unsupported file type: ${fileType}` };
  }

  try {
    // 1. Extract text via Gemini Flash (accurate layout-aware extraction)
    console.log("[fileAnalysis] Extracting text with Gemini Flash...");
    const text = await extractTextWithGemini(file);
    console.log("[fileAnalysis] Extracted text length:", text.length);

    if (!text || text.trim().length === 0) {
      return { fileName, fileType, error: "No text could be extracted from file" };
    }

    // 2. Chunk the text (~1500 chars with 200 char overlap to keep questions intact)
    const chunks = chunkText(text, 1500, 200);
    console.log("[fileAnalysis] Chunks:", chunks.length);

    // 3. Embed each chunk (use text embedding, not file embedding)
    const embeddedChunks: { chunkIndex: number; text: string; embedding: number[] }[] = [];
    let embedErrors = 0;

    for (let i = 0; i < chunks.length; i++) {
      try {
        const embedding = await embedContent(chunks[i]);
        embeddedChunks.push({ chunkIndex: i, text: chunks[i], embedding });
        console.log(`[fileAnalysis] Embedded chunk ${i + 1}/${chunks.length}`);
      } catch (e) {
        embedErrors++;
        console.warn(`[fileAnalysis] Failed to embed chunk ${i + 1}/${chunks.length}:`, e);
      }
    }

    if (embeddedChunks.length === 0) {
      return { fileName, fileType, error: `Failed to embed any chunks (${embedErrors} errors)` };
    }

    if (embedErrors > 0) {
      console.warn(`[fileAnalysis] ${embedErrors}/${chunks.length} chunks failed to embed, continuing with ${embeddedChunks.length} successful`);
    }

    // 4. Store chunks via Rust
    await invoke("store_chunks", { fileName, chunks: embeddedChunks });
    console.log("[fileAnalysis] Stored", embeddedChunks.length, "chunks for", fileName);
    uploadedFileNames.add(fileName);

    return { fileName, fileType, chunksStored: embeddedChunks.length };
  } catch (error) {
    console.error("[fileAnalysis] Error:", error);
    return { fileName, fileType, error: String(error) };
  }
}

export async function queryDocument(question: string, topK = 5): Promise<string> {
  console.log("[fileAnalysis] Querying document store:", question);

  const positional = /\b(first|last|beginning|start|question\s*1|q1|number\s*1|#1)\b/i.test(question);
  const queryEmbedding = await embedContent(question);

  // For positional queries fetch more candidates and always include early chunks
  const fetchK = positional ? Math.max(topK, 8) : topK;
  const fileNamesFilter = uploadedFileNames.size > 0 ? Array.from(uploadedFileNames) : undefined;
  const results = await invoke<{ fileName: string; chunkIndex: number; text: string; score: number }[]>(
    "search_chunks",
    { queryEmbedding, topK: fetchK, fileNames: fileNamesFilter }
  );

  if (!results || results.length === 0) {
    return "No relevant document content found.";
  }

  let finalResults = results;
  if (positional) {
    // Ensure the first two chunks are always included for positional queries
    const earlyChunks = await invoke<{ fileName: string; chunkIndex: number; text: string; score: number }[]>(
      "search_chunks",
      { queryEmbedding: new Array(queryEmbedding.length).fill(0), topK: 100, fileNames: fileNamesFilter }
    ).then(all => all.filter(r => r.chunkIndex <= 1));

    const seen = new Set(results.map(r => r.chunkIndex));
    const merged = [...earlyChunks.filter(r => !seen.has(r.chunkIndex)), ...results];
    finalResults = merged.sort((a, b) => a.chunkIndex - b.chunkIndex).slice(0, topK + 2);
  }

  return finalResults
    .map((r, i) => `[Chunk ${i + 1} from "${r.fileName}" (position: ${r.chunkIndex}, score: ${r.score.toFixed(3)})]:\n${r.text}`)
    .join("\n\n");
}

export interface UploadedFile {
  id: string;
  file: File;
  name: string;
  type: string;
  size: number;
  status: "pending" | "processing" | "ready" | "error";
  textContent?: string;
  embedding?: number[];
  error?: string;
}

export async function pickFile(): Promise<File | null> {
  // This function is deprecated - use HTML5 file input instead
  // The invoke("pick_file") command was removed for security reasons
  console.warn("pickFile() is deprecated - use file input element instead");
  return null;
}

// Helper function to create file input and handle file selection
export function createFileInput(onFileSelect: (file: File) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = false;
  input.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      onFileSelect(file);
    }
  });
  return input;
}
