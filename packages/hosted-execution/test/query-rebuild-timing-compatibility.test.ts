import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
import { test } from "vitest";
import { addCliPhaseSample, CLI_TIMING_PHASES, emptyCliTiming, normalizeCliTiming } from "@murphai/runtime-state/cli-timing";
import { parseAssistantUsageRecord } from "../src/assistant-usage.ts";

// Follow the existing timing compatibility tests: run the actual pre-admission
// source from history, not a hand-written "old reader" or a current roundtrip.
// Parent supplies the reviewed main base; no repository/network mutation occurs.
const compatibilityBase = process.env.MURPH_CLI_QUERY_REBUILD_COMPAT_BASE;
test.skipIf(!compatibilityBase)("actual eleven-phase reader drops optional new timing, never legacy usage or tool totals", async () => {
  assert.match(compatibilityBase ?? "", /^[a-f0-9]{40}$/u);
  const sourceAtBase = (file: string) => execFileSync("git", ["show", `${compatibilityBase}:${file}`],
    { encoding: "utf8", maxBuffer: 1_000_000 });
  const moduleUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`;
  const timingUrl = moduleUrl(sourceAtBase("packages/runtime-state/src/cli-timing.ts"));
  const oldTiming: Pick<typeof import("@murphai/runtime-state/cli-timing"), "CLI_TIMING_PHASES" | "normalizeCliTiming"> = await import(timingUrl);
  assert.deepEqual(oldTiming.CLI_TIMING_PHASES, CLI_TIMING_PHASES.slice(0, 11));
  const usageSource = sourceAtBase("packages/hosted-execution/src/assistant-usage.ts");
  const timingImport = 'from "@murphai/runtime-state/cli-timing"';
  assert.equal(usageSource.split(timingImport).length, 2);
  const oldUsage: Pick<typeof import("../src/assistant-usage.ts"), "parseAssistantUsageRecord"> = await import(
    moduleUrl(usageSource.replace(timingImport, `from "${timingUrl}"`)));

  const legacy = emptyCliTiming();
  legacy.reportCount = 1;
  legacy.commands.push({ command: "search query", calls: 2, outcome: "ok", phases: [] });
  addCliPhaseSample(legacy.commands[0]!.phases, "total", 39_000_000);
  addCliPhaseSample(legacy.commands[0]!.phases, "query-rebuild", 37_000_000);
  assert.deepEqual(oldTiming.normalizeCliTiming(legacy), legacy);
  const expanded = structuredClone(legacy);
  for (const phase of CLI_TIMING_PHASES) {
    if (!expanded.commands[0]!.phases.some(entry => entry.phase === phase)) {
      addCliPhaseSample(expanded.commands[0]!.phases, phase, 1_000);
    }
  }
  // Prove both old guards: an unknown name below eleven entries, and the full
  // seventeen-entry shape. The OLD reader rejects the entire optional summary.
  const candidates = [expanded, ...CLI_TIMING_PHASES.slice(11).map(phase => {
    const timing = structuredClone(legacy);
    addCliPhaseSample(timing.commands[0]!.phases, phase, 1_000);
    return timing;
  })];
  for (const timing of candidates) {
    assert.deepEqual(normalizeCliTiming(timing), timing);
    assert.equal(oldTiming.normalizeCliTiming(timing), null);
  }

  for (const version of ["v1", "v2"] as const) {
    const profile = { schema: `murph.assistant-turn-profile.${version}`, modelContextWindow: 128_000,
      requestCount: 1, requests: [{ input: 17, cachedInput: 3, output: 11 }], requestsTruncated: false,
      toolsTruncated: false, tools: version === "v1"
        ? [{ label: "shell", calls: 2, failedCalls: 1, durationMs: 123, outputChars: 456 }]
        : [{ kind: "command", label: "search", calls: 2, failedCalls: 1, durationKnownCalls: 2,
          durationMs: 123, outputBytesTotal: 456, outputBytesMax: 300 }] };
    const input = { schema: "murph.assistant-usage.v1", provider: "codex-cli", credentialSource: "platform",
      occurredAt: "2026-09-17T00:00:00Z", sessionId: "synthetic-session", turnId: "synthetic-turn",
      usageId: "synthetic-turn.attempt-1", attemptCount: 1, inputTokens: 17, cachedInputTokens: 3,
      outputTokens: 11, totalTokens: 28, rawUsageJson: { input_tokens: 17, output_tokens: 11 }, turnProfileJson: profile };
    const baseline = oldUsage.parseAssistantUsageRecord(input);
    assert.ok(baseline.turnProfileJson);
    assert.deepEqual(parseAssistantUsageRecord(input), baseline);
    const withTiming = (cliTiming: unknown) => ({ ...input, turnProfileJson: { ...profile, cliTiming } });
    for (const timing of candidates) {
      assert.deepEqual(oldUsage.parseAssistantUsageRecord(withTiming(timing)), baseline);
      assert.deepEqual(parseAssistantUsageRecord(withTiming(timing)), {
        ...baseline, turnProfileJson: { ...baseline.turnProfileJson, cliTiming: timing },
      });
    }
    assert.deepEqual(oldUsage.parseAssistantUsageRecord(withTiming(legacy)),
      parseAssistantUsageRecord(withTiming(legacy)));
  }
});
