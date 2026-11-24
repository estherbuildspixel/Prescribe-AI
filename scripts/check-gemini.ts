import { config } from "dotenv";

config({ path: ".env" });

async function main() {
  const { getGemini } = await import("../src/lib/gemini");
  const { checkGeminiModels } = await import("../src/lib/gemini-health");
  const results = await checkGeminiModels(getGemini());

  for (const result of results) {
    const status = typeof result.status === "number" ? ` status=${result.status}` : "";
    const cooling = result.coolingDown ? " cooling" : "";
    const error = result.error ? ` ${result.error}` : "";
    console.log(
      `${result.ok ? "OK" : "FAIL"} ${result.model} ${result.durationMs}ms${status}${cooling}${error}`
    );
  }

  if (results.every((result) => !result.ok)) process.exitCode = 1;
}

void main();
