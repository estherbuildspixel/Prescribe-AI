import {
  ApiError,
  GoogleGenAI,
  type Content,
  type GenerateContentParameters,
  type Part,
} from "@google/genai";
import type { ChatImage } from "@/lib/images";

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const STARTUP_BUDGET_MS = Number(process.env.GEMINI_STARTUP_BUDGET_MS ?? 1800) || 1800;

class StartupTimeoutError extends Error {
  constructor() {
    super("Model startup budget exceeded");
    this.name = "StartupTimeoutError";
  }
}

function isRetryable(err: unknown) {
  const status = err instanceof ApiError ? err.status : (err as { status?: unknown }).status;
  return typeof status === "number" && RETRYABLE_STATUSES.has(status);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StartupTimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function generateContentStreamWithRetry(
  gemini: GoogleGenAI,
  params: Omit<GenerateContentParameters, "model">
) {
  const fallbacks = (
    process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.5-flash,gemini-3.6-flash"
  )
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const models = [GEMINI_MODEL, ...fallbacks.filter((model) => model !== GEMINI_MODEL)];
  const deadline = Date.now() + STARTUP_BUDGET_MS;
  let lastError: unknown;

  for (const model of models) {
    const remaining = deadline - Date.now();
    if (remaining < 50) break;
    try {
      return await withTimeout(
        gemini.models.generateContentStream({ ...params, model }),
        remaining
      );
    } catch (err) {
      lastError = err;
      if (params.config?.abortSignal?.aborted) throw err;
      if (!(err instanceof StartupTimeoutError) && !isRetryable(err)) throw err;
      console.warn(
        err instanceof StartupTimeoutError
          ? `Gemini ${model} was too slow, trying next model...`
          : `Gemini ${model} unavailable, trying next model...`
      );
    }
  }

  throw lastError ?? new StartupTimeoutError();
}

const globalForGemini = globalThis as unknown as {
  gemini: GoogleGenAI | undefined;
};

export function getGemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY") {
    throw new Error(
      "GEMINI_API_KEY is missing. Get a key at https://aistudio.google.com/apikey and add it to .env"
    );
  }
  if (!globalForGemini.gemini) {
    globalForGemini.gemini = new GoogleGenAI({ apiKey });
  }
  return globalForGemini.gemini;
}

export const SYSTEM_INSTRUCTION = `You translate prescriptions into plain English for patients.

Explain the medicine name, dose, timing, and instructions. For photos, read the label carefully and say when something is unclear instead of guessing.

Never give medical advice. Only explain what the words mean.

Stay under 150 words. Start with the meaning, not the question. Use short sentences and simple markdown lists. No em dashes or asterisks.`;

export type HistoryMessage = {
  role: string;
  content: string;
  images?: ChatImage[];
};

export function toContents(history: HistoryMessage[]): Content[] {
  return history.map((message) => {
    const parts: Part[] = [];
    if (message.content.trim()) {
      parts.push({ text: message.content });
    }
    for (const image of message.images ?? []) {
      parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
    }
    if (parts.length === 0) {
      parts.push({ text: "" });
    }
    return {
      role: message.role === "ASSISTANT" ? "model" : "user",
      parts,
    };
  });
}
