import assert from "node:assert/strict";
import { test } from "vitest";
import { readHostedUsageRecordRequestForTest } from "#hosted-web-testing";
import {
  ASSISTANT_TURN_PROFILE_SCHEMA,
  ASSISTANT_TURN_PROFILE_SCHEMA_V1,
  ASSISTANT_USAGE_SCHEMA,
  parseAssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import {
  HOSTED_USAGE_RECORD_BODY_LIMIT_BYTES,
  type HostedRuntimeUsageNoticeDeliveryTarget,
  type HostedRuntimeUsageRecordRequest,
} from "@murphai/hosted-execution/runtime-control";
import {
  addCliPhaseSample,
  CLI_TIMING_MAX_COMMANDS,
  CLI_TIMING_MAX_REPORT_BYTES,
  CLI_TIMING_MAX_REPORTS,
  CLI_TIMING_PHASES,
  emptyCliTiming,
  mergeCliTiming,
  normalizeCliTiming,
  type CliTiming,
} from "@murphai/runtime-state/cli-timing";
import {
  finishCliTimingAction,
  timeCliDispatch,
  timeCliPhase,
  withCliTiming,
} from "@murphai/runtime-state/node/cli-timing";
import { createHostedRuntimeUsageRecordPort } from "../src/runtime-platform/usage-record-port.ts";

const limit = HOSTED_USAGE_RECORD_BODY_LIMIT_BYTES;
const roots = [
  "goal list", "family list", "food list", "protocol list", "regimen list",
  "recipe list", "provider list", "genetics list", "automation list", "habitat list",
  "allergy list", "condition list",
  "wearables activity list", "wearables body list", "wearables day", "wearables drift",
  "wearables latest", "wearables metric latest", "wearables metric trend", "wearables patterns",
  "wearables recovery list", "wearables sleep list", "wearables sleep pattern", "wearables sources list",
];

// Real scopes/merge, synthetic callbacks and monotonic clock, not CLI handler or
// provider execution. Every call is a separate root, so packet trimming cannot
// bound the turn aggregate. The first ten have lifecycle phases only.
async function mixedRootTiming(): Promise<CliTiming> {
  const timing = emptyCliTiming();
  const clock = process.hrtime.bigint;
  let tick = 0n;
  process.hrtime.bigint = () => tick;
  try {
    for (const [index, command] of roots.entries()) {
      await withCliTiming(async () => {
        tick += 100_000_000n;
        await timeCliDispatch(command, async () => {
          if (index >= 10) {
            await timeCliPhase("query-freshness", async () => {
              await timeCliPhase("query-manifest", async () => { tick += 1_000_000_000n; });
              await timeCliPhase("query-status", async () => { tick += 1_000_000_000n; });
            });
          }
          tick += 1_000_000_000n;
        });
        tick += 100_000_000n;
        finishCliTimingAction();
        await timeCliPhase("teardown", async () => { tick += 100_000_000n; });
      }, (report) => {
        assert.ok(Buffer.byteLength(JSON.stringify(report)) < CLI_TIMING_MAX_REPORT_BYTES - 256);
        mergeCliTiming(timing, report);
      });
    }
  } finally {
    process.hrtime.bigint = clock;
  }
  assert.equal(timing.reportCount, 24);
  assert.equal(timing.commands.length, 24);
  assert.equal(timing.droppedCalls, 0);
  assert.equal(timing.transportTruncated, false);
  assert.deepEqual(normalizeCliTiming(timing), timing);
  return timing;
}

function legacyRequest(noticeDeliveryTarget?: HostedRuntimeUsageNoticeDeliveryTarget | null): HostedRuntimeUsageRecordRequest {
  return {
    ...(noticeDeliveryTarget === undefined ? {} : { noticeDeliveryTarget }),
    usage: parseAssistantUsageRecord({
      schema: ASSISTANT_USAGE_SCHEMA, provider: "codex-cli", credentialSource: "platform",
      occurredAt: "2026-09-01T12:00:00.000Z", sessionId: "synthetic-session", turnId: "synthetic-turn",
      usageId: "synthetic-turn.request-2.attempt-1", attemptCount: 1, stripeMeterSource: "murph",
      inputTokens: 53, cachedInputTokens: 7, outputTokens: 29, reasoningTokens: 11,
      totalTokens: 82, cacheWriteTokens: 3, tokenPricingBasis: "openai-flex",
      providerRequestOutcome: "succeeded", providerRequestOrdinal: 2,
      requestedModel: "synthetic-model", servedModel: "synthetic-model", providerName: "synthetic-provider",
      gatewayTags: ["synthetic-🧪"], featureKey: "synthetic-feature", routeId: "synthetic-route",
      rawUsageJson: { input_tokens: 53, output_tokens: 29, total_tokens: 82 },
      turnProfileJson: {
        schema: ASSISTANT_TURN_PROFILE_SCHEMA, modelContextWindow: 258400, requestCount: 5,
        requests: Array.from({ length: 5 }, () => ({ cachedInput: 1, input: 9, output: 4 })),
        requestsTruncated: false, toolsTruncated: false,
        tools: [{ kind: "command", label: "vault-cli wearables", calls: 24,
          durationKnownCalls: 24, durationMs: 72000, failedCalls: 0, outputBytesTotal: 4800, outputBytesMax: 200 }],
      },
    }),
  };
}
function withTiming(body: HostedRuntimeUsageRecordRequest, cliTiming: unknown): HostedRuntimeUsageRecordRequest {
  assert.ok(body.usage.turnProfileJson, "the accounting fixture must pass real legacy normalization");
  return { ...body, usage: { ...body.usage, turnProfileJson: { ...body.usage.turnProfileJson, cliTiming } } };
}
function withoutTiming(body: HostedRuntimeUsageRecordRequest): HostedRuntimeUsageRecordRequest {
  if (!body.usage.turnProfileJson) return body;
  const profile = { ...body.usage.turnProfileJson };
  delete profile.cliTiming;
  return { ...body, usage: { ...body.usage, turnProfileJson: profile } };
}

// Capture the real port AND shared transport's serialization, not a mocked
// serializer. The public Web testkit composes the actual pre-parse body reader
// and request parser. Only auth/persistence/fetch are synthetic; no network I/O.
async function send(body: HostedRuntimeUsageRecordRequest): Promise<string> {
  let sent = "";
  let requests = 0;
  const port = createHostedRuntimeUsageRecordPort({
    boundUserId: "synthetic-member", timeoutMs: 1000, transport: { mode: "proxy" },
    fetchImpl: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      sent = await request.text();
      requests += 1;
      assert.equal(new URL(request.url).pathname, "/api/internal/hosted-execution/usage/record");
      assert.equal(request.method, "POST");
      try {
        const received = await readHostedUsageRecordRequestForTest(new Request(request.url, {
          method: request.method, headers: request.headers, body: sent,
        }));
        assert.deepEqual(withoutTiming(received), withoutTiming(body));
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        return Response.json({ error: { message: error.message } }, { status: 413 });
      }
      return Response.json({ platformAiUsageAllowedAfter: true, recorded: true, usageId: body.usage.usageId });
    },
  });
  const result = port.recordUsage(body.usage, body.noticeDeliveryTarget);
  if (Buffer.byteLength(JSON.stringify(withoutTiming(body))) > limit) {
    await assert.rejects(result, /Request body exceeded 16384 bytes/);
  } else {
    assert.deepEqual(await result, {
      platformAiUsageAllowedAfter: true, recorded: true, usageId: body.usage.usageId,
    });
  }
  assert.equal(requests, 1);
  return sent;
}
function inspect(sent: string, legacy: HostedRuntimeUsageRecordRequest): CliTiming {
  const body: HostedRuntimeUsageRecordRequest = JSON.parse(sent);
  assert.ok(Buffer.byteLength(sent, "utf8") <= limit);
  assert.deepEqual(withoutTiming(body), legacy);
  const usage = parseAssistantUsageRecord(body.usage);
  assert.deepEqual(withoutTiming({ ...body, usage }), legacy);
  const timing = normalizeCliTiming(usage.turnProfileJson?.cliTiming);
  assert.ok(timing);
  return timing;
}

function paddedLegacy(bytes: number): HostedRuntimeUsageRecordRequest {
  const body = legacyRequest({ channel: "telegram", replyToMessageId: "synthetic-reply", target: "🧪".repeat(64) });
  assert.ok(body.noticeDeliveryTarget);
  const padding = bytes - Buffer.byteLength(JSON.stringify(body));
  assert.ok(padding >= 0);
  body.noticeDeliveryTarget.target += "x".repeat(padding);
  assert.equal(Buffer.byteLength(JSON.stringify(body)), bytes);
  return body;
}

test("24 mixed root reports fit the whole usage request without losing non-timing accounting", async () => {
  assert.equal(limit, 16_384);
  assert.equal(CLI_TIMING_MAX_REPORT_BYTES, 8_192);
  const timing = await mixedRootTiming();
  const legacy = legacyRequest({ channel: "telegram", replyToMessageId: "synthetic-reply", target: "synthetic-🧪" });
  const source = withTiming(legacy, timing);
  const before = JSON.stringify(source);
  assert.ok(Buffer.byteLength(JSON.stringify(legacy)) < limit);
  assert.ok(Buffer.byteLength(before) > limit);
  const sent = await send(source);
  assert.equal(JSON.stringify(source), before, "serialization must not mutate the queued record");
  const kept = inspect(sent, legacy);
  assert.ok(kept.commands.length > 0 && kept.commands.length < timing.commands.length);
  assert.deepEqual(kept.commands, timing.commands.slice(0, kept.commands.length));
  assert.equal(kept.droppedCalls + kept.commands.reduce((n, entry) => n + entry.calls, 0), 24);
  assert.equal(kept.reportCount, 24);
  assert.equal(kept.transportTruncated, false, "HTTP trimming is not UDP loss");
  assert.equal(kept.droppedSpans, 0);
});

test("maximum admitted aggregate trims whole summaries and saturates existing drop counters", async () => {
  const timing = emptyCliTiming();
  timing.reportCount = CLI_TIMING_MAX_REPORTS;
  timing.droppedCalls = Number.MAX_SAFE_INTEGER - 1;
  timing.droppedSpans = 17;
  timing.batchContainers = 3;
  timing.outOfWindowReports = 2;
  timing.transportTruncated = true;
  for (let index = 0; index < CLI_TIMING_MAX_COMMANDS; index += 1) {
    const phases: CliTiming["commands"][number]["phases"] = [];
    for (const phase of CLI_TIMING_PHASES) assert.ok(addCliPhaseSample(phases, phase, Number.MAX_SAFE_INTEGER));
    timing.commands.push({ command: roots[index % roots.length]!, outcome: index < roots.length ? "ok" : "error", calls: 8, phases });
  }
  assert.deepEqual(normalizeCliTiming(timing), timing);
  const legacy = legacyRequest(null);
  const source = withTiming(legacy, timing);
  const before = JSON.stringify(source);
  const kept = inspect(await send(source), legacy);
  assert.ok(kept.commands.length > 0 && kept.commands.length < 32);
  assert.equal(kept.droppedCalls, Number.MAX_SAFE_INTEGER);
  assert.deepEqual({ ...kept, commands: [], droppedCalls: 0 }, { ...timing, commands: [], droppedCalls: 0 });
  assert.deepEqual(kept.commands, timing.commands.slice(0, kept.commands.length));
  assert.equal(JSON.stringify(source), before);
});

test("UTF-8 envelope headroom retains counters-only or omits timing, never accounting", async () => {
  const timing = await mixedRootTiming();
  const roomForCounters = paddedLegacy(limit - 300);
  const counters = inspect(await send(withTiming(roomForCounters, timing)), roomForCounters);
  assert.deepEqual(counters.commands, []);
  assert.equal(counters.droppedCalls, 24);
  assert.equal(counters.reportCount, 24);
  for (const size of [limit - 1, limit, limit + 1]) {
    const legacy = paddedLegacy(size);
    assert.ok(JSON.stringify(legacy).length < size, "fixture must distinguish UTF-8 bytes from string length");
    assert.equal(await send(withTiming(legacy, timing)), JSON.stringify(legacy));
    // Legacy alone over budget still follows the old rejection path; no token,
    // request/tool accounting or notice target is sacrificed to make it fit.
    assert.equal(await send(legacy), JSON.stringify(legacy));
  }
});

test("small, old and malformed optional profiles preserve legacy data and private extras cannot escape", async () => {
  const timing = await mixedRootTiming();
  timing.commands = timing.commands.slice(0, 1);
  const legacy = legacyRequest();
  assert.deepEqual(inspect(await send(withTiming(legacy, timing)), legacy), timing);
  assert.equal(await send(legacy), JSON.stringify(legacy));
  const v1 = { ...legacy, usage: parseAssistantUsageRecord({ ...legacy.usage, turnProfileJson: {
    ...legacy.usage.turnProfileJson, schema: ASSISTANT_TURN_PROFILE_SCHEMA_V1,
    tools: [{ label: "synthetic-tool", calls: 2, durationMs: 4, outputChars: 8, failedCalls: 1 }],
  } }) };
  assert.ok(v1.usage.turnProfileJson);
  assert.deepEqual(inspect(await send(withTiming(v1, timing)), v1), timing);
  assert.equal(await send(v1), JSON.stringify(v1));
  const absentProfile = { ...legacy, usage: { ...legacy.usage, turnProfileJson: null } };
  assert.equal(await send(absentProfile), JSON.stringify(absentProfile));
  for (const invalid of [null, "PRIVATE_SENTINEL", 1n, { ...timing, droppedCalls: -1 }]) {
    assert.equal(await send(withTiming(legacy, invalid)), JSON.stringify(legacy));
  }
  const extras = { ...timing, argv: "PRIVATE_SENTINEL", content: "PRIVATE_SENTINEL", circular: {} };
  extras.circular = extras;
  const sent = await send(withTiming(legacy, extras));
  assert.equal(sent.includes("PRIVATE_SENTINEL"), false);
  assert.deepEqual(inspect(sent, legacy), timing);
});

test("timing that fits exactly at the complete UTF-8 request limit is retained", async () => {
  const timing = await mixedRootTiming();
  timing.commands = timing.commands.slice(0, 1);
  const legacy = legacyRequest();
  const overhead = Buffer.byteLength(JSON.stringify(withTiming(legacy, timing))) - Buffer.byteLength(JSON.stringify(legacy));
  const padded = paddedLegacy(limit - overhead);
  const sent = await send(withTiming(padded, timing));
  assert.equal(Buffer.byteLength(sent), limit);
  assert.deepEqual(inspect(sent, padded), timing);
});
