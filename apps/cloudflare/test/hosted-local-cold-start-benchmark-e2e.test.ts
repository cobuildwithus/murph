import { createHmac } from "node:crypto";
import process from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  listHostedRuntimeLogsForTest,
  readHostedMailboxItemForTest,
} from "#hosted-web-testing";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";

import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  assertSingleSuccessfulColdStartAttempt,
} from "./helpers/hosted-local-cold-start-benchmark.js";
import {
  buildHostedLinqInboundEvent,
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
  type ObservedLinqRequest,
} from "./helpers/hosted-local-linq-support.js";

const defaultWarmupCount = 3;
const defaultSampleCount = 12;
const maxTrialCount = 100;
const warmupCount = readTrialCount(
  "MURPH_E2E_COLD_START_WARMUP_COUNT",
  defaultWarmupCount,
  0,
);
const sampleCount = readTrialCount(
  "MURPH_E2E_COLD_START_SAMPLE_COUNT",
  defaultSampleCount,
  1,
);
const totalTrialCount = warmupCount + sampleCount;
const benchmarkRunToken = Date.now().toString(36);
const trialUserIds = Array.from(
  { length: totalTrialCount },
  (_, index) => `member_local_cold_start_benchmark_${benchmarkRunToken}_${index + 1}`,
);
const linqApiToken = "linq-local-cold-start-benchmark-token";
const linqWebhookSecret = "linq-local-cold-start-benchmark-secret";
const assistantModel = "gpt-5.6-terra";
const replyText = "Cold-start benchmark reply.";
const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

interface ColdStartSample {
  webhookToDeliveryMs: number;
  webhookToProviderMs: number;
}

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

afterAll(async () => {
  await scenario?.stop();
  scenario = null;
  await linqStub?.stop();
  linqStub = null;
}, 120_000);

describe("hosted local cold-start benchmark e2e", () => {
  beforeAll(async () => {
    linqStub = await startHostedLocalLinqStub({
      expectedAuthorizationToken: linqApiToken,
    });
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_ASSISTANT_MODEL: assistantModel,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "1",
        // Trials never reuse a member. Retire completed containers quickly so
        // later samples do not inherit artificial local memory contention.
        HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "1000",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
          trialUserIds.map(buildLinqRecipientPhoneNumber).join(","),
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: linqApiToken,
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        OPENAI_API_KEY: "stub-local-openai-key",
      },
      assistantProviderMode: "stub",
      assistantProviderStubModelId: assistantModel,
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-cold-start-benchmark-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted cold-start benchmark",
      streamLogs: streamDevLogs,
    });
  }, 300_000);

  it("measures independent cold first-contact executions", async () => {
    const measuredSamples: ColdStartSample[] = [];

    for (const [index, userId] of trialUserIds.entries()) {
      const sample = await runColdStartTrial(userId, index + 1);
      const isWarmup = index < warmupCount;
      if (!isWarmup) {
        measuredSamples.push(sample);
      }

      printBenchmarkRecord({
        cold: true,
        delivery: true,
        mailbox: true,
        measured: !isWarmup,
        ordinal: index + 1,
        provider: true,
        sameAttempt: true,
        summary: false,
        webhookToDeliveryMs: sample.webhookToDeliveryMs,
        webhookToProviderMs: sample.webhookToProviderMs,
      });
    }

    expect(measuredSamples).toHaveLength(sampleCount);
    printBenchmarkRecord({
      cold: true,
      delivery: true,
      mailbox: true,
      provider: true,
      sameAttempt: true,
      samples: measuredSamples.length,
      summary: true,
      warmups: warmupCount,
      webhookToDeliveryP50Ms: percentile(
        measuredSamples.map((sample) => sample.webhookToDeliveryMs),
        0.5,
      ),
      webhookToDeliveryP90Ms: percentile(
        measuredSamples.map((sample) => sample.webhookToDeliveryMs),
        0.9,
      ),
      webhookToProviderP50Ms: percentile(
        measuredSamples.map((sample) => sample.webhookToProviderMs),
        0.5,
      ),
      webhookToProviderP90Ms: percentile(
        measuredSamples.map((sample) => sample.webhookToProviderMs),
        0.9,
      ),
    });
  }, Math.max(300_000, totalTrialCount * 300_000));
});

async function runColdStartTrial(
  userId: string,
  ordinal: number,
): Promise<ColdStartSample> {
  const activeScenario = requireScenario();
  const activeLinqStub = requireLinqStub();
  const chatId = `chat_local_cold_start_benchmark_${benchmarkRunToken}_${ordinal}`;
  const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;
  const inboundText = `Cold-start benchmark request ${ordinal}.`;
  const eventId = `evt_local_cold_start_benchmark_${benchmarkRunToken}_${ordinal}`;
  const replyMatcher = (request: ObservedLinqRequest): boolean =>
    activeLinqStub.readObservedMessageText(request) === replyText;

  await activeScenario.seedActiveHostedLinqMember({
    homePhone: buildLinqHomePhoneNumber(userId),
    memberId: userId,
    memberPhone: buildLinqRecipientPhoneNumber(userId),
  });
  await activeScenario.bindActiveHostedLinqHomeChat({
    chatId,
    memberId: userId,
    recipientPhone: buildLinqRecipientPhoneNumber(userId),
  });

  // The inbound webhook owns the only processing ensure, so activation and
  // first contact are imported by one genuinely cold runtime attempt.
  await activeScenario.enqueueWake(buildActivationWake(userId, ordinal), userId);
  const providerRequestBaseline = listResponsesApiRequests().length;
  const totalProviderRequestBaseline = activeScenario.assistantProviderRequests.length;
  const totalAcceptedSendBaseline = activeLinqStub.acceptedSendRequests.length;
  const acceptedReplyBaseline = activeLinqStub.countAcceptedSends(
    replyPath,
    replyMatcher,
  );
  activeScenario.queueAssistantResponses([replyText], {
    matchInputContains: inboundText,
  });

  const webhookStartedAtEpochMs = Date.now();
  const webhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
    userId,
    chatId,
    {
      eventId,
      messageId: `msg_${eventId}`,
      text: inboundText,
    },
  ));
  expect(webhookResponse.status).toBe(202);
  await expect(webhookResponse.json()).resolves.toMatchObject({
    ok: true,
    reason: "wake-appended-active-member",
  });

  await activeScenario.waitForLatestPendingWake(userId);
  const completionPromise = activeScenario.waitForHostedCompletion(userId);
  const acceptedReplies = await activeLinqStub.waitForMatchingAcceptedSendCount({
    expectedCount: acceptedReplyBaseline + 1,
    expectedPath: replyPath,
    matchRequest: replyMatcher,
    scenario: activeScenario,
    userId,
  });
  const acceptedReply = acceptedReplies.at(-1);
  if (!acceptedReply) {
    throw new Error("Expected one accepted benchmark reply.");
  }
  expect(acceptedReply.authorizationStatus).toBe("hosted-sentinel");

  const finalStatus = await completionPromise;
  expect(finalStatus.lastErrorCode ?? null).toBeNull();
  expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
  expect(activeLinqStub.countAcceptedSends(replyPath, replyMatcher)).toBe(
    acceptedReplyBaseline + 1,
  );
  expect(activeLinqStub.acceptedSendRequests).toHaveLength(
    totalAcceptedSendBaseline + 1,
  );

  const responsesApiRequests = listResponsesApiRequests();
  expect(activeScenario.assistantProviderRequests).toHaveLength(
    totalProviderRequestBaseline + 1,
  );
  expect(responsesApiRequests).toHaveLength(providerRequestBaseline + 1);
  const providerRequestsForTrial = responsesApiRequests
    .slice(providerRequestBaseline)
    .filter((request) => readAssistantProviderRequestText(request).includes(inboundText));
  expect(providerRequestsForTrial).toHaveLength(1);
  const providerRequest = providerRequestsForTrial[0];
  if (!providerRequest) {
    throw new Error("Expected one benchmark provider request.");
  }

  const mailboxItem = await readHostedMailboxItemForTest({
    dedupeKey: eventId,
    environment: activeScenario.runtimeEnv,
    userId,
  });
  expect(mailboxItem.consumedAt).toEqual(expect.any(String));

  const runtimeLogs = await listHostedRuntimeLogsForTest({
    environment: activeScenario.runtimeEnv,
    limit: 500,
    userId,
  });
  expect(runtimeLogs.length).toBeLessThan(500);
  const appServerInitializationLogs = runtimeLogs.filter((entry) =>
    entry.eventCode === "assistant.automation_detail"
    && entry.redactedJson?.providerTraceKind === "codex.app_server_timing"
    && (
      entry.redactedJson.codexTimingStage === "initialized"
      || entry.redactedJson.codexTimingStage === "preinitialized"
    )
  );
  expect(appServerInitializationLogs).toHaveLength(1);
  const appServerInitializationLog = appServerInitializationLogs[0];
  if (!appServerInitializationLog) {
    throw new Error("Expected one App Server initialization trace.");
  }
  expect(appServerInitializationLog.redactedJson).toMatchObject({
    codexTimingColdStartReason: "node-process-first-use",
  });
  const runtimeAttemptId = appServerInitializationLog.attemptId;
  if (!runtimeAttemptId) {
    throw new Error("Expected the benchmark runtime attempt id.");
  }
  assertSingleSuccessfulColdStartAttempt(runtimeLogs, runtimeAttemptId);
  // Each trial creates a new member with no prior snapshot, so coldness is the
  // first container/Codex process use proved above—not an R2 restore of an
  // existing workspace object. The attributed mailbox event proves the same
  // attempt consumed both activation and first-contact input.
  expect(runtimeLogs).toContainEqual(expect.objectContaining({
    attemptId: runtimeAttemptId,
    component: "mailbox",
    eventCode: "mailbox.imported",
    redactedJson: expect.objectContaining({
      fetchedCount: 2,
      importedCount: 2,
    }),
  }));

  const providerObservedAtEpochMs = requireObservedTimestamp(providerRequest);
  const deliveryObservedAtEpochMs = requireObservedTimestamp(acceptedReply);
  expect(providerObservedAtEpochMs).toBeGreaterThanOrEqual(webhookStartedAtEpochMs);
  expect(deliveryObservedAtEpochMs).toBeGreaterThanOrEqual(providerObservedAtEpochMs);

  return {
    webhookToDeliveryMs: deliveryObservedAtEpochMs - webhookStartedAtEpochMs,
    webhookToProviderMs: providerObservedAtEpochMs - webhookStartedAtEpochMs,
  };
}

function buildActivationWake(userId: string, ordinal: number) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${benchmarkRunToken}:${ordinal}`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId: userId,
    occurredAt: new Date().toISOString(),
  });
}

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", linqWebhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return await fetch(
    `${requireScenario().harness.webBaseUrl}/api/hosted-onboarding/linq/webhook`,
    {
      body: rawBody,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-webhook-signature": `sha256=${signature}`,
        "x-webhook-timestamp": timestamp,
      },
      method: "POST",
    },
  );
}

function listResponsesApiRequests() {
  return requireScenario().assistantProviderRequests.filter((request) =>
    request.url === "/v1/responses"
  );
}

function readAssistantProviderRequestText(request: { body: string }): string {
  return collectJsonStrings(JSON.parse(request.body)).join("\n\n");
}

function collectJsonStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectJsonStrings(entry));
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap((entry) => collectJsonStrings(entry));
  }
  return [];
}

function requireObservedTimestamp(request: {
  observedAtEpochMs?: number;
}): number {
  const observedAtEpochMs = request.observedAtEpochMs;
  if (typeof observedAtEpochMs !== "number" || !Number.isSafeInteger(observedAtEpochMs)) {
    throw new Error("Expected a benchmark request observation timestamp.");
  }
  return observedAtEpochMs;
}

function percentile(values: readonly number[], proportion: number): number {
  if (values.length === 0) {
    throw new Error("Cannot calculate a percentile without samples.");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * proportion;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined) {
    throw new Error("Could not resolve a benchmark percentile position.");
  }
  return Math.round(lower + ((upper - lower) * (position - lowerIndex)));
}

function printBenchmarkRecord(record: Record<string, boolean | number>): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function readTrialCount(
  environmentKey: string,
  fallback: number,
  minimum: number,
): number {
  const rawValue = process.env[environmentKey]?.trim();
  if (!rawValue) {
    return fallback;
  }
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < minimum || value > maxTrialCount) {
    throw new RangeError(
      `${environmentKey} must be an integer from ${minimum} through ${maxTrialCount}.`,
    );
  }
  return value;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local Linq stub was not initialized.");
  }
  return linqStub;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local cold-start benchmark scenario was not initialized.");
  }
  return scenario;
}
