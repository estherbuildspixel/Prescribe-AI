import type { GoogleGenAI } from "@google/genai";
import {
  geminiErrorStatus,
  getGeminiModelTimeoutMs,
  getGeminiModels,
  isGeminiModelCoolingDown,
  isGeminiModelFailure,
  paramsForGeminiModel,
  recordGeminiModelFailure,
  recordGeminiModelSuccess,
  withGeminiAbortTimeout,
} from "./gemini";

export type GeminiHealthResult = {
  model: string;
  ok: boolean;
  coolingDown: boolean;
  status?: number;
  durationMs: number;
  error?: string;
};

export async function checkGeminiModels(
  gemini: GoogleGenAI,
  options: {
    models?: string[];
    timeoutMs?: number;
    contents?: string;
    maxOutputTokens?: number;
  } = {}
): Promise<GeminiHealthResult[]> {
  const models = options.models ?? getGeminiModels();
  const timeoutMs = options.timeoutMs ?? getGeminiModelTimeoutMs();
  const contents = options.contents ?? "Reply with OK.";
  const maxOutputTokens = options.maxOutputTokens ?? 8;

  return Promise.all(
    models.map(async (model) => {
      const started = Date.now();
      const coolingDown = isGeminiModelCoolingDown(model);
      try {
        await withGeminiAbortTimeout(
          (abortSignal) =>
            gemini.models.generateContentStream({
              ...paramsForGeminiModel(
                { contents, config: { maxOutputTokens, abortSignal } },
                model
              ),
              model,
            }),
          timeoutMs
        );
        recordGeminiModelSuccess(model);
        return { model, ok: true, coolingDown, durationMs: Date.now() - started };
      } catch (err) {
        if (isGeminiModelFailure(err)) recordGeminiModelFailure(model);
        return {
          model,
          ok: false,
          coolingDown,
          status: geminiErrorStatus(err),
          durationMs: Date.now() - started,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );
}
