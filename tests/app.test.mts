import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedImageMimeType,
  parseChatImages,
  parseStoredImages,
  toDataUrl,
} from "../src/lib/images";
import { parseMarkdown } from "../src/lib/markdown";
import { createRateLimiter } from "../src/lib/rate-limit";
import { formatRelativeTime } from "../src/lib/time";
import { toChatTitle } from "../src/lib/titles";

const image = (data: string, mimeType = "image/jpeg") => ({ mimeType, data });

test("image mime types are restricted to the allowlist", () => {
  assert.equal(isAllowedImageMimeType("image/png"), true);
  assert.equal(isAllowedImageMimeType("image/svg+xml"), false);
});

test("parseChatImages drops invalid entries", () => {
  const result = parseChatImages([
    null,
    "nope",
    image(""),
    image("YWJj", "text/html"),
    { mimeType: "image/png", data: 42 },
    image("YWJj"),
  ]);
  assert.deepEqual(result, [image("YWJj")]);
});

test("parseChatImages enforces count, per-file and total limits", () => {
  const result = parseChatImages(
    [image("aaaa"), image("bbbb"), image("cccc"), image("dddd")],
    { maxImages: 3, maxBytes: 4, maxTotalBytes: 8 }
  );
  assert.deepEqual(result, [image("aaaa"), image("bbbb")]);
});

test("parseStoredImages keeps legacy data without size limits", () => {
  const result = parseStoredImages([image("x".repeat(100))]);
  assert.equal(result.length, 1);
  assert.equal(result[0].data.length, 100);
});

test("toDataUrl builds a valid data url", () => {
  assert.equal(toDataUrl(image("YWJj", "image/png")), "data:image/png;base64,YWJj");
});

test("parseMarkdown groups paragraphs, lists, headings and rules", () => {
  const blocks = parseMarkdown(
    "First line\ncontinued line\n\n- Take with food\n- Drink water\n\n## Notes\n\n1. One\n2. Two\n\n---"
  );
  assert.deepEqual(blocks, [
    { type: "p", text: "First line continued line" },
    { type: "ul", items: ["Take with food", "Drink water"] },
    { type: "heading", level: 2, text: "Notes" },
    { type: "ol", items: ["One", "Two"] },
    { type: "hr" },
  ]);
});

test("parseMarkdown handles empty text", () => {
  assert.deepEqual(parseMarkdown("   \n\n"), []);
});

test("toChatTitle collapses whitespace, handles empty and truncates", () => {
  assert.equal(toChatTitle("  Amoxicillin\n 500 mg  "), "Amoxicillin 500 mg");
  assert.equal(toChatTitle(""), "Prescription image");
  const long = toChatTitle("x".repeat(120));
  assert.equal(long.length, 80);
  assert.equal(long.endsWith("..."), true);
});

test("formatRelativeTime uses the supplied clock", () => {
  const now = Date.parse("2026-01-10T12:00:00Z");
  assert.equal(formatRelativeTime("2026-01-10T11:59:30Z", now), "Just now");
  assert.equal(formatRelativeTime("2026-01-10T11:00:00Z", now), "1h ago");
  assert.equal(formatRelativeTime("2026-01-08T12:00:00Z", now), "2d ago");
  assert.equal(formatRelativeTime("not-a-date", now), "");
});

test("rate limiter blocks excess requests and resets after the window", () => {
  let clock = 0;
  const allow = createRateLimiter(2, 100, () => clock);
  assert.equal(allow("client"), true);
  assert.equal(allow("client"), true);
  assert.equal(allow("client"), false);
  assert.equal(allow("other"), true);
  clock = 100;
  assert.equal(allow("client"), true);
});

process.env.GEMINI_STARTUP_BUDGET_MS = "60";
process.env.GEMINI_FALLBACK_MODEL = "fallback-a,fallback-b";
process.env.GEMINI_BREAKER_COOLDOWN_MS = "80";
process.env.GEMINI_BREAKER_THRESHOLD = "2";
process.env.GEMINI_BREAKER_WINDOW_MS = "1000";
const {
  generateContentStreamWithRetry,
  getGeminiModels,
  isGeminiModelCoolingDown,
  resetGeminiCircuitBreaker,
  toContents,
} = await import("../src/lib/gemini");
const { checkGeminiModels } = await import("../src/lib/gemini-health");

const fakeGemini = (attempts: string[], behavior: (call: number) => unknown) => ({
  models: {
    generateContentStream: async ({ model }: { model: string }) => {
      attempts.push(model);
      return behavior(attempts.length);
    },
  },
});

const fakeGeminiByModel = (attempts: string[], behavior: (model: string) => unknown) => ({
  models: {
    generateContentStream: async ({ model }: { model: string }) => {
      attempts.push(model);
      return behavior(model);
    },
  },
});

const retryableError = (status = 503) => {
  const err = new Error("busy") as Error & { status: number };
  err.status = status;
  return err;
};

test("gemini retry falls back on a retryable failure", async () => {
  resetGeminiCircuitBreaker();
  const attempts: string[] = [];
  const warn = console.warn;
  console.warn = () => {};
  try {
    const result = await generateContentStreamWithRetry(
      fakeGemini(attempts, (call) => {
        if (call === 1) {
          const err = new Error("busy") as Error & { status: number };
          err.status = 503;
          throw err;
        }
        return "stream";
      }) as never,
      { contents: [] }
    );
    assert.equal(result, "stream");
    assert.deepEqual(attempts, ["gemini-3.5-flash-lite", "fallback-a"]);
  } finally {
    console.warn = warn;
  }
});

test("gemini retry stops immediately on a non-retryable failure", async () => {
  resetGeminiCircuitBreaker();
  const attempts: string[] = [];
  const err = new Error("bad key") as Error & { status: number };
  err.status = 400;
  await assert.rejects(
    generateContentStreamWithRetry(fakeGemini(attempts, () => { throw err; }) as never, {
      contents: [],
    }),
    /bad key/
  );
  assert.deepEqual(attempts, ["gemini-3.5-flash-lite"]);
});

test("gemini retry respects the startup budget", async () => {
  resetGeminiCircuitBreaker();
  const attempts: string[] = [];
  const started = Date.now();
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(
      generateContentStreamWithRetry(
        fakeGemini(attempts, () => new Promise(() => {})) as never,
        { contents: [] }
      )
    );
    assert.ok(Date.now() - started < 500, "should fail fast instead of hanging");
    assert.equal(attempts.length, 1);
  } finally {
    console.warn = warn;
  }
});

test("gemini circuit breaker skips a model after repeated 503 failures", async () => {
  resetGeminiCircuitBreaker();
  const attempts: string[] = [];
  const primary = getGeminiModels()[0];
  const warn = console.warn;
  console.warn = () => {};
  const gemini = fakeGeminiByModel(attempts, (model) => {
    if (model === primary) throw retryableError();
    return "stream";
  });
  try {
    for (let i = 0; i < 2; i++) {
      await generateContentStreamWithRetry(gemini as never, { contents: [] });
    }
    assert.equal(isGeminiModelCoolingDown(primary), true);
    attempts.length = 0;
    const result = await generateContentStreamWithRetry(gemini as never, { contents: [] });
    assert.equal(result, "stream");
    assert.deepEqual(attempts, ["fallback-a"]);
  } finally {
    console.warn = warn;
  }
});

test("gemini circuit breaker allows a model back after cooldown", async () => {
  resetGeminiCircuitBreaker();
  const attempts: string[] = [];
  const primary = getGeminiModels()[0];
  const warn = console.warn;
  console.warn = () => {};
  const gemini = fakeGeminiByModel(attempts, (model) => {
    if (model === primary) throw retryableError();
    return "stream";
  });
  try {
    for (let i = 0; i < 2; i++) {
      await generateContentStreamWithRetry(gemini as never, { contents: [] });
    }
    assert.equal(isGeminiModelCoolingDown(primary), true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(isGeminiModelCoolingDown(primary), false);
    attempts.length = 0;
    await generateContentStreamWithRetry(gemini as never, { contents: [] });
    assert.equal(attempts[0], primary);
  } finally {
    console.warn = warn;
  }
});

test("gemini health check reports model status and clears recovered breakers", async () => {
  resetGeminiCircuitBreaker();
  const primary = getGeminiModels()[0];
  const warn = console.warn;
  console.warn = () => {};
  const failing = fakeGeminiByModel([], (model) => {
    if (model === primary) throw retryableError();
    return "stream";
  });
  try {
    for (let i = 0; i < 2; i++) {
      await generateContentStreamWithRetry(failing as never, { contents: [] });
    }
    assert.equal(isGeminiModelCoolingDown(primary), true);

    const results = await checkGeminiModels(
      fakeGeminiByModel([], (model) => {
        if (model === "fallback-a") throw retryableError();
        return "stream";
      }) as never,
      { models: [primary, "fallback-a"] }
    );
    assert.deepEqual(
      results.map(({ model, ok }) => [model, ok]),
      [
        [primary, true],
        ["fallback-a", false],
      ]
    );
    assert.equal(results[0].coolingDown, true);
    assert.equal(results[1].status, 503);
    assert.equal(isGeminiModelCoolingDown(primary), false);
  } finally {
    console.warn = warn;
  }
});

test("toContents maps roles and attaches images", () => {
  const contents = toContents([
    { role: "USER", content: "hello", images: [{ mimeType: "image/png", data: "abc" }] },
    { role: "ASSISTANT", content: "hi" },
  ]);
  assert.deepEqual(contents, [
    {
      role: "user",
      parts: [
        { text: "hello" },
        { inlineData: { mimeType: "image/png", data: "abc" } },
      ],
    },
    { role: "model", parts: [{ text: "hi" }] },
  ]);
});
