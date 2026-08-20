import { createHmac, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  listHostedRuntimeLogsForTest,
  readHostedIngressLatencyTraceForTest,
  readHostedMailboxItemForTest,
} from "#hosted-web-testing";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedRunnerStatusResponse,
  HostedRuntimeLatencyPhaseBreakdown,
} from "@murphai/hosted-execution/runtime-control";
import {
  isHostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import {
  HOSTED_R2_CHECKSUM_MODE_ENABLED,
  HOSTED_R2_CHECKSUM_MODE_HEADER,
  createHostedR2PresignedHeadUrl,
  readHostedR2PresignEnvironment,
  type HostedR2PresignEnvironment,
} from "../src/r2-presigned-url.js";

import {
  DEFAULT_DATABASE_URL,
} from "@murphai/hosted-local-harness/dev-hosted-local/constants";
import {
  buildHostedLocalRuntimeLogDatabaseNameForTest,
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  assertEstablishedR2ColdStartAttempt,
  assertSingleSuccessfulColdStartAttempt,
} from "./helpers/hosted-local-cold-start-benchmark.js";
import {
  buildAssistantProviderShellCommandCall,
} from "./helpers/hosted-local-e2e-support.js";
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
const benchmarkRunToken = readBenchmarkRunToken();
const benchmarkTarget = readBenchmarkTarget();
const trialUserIds = Array.from(
  { length: totalTrialCount },
  (_, index) => `member_local_cold_start_benchmark_${benchmarkRunToken}_${index + 1}`,
);
const linqApiToken = "linq-local-cold-start-benchmark-token";
const linqWebhookSecret = "linq-local-cold-start-benchmark-secret";
const assistantModel = "gpt-5.6-terra";
const replyText = "Cold-start benchmark reply.";
const setupReplyText = "Cold-start benchmark setup complete.";
const productionMedianPayloadBytes = 14_000_000;
const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const execFileAsync = promisify(execFile);

interface ColdStartSample {
  acceptedToProviderMs?: number;
  acceptedToRunnerAcceptedMs?: number;
  assistantPhaseCallbackToAssistantPhaseMs?: number;
  assistantAutoReplyBootstrapMs?: number;
  automationBootstrapMs?: number;
  archiveExtractMs?: number;
  cleanupMs?: number;
  dataKeyUnwrapMs?: number;
  decryptMs?: number;
  durableRootReplaceMs?: number;
  encryptedBytes?: number;
  executionTargetHydrateMs?: number;
  extractMs?: number;
  foregroundPassToWorkspaceForegroundPassMs?: number;
  mailboxImportDoneToAssistantPhaseMs?: number;
  mailboxImportDoneToForegroundPassMs?: number;
  nodeStartupMs?: number;
  objectFetchMs?: number;
  preparedRestore?: boolean;
  presignGetMs?: number;
  providerPreProviderSetupMs?: number;
  runnerAcceptedToRestoreDoneMs?: number;
  runtimeInvocationPreparationMs?: number;
  sizeGuardMs?: number;
  stagedToProviderMs?: number;
  systemMailboxMaintenanceMs?: number;
  workspaceReadMs?: number;
  workspaceForegroundPassToAssistantPhaseCallbackMs?: number;
  workspaceAssistantPreAutomationMs?: number;
  workspaceRestoreDoneToStagedMs?: number;
  webhookToDeliveryMs: number;
  webhookToProviderMs: number;
}

type ColdStartBenchmarkTarget = "established-v2-r2" | "first-contact";

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;
let benchmarkDatabaseName: string | null = null;
let benchmarkDatabaseUrl: string | null = null;
let benchmarkStorageRoot: string | null = null;
let benchmarkWorkerPersistDir: string | null = null;
let benchmarkMinioDataDir: string | null = null;

afterAll(async () => {
  await scenario?.stop();
  scenario = null;
  await linqStub?.stop();
  linqStub = null;
  if (benchmarkDatabaseName) {
    await dropBenchmarkDatabase(benchmarkDatabaseName).catch(() => undefined);
    benchmarkDatabaseName = null;
    benchmarkDatabaseUrl = null;
  }
  if (benchmarkStorageRoot) {
    await rm(benchmarkStorageRoot, { force: true, recursive: true });
    benchmarkStorageRoot = null;
    benchmarkWorkerPersistDir = null;
    benchmarkMinioDataDir = null;
  }
}, 120_000);

describe("hosted local cold-start benchmark e2e", () => {
  beforeAll(async () => {
    const testTempRoot = process.env.MURPH_VITEST_TEMP_ROOT?.trim();
    if (!testTempRoot) {
      throw new Error("Cold-start benchmark requires the marked Vitest temp root.");
    }
    benchmarkStorageRoot = await mkdtemp(path.join(testTempRoot, "cold-start-benchmark-"));
    benchmarkWorkerPersistDir = path.join(benchmarkStorageRoot, "cloudflare-state");
    benchmarkMinioDataDir = path.join(benchmarkStorageRoot, "minio-r2");
    await mkdir(benchmarkMinioDataDir, { recursive: true });
    benchmarkDatabaseName = buildBenchmarkDatabaseName();
    benchmarkDatabaseUrl = await createBenchmarkDatabase(benchmarkDatabaseName);
    linqStub = await startHostedLocalLinqStub({
      expectedAuthorizationToken: linqApiToken,
    });
    scenario = await startBenchmarkScenario({
      resetLocalDatabase: true,
      resetPersistDir: true,
    });
  }, 300_000);

  it("measures independent cold hosted executions", async () => {
    const measuredSamples: ColdStartSample[] = [];

    for (const [index, userId] of trialUserIds.entries()) {
      const sample = await runColdStartTrial(userId, index + 1);
      const isWarmup = index < warmupCount;
      if (!isWarmup) {
        measuredSamples.push(sample);
      }

      printBenchmarkRecord({
        ...sample,
        cold: true,
        delivery: true,
        mailbox: true,
        measured: !isWarmup,
        ordinal: index + 1,
        provider: true,
        sameAttempt: true,
        summary: false,
        target: benchmarkTarget,
      });
    }

    expect(measuredSamples).toHaveLength(sampleCount);
    printBenchmarkRecord({
      ...buildSamplePercentileRecord(measuredSamples),
      cold: true,
      delivery: true,
      mailbox: true,
      provider: true,
      sameAttempt: true,
      samples: measuredSamples.length,
      summary: true,
      target: benchmarkTarget,
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

async function startBenchmarkScenario(input: {
  restartEnvironment?: NodeJS.ProcessEnv;
  resetLocalDatabase: boolean;
  resetPersistDir: boolean;
}): Promise<HostedLocalFullStackScenario> {
  return await startHostedLocalFullStackScenario({
    additionalEnv: {
      ...(input.restartEnvironment ?? {}),
      HOSTED_ASSISTANT_MODEL: assistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS:
        benchmarkTarget === "established-v2-r2" ? "1000" : "1",
      // Trials never overlap member runtimes. A short TTL keeps first-contact
      // trials isolated and established setup stacks short-lived.
      HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "1000",
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        trialUserIds.map(buildLinqRecipientPhoneNumber).join(","),
      LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
      LINQ_API_TOKEN: linqApiToken,
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      MURPH_DEV_MINIO_DATA_DIR: requireBenchmarkMinioDataDir(),
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      OPENAI_API_KEY: "stub-local-openai-key",
    },
    assistantProviderMode: "stub",
    assistantProviderStubModelId: assistantModel,
    faultInjection: benchmarkTarget === "established-v2-r2",
    localDatabaseUrl: requireBenchmarkDatabaseUrl(),
    persistDirOverride: requireBenchmarkWorkerPersistDir(),
    persistDirPrefix: "murph-hosted-local-cold-start-benchmark-",
    resetLocalDatabase: input.resetLocalDatabase,
    resetPersistDir: input.resetPersistDir,
    requiredRunnerEnvProfile: "linq",
    reuseLocalDatabase: true,
    scenarioLabel: "Local hosted cold-start benchmark",
    streamLogs: streamDevLogs,
    testControls: benchmarkTarget === "established-v2-r2",
  });
}

async function runColdStartTrial(
  userId: string,
  ordinal: number,
): Promise<ColdStartSample> {
  const setupScenario = requireScenario();
  const activeLinqStub = requireLinqStub();
  const chatId = `chat_local_cold_start_benchmark_${benchmarkRunToken}_${ordinal}`;
  const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;
  const inboundText = `Cold-start benchmark request ${ordinal}.`;
  const eventId = `evt_local_cold_start_benchmark_${benchmarkRunToken}_${ordinal}`;
  const replyMatcher = (request: ObservedLinqRequest): boolean =>
    activeLinqStub.readObservedMessageText(request) === replyText;

  await setupScenario.seedActiveHostedLinqMember({
    homePhone: buildLinqHomePhoneNumber(userId),
    memberId: userId,
    memberPhone: buildLinqRecipientPhoneNumber(userId),
  });
  await setupScenario.bindActiveHostedLinqHomeChat({
    chatId,
    memberId: userId,
    recipientPhone: buildLinqRecipientPhoneNumber(userId),
  });

  const establishedSnapshotRef = benchmarkTarget === "established-v2-r2"
    ? await prepareEstablishedWorkspaceTrial({ chatId, ordinal, userId })
    : null;
  const activeScenario = requireScenario();
  if (!establishedSnapshotRef) {
    // The inbound webhook owns the only processing ensure, so activation and
    // first contact are imported by one genuinely cold runtime attempt.
    await activeScenario.enqueueWake(buildActivationWake(userId, ordinal), userId);
  }
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

  const measuredWindowStartedAt = new Date(Date.now() - 1);
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
  const providerObservedAtEpochMs = requireObservedTimestamp(providerRequest);
  const deliveryObservedAtEpochMs = requireObservedTimestamp(acceptedReply);
  expect(providerObservedAtEpochMs).toBeGreaterThanOrEqual(webhookStartedAtEpochMs);
  expect(deliveryObservedAtEpochMs).toBeGreaterThanOrEqual(providerObservedAtEpochMs);

  const mailboxItem = await readHostedMailboxItemForTest({
    dedupeKey: eventId,
    environment: activeScenario.runtimeEnv,
    userId,
  });
  expect(mailboxItem.consumedAt).toEqual(expect.any(String));

  const trace = establishedSnapshotRef
    ? await waitForMeasuredLatencyTrace({
        mailboxItemId: mailboxItem.id,
        userId,
      })
    : null;
  const runtimeLogRows = await waitForMeasuredRuntimeLogs({
    expectedAttemptId: trace?.runtimeAttemptId ?? undefined,
    fromAt: measuredWindowStartedAt,
    userId,
  });
  expect(runtimeLogRows.length).toBeLessThan(500);
  // App Server traces are persisted asynchronously and can arrive after the
  // reply is delivered. Discover the measured attempt from the full bounded
  // query, then retain both its complete trace and every entry before delivery
  // so a failed/retried foreground attempt still invalidates the sample.
  const appServerInitializationLogs = runtimeLogRows.filter((entry) =>
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
  const runtimeLogs = runtimeLogRows.filter((entry) =>
    entry.attemptId === runtimeAttemptId
    || Date.parse(entry.at) <= deliveryObservedAtEpochMs
  );
  const preparation = readRunnerPreparationLog(runtimeAttemptId);
  assertSingleSuccessfulColdStartAttempt(
    runtimeLogs,
    runtimeAttemptId,
    preparation.workspaceWriteFenceGeneration,
  );
  // The attributed mailbox event proves the same attempt consumed the exact
  // measured input. First-contact trials also consume activation in that pass.
  expect(runtimeLogs).toContainEqual(expect.objectContaining({
    attemptId: runtimeAttemptId,
    component: "mailbox",
    eventCode: "mailbox.imported",
    redactedJson: expect.objectContaining({
      fetchedCount: establishedSnapshotRef ? 1 : 2,
      importedCount: establishedSnapshotRef ? 1 : 2,
    }),
  }));

  const baseSample: ColdStartSample = {
    webhookToDeliveryMs: deliveryObservedAtEpochMs - webhookStartedAtEpochMs,
    webhookToProviderMs: providerObservedAtEpochMs - webhookStartedAtEpochMs,
  };
  if (!establishedSnapshotRef) {
    return baseSample;
  }

  if (!trace) {
    throw new Error("Expected the established-workspace latency trace.");
  }
  assertEstablishedR2ColdStartAttempt({
    expectedEncryptedBytes: establishedSnapshotRef.archive.encryptedByteSize,
    expectedPlainBytes: establishedSnapshotRef.archive.totalPlainBytes,
    runtimeLogs,
    successfulAttemptId: runtimeAttemptId,
    trace,
    workspaceWriteFenceGeneration: preparation.workspaceWriteFenceGeneration,
  });
  const phaseBreakdown = requirePhaseBreakdown(trace.phaseBreakdown);
  const restore = requireRestoreBreakdown(phaseBreakdown);
  const importBreakdown = phaseBreakdown.import;
  const preProviderBreakdown = phaseBreakdown.preProvider;

  return {
    ...baseSample,
    acceptedToProviderMs: elapsedIso(trace.acceptedAt, requireIso(trace.providerStartAt)),
    acceptedToRunnerAcceptedMs: elapsedIso(
      trace.acceptedAt,
      requireIso(trace.runnerJobAcceptedAt),
    ),
    assistantPhaseCallbackToAssistantPhaseMs: requireTiming(
      preProviderBreakdown?.assistantPhaseCallbackToAssistantPhaseMs,
      "assistantPhaseCallbackToAssistantPhaseMs",
    ),
    assistantAutoReplyBootstrapMs: elapsedEpochMs(
      requireTiming(importBreakdown?.decodeDoneAtEpochMs, "decodeDoneAtEpochMs"),
      requireTiming(
        importBreakdown?.autoReplyPreparedAtEpochMs,
        "autoReplyPreparedAtEpochMs",
      ),
    ),
    automationBootstrapMs: requireTiming(
      preProviderBreakdown?.automationBootstrapMs,
      "automationBootstrapMs",
    ),
    archiveExtractMs: requireTiming(restore.archiveExtractMs, "archiveExtractMs"),
    cleanupMs: requireTiming(restore.cleanupMs, "cleanupMs"),
    dataKeyUnwrapMs: requireTiming(restore.dataKeyUnwrapMs, "dataKeyUnwrapMs"),
    decryptMs: requireTiming(restore.decryptMs, "decryptMs"),
    durableRootReplaceMs: requireTiming(
      restore.durableRootReplaceMs,
      "durableRootReplaceMs",
    ),
    encryptedBytes: requireTiming(restore.encryptedBytes, "encryptedBytes"),
    executionTargetHydrateMs: requireTiming(
      preProviderBreakdown?.executionTargetHydrateMs,
      "executionTargetHydrateMs",
    ),
    extractMs: requireTiming(restore.extractMs, "extractMs"),
    foregroundPassToWorkspaceForegroundPassMs: requireTiming(
      preProviderBreakdown?.foregroundPassToWorkspaceForegroundPassMs,
      "foregroundPassToWorkspaceForegroundPassMs",
    ),
    mailboxImportDoneToAssistantPhaseMs: requireTiming(
      preProviderBreakdown?.mailboxImportDoneToAssistantPhaseMs,
      "mailboxImportDoneToAssistantPhaseMs",
    ),
    mailboxImportDoneToForegroundPassMs: requireTiming(
      preProviderBreakdown?.mailboxImportDoneToForegroundPassMs,
      "mailboxImportDoneToForegroundPassMs",
    ),
    nodeStartupMs: requireTiming(phaseBreakdown.boot?.nodeStartupMs, "nodeStartupMs"),
    objectFetchMs: requireTiming(restore.objectFetchMs, "objectFetchMs"),
    preparedRestore: preparation.preparedSnapshotRestorePresent,
    presignGetMs: requireTiming(restore.presignGetMs, "presignGetMs"),
    providerPreProviderSetupMs: requireTiming(
      phaseBreakdown.provider?.preProviderSetupMs,
      "preProviderSetupMs",
    ),
    runnerAcceptedToRestoreDoneMs: elapsedIso(
      requireIso(trace.runnerJobAcceptedAt),
      requireIso(trace.workspaceRestoreDoneAt),
    ),
    runtimeInvocationPreparationMs: requireTiming(
      phaseBreakdown.orchestration?.runtimeInvocationPreparationElapsedMs,
      "runtimeInvocationPreparationElapsedMs",
    ),
    sizeGuardMs: requireTiming(restore.sizeGuardMs, "sizeGuardMs"),
    stagedToProviderMs: elapsedIso(
      trace.assistantInputStagedAt,
      requireIso(trace.providerStartAt),
    ),
    systemMailboxMaintenanceMs: requireTiming(
      preProviderBreakdown?.systemMailboxMaintenanceMs,
      "systemMailboxMaintenanceMs",
    ),
    workspaceAssistantPreAutomationMs: requireTiming(
      preProviderBreakdown?.workspaceAssistantPreAutomationMs,
      "workspaceAssistantPreAutomationMs",
    ),
    workspaceReadMs: requireTiming(
      phaseBreakdown.orchestration?.workspaceReadElapsedMs,
      "workspaceReadElapsedMs",
    ),
    workspaceForegroundPassToAssistantPhaseCallbackMs: requireTiming(
      preProviderBreakdown?.workspaceForegroundPassToAssistantPhaseCallbackMs,
      "workspaceForegroundPassToAssistantPhaseCallbackMs",
    ),
    workspaceRestoreDoneToStagedMs: elapsedIso(
      requireIso(trace.workspaceRestoreDoneAt),
      trace.assistantInputStagedAt,
    ),
  };
}

async function prepareEstablishedWorkspaceTrial(input: {
  chatId: string;
  ordinal: number;
  userId: string;
}): Promise<HostedWorkspaceSnapshotV2Ref> {
  const activeScenario = requireScenario();
  const activeLinqStub = requireLinqStub();
  const setupInboundText = `Cold-start benchmark setup ${input.ordinal}.`;
  const setupEventId =
    `evt_local_cold_start_setup_${benchmarkRunToken}_${input.ordinal}`;
  const replyPath = `/chats/${encodeURIComponent(input.chatId)}/messages`;
  const setupReplyMatcher = (request: ObservedLinqRequest): boolean =>
    activeLinqStub.readObservedMessageText(request) === setupReplyText;

  await activeScenario.enqueueWake(
    buildActivationWake(input.userId, input.ordinal),
    input.userId,
  );
  const providerBaseline = listResponsesApiRequests().length;
  const setupReplyBaseline = activeLinqStub.countAcceptedSends(
    replyPath,
    setupReplyMatcher,
  );
  activeScenario.queueAssistantResponses([
    buildAssistantProviderShellCommandCall(
      `mkdir -p bank/hosted-e2e && head -c ${productionMedianPayloadBytes} /dev/urandom > bank/hosted-e2e/cold-start-payload.bin`,
    ),
    setupReplyText,
  ], {
    matchInputContains: setupInboundText,
  });

  const response = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
    input.userId,
    input.chatId,
    {
      eventId: setupEventId,
      messageId: `msg_${setupEventId}`,
      text: setupInboundText,
    },
  ));
  expect(response.status).toBe(202);
  await expect(response.json()).resolves.toMatchObject({
    ok: true,
    reason: "wake-appended-active-member",
  });
  await activeScenario.waitForLatestPendingWake(input.userId);
  const completion = activeScenario.waitForHostedCompletion(input.userId);
  await activeLinqStub.waitForMatchingAcceptedSendCount({
    expectedCount: setupReplyBaseline + 1,
    expectedPath: replyPath,
    matchRequest: setupReplyMatcher,
    scenario: activeScenario,
    userId: input.userId,
  });
  const finalStatus = await completion;
  expect(finalStatus.lastErrorCode ?? null).toBeNull();
  expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
  const providerRequests = listResponsesApiRequests()
    .slice(providerBaseline)
    .filter((request) => readAssistantProviderRequestText(request).includes(setupInboundText));
  expect(providerRequests).toHaveLength(2);

  const snapshotRef = await waitForEstablishedSnapshot({
    userId: input.userId,
  });
  expect(snapshotRef.archive.encryptedByteSize).toBeGreaterThanOrEqual(
    productionMedianPayloadBytes,
  );
  expect(snapshotRef.archive.totalPlainBytes).toBeGreaterThanOrEqual(
    productionMedianPayloadBytes,
  );
  await assertHostedLocalSnapshotObject(snapshotRef);
  const restartEnvironment = buildBenchmarkRestartEnvironment(
    activeScenario.harness.workerRuntimeEnv ?? activeScenario.runtimeEnv,
  );

  await activeScenario.stop();
  scenario = null;
  scenario = await startBenchmarkScenario({
    resetLocalDatabase: false,
    // The database and R2 object are authoritative. A fresh local Durable
    // Object store models a new runner owner without carrying the terminated
    // container's local write fence into the measured wake.
    resetPersistDir: true,
    restartEnvironment,
  });

  const restartedStatus = await requireScenario().harness.readUserStatus(input.userId);
  const restartedSnapshotRef = restartedStatus.workspace?.snapshotRef ?? null;
  expect(restartedStatus.inFlight).toBe(false);
  expect(restartedStatus.lastErrorCode ?? null).toBeNull();
  expect(restartedSnapshotRef).toEqual(snapshotRef);
  if (!isHostedWorkspaceSnapshotV2Ref(restartedSnapshotRef)) {
    throw new Error("Restarted stack did not retain the established v2 snapshot.");
  }
  await assertHostedLocalSnapshotObject(restartedSnapshotRef);
  await seedHostedLocalR2LocatorMarker(restartedSnapshotRef);
  return restartedSnapshotRef;
}

async function waitForEstablishedSnapshot(input: {
  userId: string;
}): Promise<HostedWorkspaceSnapshotV2Ref> {
  const startedAt = Date.now();
  let lastStatus: HostedRunnerStatusResponse | null = null;

  while (Date.now() - startedAt < 30_000) {
    lastStatus = await requireScenario().harness.readUserStatus(input.userId).catch(() => null);
    const snapshotRef = lastStatus?.workspace?.snapshotRef ?? null;
    if (
      lastStatus
      && isHostedWorkspaceSnapshotV2Ref(snapshotRef)
      && snapshotRef.upload === "direct-r2-presigned-put"
      && !lastStatus.inFlight
      && !lastStatus.lastErrorCode
      && lastStatus.mailboxLag.every((lane) => lane.lag === "0")
    ) {
      return snapshotRef;
    }
    await sleep(100);
  }

  throw new Error(await requireScenario().buildFailureMessage(input.userId, [
    "Timed out waiting for a clean v2 snapshot before the full-stack restart.",
    ...(lastStatus ? [`last status: ${JSON.stringify(lastStatus)}`] : []),
  ]));
}

async function assertHostedLocalSnapshotObject(
  ref: HostedWorkspaceSnapshotV2Ref,
): Promise<void> {
  const environment = readHostedLocalR2ControlEnvironment();
  const headUrl = await createHostedR2PresignedHeadUrl({
    checksumMode: HOSTED_R2_CHECKSUM_MODE_ENABLED,
    environment,
    expiresSeconds: 300,
    key: ref.objectKey,
  });
  const response = await fetch(headUrl.url, {
    headers: {
      [HOSTED_R2_CHECKSUM_MODE_HEADER]: HOSTED_R2_CHECKSUM_MODE_ENABLED,
    },
    method: "HEAD",
    signal: AbortSignal.timeout(30_000),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-length")).toBe(
    String(ref.archive.encryptedByteSize),
  );
  expect(response.headers.get("x-amz-meta-encryptedsha256")).toBe(
    ref.archive.encryptedObjectSha256,
  );
  expect(response.headers.get("x-amz-meta-schema")).toBe(ref.schema);
  expect(response.headers.get("x-amz-meta-snapshotid")).toBe(ref.snapshotId);
  expect(response.headers.get("x-amz-checksum-sha256")).toBe(
    Buffer.from(ref.archive.encryptedObjectSha256, "hex").toString("base64"),
  );
}

async function seedHostedLocalR2LocatorMarker(
  ref: HostedWorkspaceSnapshotV2Ref,
): Promise<void> {
  const response = await requireScenario().harness.request(
    `/__test/users/${encodeURIComponent(ref.userId)}/direct-r2-locator-marker`,
    {
      body: JSON.stringify({
        objectKey: ref.objectKey,
        snapshotId: ref.snapshotId,
      }),
      headers: {
        "content-type": "application/json; charset=utf-8",
        [HOSTED_EXECUTION_USER_ID_HEADER]: ref.userId,
      },
      method: "POST",
    },
  );
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ ok: true });
}

function readHostedLocalR2ControlEnvironment(): HostedR2PresignEnvironment {
  const activeScenario = requireScenario();
  const workerEnv = activeScenario.harness.workerRuntimeEnv ?? activeScenario.runtimeEnv;
  const environment = readHostedR2PresignEnvironment(workerEnv);
  if (!environment.localEndpointAllowed || !environment.controlEndpoint) {
    throw new Error("Cold-start benchmark requires the hosted-local MinIO control endpoint.");
  }
  return {
    ...environment,
    endpoint: environment.controlEndpoint,
  };
}

async function waitForMeasuredLatencyTrace(input: {
  mailboxItemId: string;
  userId: string;
}) {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < 30_000) {
    try {
      const trace = await readHostedIngressLatencyTraceForTest({
        environment: requireScenario().runtimeEnv,
        mailboxItemId: input.mailboxItemId,
        userId: input.userId,
      });
      if (
        trace.providerStartAt
        && trace.runnerJobAcceptedAt
        && trace.runtimeAttemptId
        && trace.workspaceRestoreDoneAt
        && trace.phaseBreakdown
      ) {
        return trace;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for the measured latency trace: ${formatError(lastError)}`);
}

async function waitForMeasuredRuntimeLogs(input: {
  expectedAttemptId?: string;
  fromAt: Date;
  userId: string;
}): Promise<Awaited<ReturnType<typeof listHostedRuntimeLogsForTest>>> {
  const startedAt = Date.now();
  let lastRows: Awaited<ReturnType<typeof listHostedRuntimeLogsForTest>> = [];
  while (Date.now() - startedAt < 30_000) {
    lastRows = await listHostedRuntimeLogsForTest({
      environment: requireScenario().runtimeEnv,
      fromAt: input.fromAt,
      limit: 500,
      userId: input.userId,
    });
    const appServerInitializationLogs = lastRows.filter((entry) =>
      entry.eventCode === "assistant.automation_detail"
      && entry.redactedJson?.providerTraceKind === "codex.app_server_timing"
      && (
        entry.redactedJson.codexTimingStage === "initialized"
        || entry.redactedJson.codexTimingStage === "preinitialized"
      )
      && (!input.expectedAttemptId || entry.attemptId === input.expectedAttemptId)
    );
    const attemptId = input.expectedAttemptId
      ?? (appServerInitializationLogs.length === 1
        ? appServerInitializationLogs[0]?.attemptId
        : null);
    const hasMailboxImport = Boolean(attemptId) && lastRows.some((entry) =>
      entry.attemptId === attemptId
      && entry.component === "mailbox"
      && entry.eventCode === "mailbox.imported"
    );
    if (
      appServerInitializationLogs.length === 1
      && hasMailboxImport
    ) {
      return lastRows;
    }
    await sleep(100);
  }
  throw new Error(
    `Timed out waiting for measured runtime logs after observing ${lastRows.length} rows.`,
  );
}

function readRunnerPreparationLog(runtimeAttemptId: string): {
  preparedSnapshotRestorePresent: boolean;
  workspaceWriteFenceGeneration: string;
} {
  const matches = readStructuredLogRecords().filter((record) =>
    record.message === "Hosted runner prepared workspace invocation."
    && record.details?.workspaceAttemptId === runtimeAttemptId
  );
  if (matches.length !== 1) {
    throw new Error("Expected one structured runner preparation record.");
  }
  const prepared = matches[0]?.details?.preparedSnapshotRestorePresent;
  if (typeof prepared !== "boolean") {
    throw new Error("Runner preparation record omitted prepared restore state.");
  }
  const generation = matches[0]?.details?.workspaceWriteFenceGeneration;
  if (typeof generation !== "string") {
    throw new Error("Runner preparation record omitted its write-fence generation.");
  }
  return {
    preparedSnapshotRestorePresent: prepared,
    workspaceWriteFenceGeneration: generation,
  };
}

function readStructuredLogRecords(): Array<{
  details?: Record<string, unknown>;
  message?: unknown;
}> {
  const output = [
    requireScenario().harness.stdoutTail(2_000_000),
    requireScenario().harness.stderrTail(2_000_000),
  ].join("\n");
  const records: Array<{
    details?: Record<string, unknown>;
    message?: unknown;
  }> = [];
  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        records.push(parsed as {
          details?: Record<string, unknown>;
          message?: unknown;
        });
      }
    } catch {
      // Non-JSON subprocess output is irrelevant to the structured assertion.
    }
  }
  return records;
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

function buildSamplePercentileRecord(
  samples: readonly ColdStartSample[],
): Record<string, number> {
  const fields = [
    "acceptedToProviderMs",
    "acceptedToRunnerAcceptedMs",
    "assistantPhaseCallbackToAssistantPhaseMs",
    "assistantAutoReplyBootstrapMs",
    "automationBootstrapMs",
    "archiveExtractMs",
    "cleanupMs",
    "dataKeyUnwrapMs",
    "decryptMs",
    "durableRootReplaceMs",
    "executionTargetHydrateMs",
    "extractMs",
    "foregroundPassToWorkspaceForegroundPassMs",
    "mailboxImportDoneToAssistantPhaseMs",
    "mailboxImportDoneToForegroundPassMs",
    "nodeStartupMs",
    "objectFetchMs",
    "presignGetMs",
    "providerPreProviderSetupMs",
    "runnerAcceptedToRestoreDoneMs",
    "runtimeInvocationPreparationMs",
    "sizeGuardMs",
    "stagedToProviderMs",
    "systemMailboxMaintenanceMs",
    "workspaceAssistantPreAutomationMs",
    "workspaceForegroundPassToAssistantPhaseCallbackMs",
    "workspaceReadMs",
    "workspaceRestoreDoneToStagedMs",
  ] as const;
  const result: Record<string, number> = {};
  for (const field of fields) {
    const values = samples.flatMap((sample) => {
      const value = sample[field];
      return typeof value === "number" ? [value] : [];
    });
    if (values.length !== samples.length) {
      continue;
    }
    const label = field.endsWith("Ms") ? field.slice(0, -2) : field;
    result[`${label}P50Ms`] = percentile(values, 0.5);
    result[`${label}P90Ms`] = percentile(values, 0.9);
  }
  return result;
}

function printBenchmarkRecord(
  record: Record<string, boolean | number | string | undefined>,
): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function requirePhaseBreakdown(
  value: HostedRuntimeLatencyPhaseBreakdown | null,
): HostedRuntimeLatencyPhaseBreakdown {
  if (!value) {
    throw new Error("Expected a measured latency phase breakdown.");
  }
  return value;
}

function requireRestoreBreakdown(
  value: HostedRuntimeLatencyPhaseBreakdown,
): NonNullable<HostedRuntimeLatencyPhaseBreakdown["restore"]> {
  if (!value.restore) {
    throw new Error("Expected measured restore phase timings.");
  }
  return value.restore;
}

function requireTiming(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Expected nonnegative integer timing ${field}.`);
  }
  return value;
}

function requireIso(value: string | null): string {
  if (!value) {
    throw new Error("Expected a measured latency milestone timestamp.");
  }
  return value;
}

function elapsedIso(start: string, end: string): number {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    throw new Error("Measured latency milestones were invalid or out of order.");
  }
  return endMs - startMs;
}

function elapsedEpochMs(startMs: number, endMs: number): number {
  if (endMs < startMs) {
    throw new Error("Measured latency epoch milestones were out of order.");
  }
  return endMs - startMs;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function readBenchmarkTarget(): ColdStartBenchmarkTarget {
  const value = process.env.MURPH_E2E_COLD_START_TARGET?.trim() || "first-contact";
  if (value === "first-contact" || value === "established-v2-r2") {
    return value;
  }
  throw new RangeError(
    "MURPH_E2E_COLD_START_TARGET must be first-contact or established-v2-r2.",
  );
}

function readBenchmarkRunToken(): string {
  const value = process.env.MURPH_E2E_COLD_START_RUN_TOKEN?.trim()
    || Date.now().toString(36);
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/u.test(value)) {
    throw new RangeError(
      "MURPH_E2E_COLD_START_RUN_TOKEN must contain only lowercase letters, digits, and hyphens.",
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

function requireBenchmarkDatabaseUrl(): string {
  if (!benchmarkDatabaseUrl) {
    throw new Error("Cold-start benchmark database was not created.");
  }
  return benchmarkDatabaseUrl;
}

function requireBenchmarkWorkerPersistDir(): string {
  if (!benchmarkWorkerPersistDir) {
    throw new Error("Cold-start benchmark worker state directory was not created.");
  }
  return benchmarkWorkerPersistDir;
}

function requireBenchmarkMinioDataDir(): string {
  if (!benchmarkMinioDataDir) {
    throw new Error("Cold-start benchmark object-store directory was not created.");
  }
  return benchmarkMinioDataDir;
}

function buildBenchmarkDatabaseName(): string {
  return `murph_e2e_cold_${randomUUID().replace(/-/gu, "").slice(0, 12)}`;
}

async function createBenchmarkDatabase(name: string): Promise<string> {
  const adminUrl = new URL(DEFAULT_DATABASE_URL);
  await execFileAsync("createdb", buildPostgresDatabaseCommandArgs(adminUrl, name), {
    env: buildPostgresDatabaseCommandEnv(adminUrl),
  });

  const targetUrl = new URL(DEFAULT_DATABASE_URL);
  targetUrl.pathname = `/${name}`;
  return targetUrl.toString();
}

async function dropBenchmarkDatabase(name: string): Promise<void> {
  const adminUrl = new URL(DEFAULT_DATABASE_URL);
  const commandEnv = buildPostgresDatabaseCommandEnv(adminUrl);
  await Promise.all([
    name,
    buildHostedLocalRuntimeLogDatabaseNameForTest(name),
  ].map(async (databaseName) =>
    await execFileAsync("dropdb", [
      "--if-exists",
      "--force",
      ...buildPostgresDatabaseCommandArgs(adminUrl, databaseName),
    ], { env: commandEnv })
  ));
}

function buildPostgresDatabaseCommandArgs(url: URL, databaseName: string): string[] {
  const args: string[] = [];
  if (url.hostname) {
    args.push("--host", url.hostname);
  }
  if (url.port) {
    args.push("--port", url.port);
  }
  if (url.username) {
    args.push("--username", decodeURIComponent(url.username));
  }
  args.push(databaseName);
  return args;
}

function buildPostgresDatabaseCommandEnv(url: URL): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(url.password ? { PGPASSWORD: decodeURIComponent(url.password) } : {}),
  };
}

function buildBenchmarkRestartEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const restartEnvironment: NodeJS.ProcessEnv = {
    MURPH_DEV_USE_REMOTE_HOSTED_CRYPTO_KEYS: "1",
  };
  for (const key of HOSTED_LOCAL_RESTART_ENV_KEYS) {
    const value = source[key]?.trim();
    if (value) {
      restartEnvironment[key] = value;
    }
  }
  for (const key of HOSTED_LOCAL_REQUIRED_RESTART_ENV_KEYS) {
    if (!restartEnvironment[key]?.trim()) {
      throw new Error(`Hosted local restart environment is missing ${key}.`);
    }
  }
  return restartEnvironment;
}

const HOSTED_LOCAL_REQUIRED_RESTART_ENV_KEYS = [
  "HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION",
  "HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK",
  "HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK",
  "HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY",
  "HOSTED_R2_PRESIGN_ACCESS_KEY_ID",
  "HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY",
] as const;

const HOSTED_LOCAL_RESTART_ENV_KEYS = [
  "HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION",
  "HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK",
  "HOSTED_CRYPTO_ENV",
  "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION",
  "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM",
  "HOSTED_CRYPTO_GCP_KMS_API_ROOT",
  "HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME",
  "HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK",
  "HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY",
  "HOSTED_R2_CUTOVER_PHASE",
  "HOSTED_R2_PRESIGN_ACCESS_KEY_ID",
  "HOSTED_R2_PRESIGN_ACCOUNT_ID",
  "HOSTED_R2_PRESIGN_BUCKET_NAME",
  "HOSTED_R2_PRESIGN_ENAM_BUCKET_NAME",
  "HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY",
  "HOSTED_R2_WRITE_ADMISSION",
] as const;
