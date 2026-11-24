import {
  ApiError,
  GoogleGenAI,
  type Content,
  type GenerateContentParameters,
  type Part,
} from "@google/genai";
import type { ChatImage } from "@/lib/images";

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const TOTAL_STARTUP_BUDGET_MS = Number(process.env.GEMINI_STARTUP_BUDGET_MS ?? 12000) || 12000;
const MODEL_STARTUP_TIMEOUT_MS =
  Number(process.env.GEMINI_MODEL_STARTUP_TIMEOUT_MS ?? 4000) || 4000;
const CIRCUIT_BREAKER_COOLDOWN_MS =
  Math.max(1, Number(process.env.GEMINI_BREAKER_COOLDOWN_MS ?? 60000) || 60000);
const CIRCUIT_BREAKER_THRESHOLD =
  Math.max(1, Number(process.env.GEMINI_BREAKER_THRESHOLD ?? 2) || 2);
const CIRCUIT_BREAKER_WINDOW_MS =
  Math.max(1, Number(process.env.GEMINI_BREAKER_WINDOW_MS ?? 60000) || 60000);

export class StartupTimeoutError extends Error {
  constructor() {
    super("Model startup budget exceeded");
    this.name = "StartupTimeoutError";
  }
}

type GeminiBreakerState = {
  failures: Map<string, number[]>;
  openUntil: Map<string, number>;
};

const globalForGeminiBreaker = globalThis as unknown as {
  geminiBreaker?: GeminiBreakerState;
};
const breakerState =
  globalForGeminiBreaker.geminiBreaker ??
  (globalForGeminiBreaker.geminiBreaker = {
    failures: new Map(),
    openUntil: new Map(),
  });

export function resetGeminiCircuitBreaker() {
  breakerState.failures.clear();
  breakerState.openUntil.clear();
}

export function isGeminiModelCoolingDown(model: string, now = Date.now()) {
  const until = breakerState.openUntil.get(model);
  if (!until) return false;
  if (until <= now) {
    breakerState.openUntil.delete(model);
    breakerState.failures.delete(model);
    return false;
  }
  return true;
}

export function recordGeminiModelFailure(model: string, now = Date.now()) {
  const failures: number[] = (breakerState.failures.get(model) ?? []).filter(
    (time: number) => now - time < CIRCUIT_BREAKER_WINDOW_MS
  );
  failures.push(now);
  breakerState.failures.set(model, failures);
  if (failures.length >= CIRCUIT_BREAKER_THRESHOLD) {
    breakerState.openUntil.set(model, now + CIRCUIT_BREAKER_COOLDOWN_MS);
    breakerState.failures.delete(model);
  }
}

export function recordGeminiModelSuccess(model: string) {
  breakerState.failures.delete(model);
  breakerState.openUntil.delete(model);
}

export function geminiErrorStatus(err: unknown) {
  if (err instanceof ApiError) return err.status;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function isRetryable(err: unknown) {
  const status = geminiErrorStatus(err);
  return typeof status === "number" && RETRYABLE_STATUSES.has(status);
}

export function isGeminiModelFailure(err: unknown) {
  return err instanceof StartupTimeoutError || isRetryable(err);
}

export function paramsForGeminiModel(
  params: Omit<GenerateContentParameters, "model">,
  model: string
): Omit<GenerateContentParameters, "model"> {
  if (!model.includes("flash-lite") || !params.config?.thinkingConfig) return params;
  const config = { ...params.config };
  delete config.thinkingConfig;
  return { ...params, config };
}

export function getGeminiModels() {
  const fallbacks = (
    process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.5-flash,gemini-3.6-flash"
  )
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return [GEMINI_MODEL, ...fallbacks.filter((model) => model !== GEMINI_MODEL)];
}

export function getGeminiModelTimeoutMs() {
  return MODEL_STARTUP_TIMEOUT_MS;
}

export function withGeminiAbortTimeout<T>(
  request: (abortSignal: AbortSignal) => Promise<T>,
  ms: number,
  externalSignal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new StartupTimeoutError());
    }, ms);
  });

  return Promise.race([request(controller.signal), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  });
}

export async function generateContentStreamWithRetry(
  gemini: GoogleGenAI,
  params: Omit<GenerateContentParameters, "model">
) {
  const models = getGeminiModels();
  const deadline = Date.now() + TOTAL_STARTUP_BUDGET_MS;
  let lastError: unknown;

  for (const model of models) {
    const remaining = deadline - Date.now();
    if (remaining < 50) break;
    if (isGeminiModelCoolingDown(model)) {
      console.warn(`Gemini ${model} is cooling down, trying next model...`);
      continue;
    }
    try {
      const stream = await withGeminiAbortTimeout(
        (abortSignal) =>
          gemini.models.generateContentStream({
            ...paramsForGeminiModel(
              { ...params, config: { ...params.config, abortSignal } },
              model
            ),
            model,
          }),
        Math.min(MODEL_STARTUP_TIMEOUT_MS, remaining),
        params.config?.abortSignal
      );
      recordGeminiModelSuccess(model);
      return stream;
    } catch (err) {
      lastError = err;
      if (params.config?.abortSignal?.aborted) throw err;
      if (!isGeminiModelFailure(err)) throw err;
      recordGeminiModelFailure(model);
      const status = geminiErrorStatus(err);
      const detail = typeof status === "number" ? ` (${status})` : "";
      console.warn(
        err instanceof StartupTimeoutError
          ? `Gemini ${model} was too slow${detail}, trying next model...`
          : `Gemini ${model} unavailable${detail}, trying next model...`
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
