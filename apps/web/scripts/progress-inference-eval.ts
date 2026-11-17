/** Live synthetic eval: tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/progress-inference-eval.ts. */
import cases from "../test/fixtures/progress-inference.json";
import { inferTask, inferenceClient, normalizeTask } from "../src/lib/game/progress/infer";

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is required. No files or production secrets are loaded.");
    process.exitCode = 2;
    return;
  }
  const client = inferenceClient();
  let failures = 0;
  for (const item of cases) {
    const start = performance.now();
    const actual = await inferTask({ text: normalizeTask(item.text), kind: "photo" }, client);
    const passed = actual !== null && actual.quantity === item.expected.quantity && actual.unit === item.expected.unit && actual.name === item.expected.name;
    if (!passed) failures++;
    // Even synthetic task text and provider output stay out of logs.
    console.log(`${item.id}: ${passed ? "PASS" : actual === null ? "UNAVAILABLE" : "FAIL"} (${Math.round(performance.now() - start)} ms)`);
  }
  console.log(`${cases.length - failures}/${cases.length} passed`);
  process.exitCode = failures === 0 ? 0 : 1;
}
main().catch(() => { console.error("Progress inference eval failed."); process.exitCode = 1; });
