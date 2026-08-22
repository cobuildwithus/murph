import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  seedHostedWorkspaceCheckpointForTest,
} from "#hosted-web-testing";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedBrowserVaultReplicaRef,
  type HostedExecutionSnapshotRef,
} from "@murphai/hosted-execution/contracts";
import {
  isHostedWorkspaceSnapshotV2Ref,
  parseHostedRunnerStatusResponse,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRunnerStatusResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  sha256HostedBundleHex,
  snapshotHostedExecutionContext,
} from "@murphai/runtime-state/node";
import {
  createIntegratedVaultServices,
} from "@murphai/vault-usecases/vault-services";

import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildHostedLinqInboundEvent,
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
  type ObservedLinqRequestMatcher,
} from "./helpers/hosted-local-linq-support.js";

const runId = Date.now();
const userId = `member_local_shutdown_conversation_ahead_${runId}`;
const chatId = `chat_local_shutdown_conversation_ahead_${runId}`;
const firstInboundText = "first input before the shutdown checkpoint";
const conversationAheadInboundText = "conversation input appended during checkpoint publication";
const firstReplyText = "First reply captured before shutdown.";
const conversationAheadReplyText = "Conversation-ahead input restored exactly once.";
const linqWebhookSecret = "linq-local-shutdown-conversation-ahead-secret";
const assistantModel = "gpt-5.6-terra";
const idleCheckpointDelayMs = 180_000;
const idleCheckpointWaitTimeoutMs = idleCheckpointDelayMs + 60_000;

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

const cleanupPaths: string[] = [];
let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;
let gracefulStopPromise: Promise<{ ok: true }> | null = null;

afterAll(async () => {
  if (scenario) {
    await scenario.harness.releaseShutdownCheckpointPublicationBarrierForTest(userId)
      .catch(() => undefined);
  }
  await gracefulStopPromise?.catch(() => undefined);
  gracefulStopPromise = null;
  await scenario?.stop();
  scenario = null;
  await linqStub?.stop();
  linqStub = null;
  await Promise.all(cleanupPaths.splice(0).map((target) =>
    rm(target, { force: true, recursive: true })
  ));
}, 120_000);

describe("hosted local shutdown checkpoint conversation-ahead e2e", () => {
  beforeAll(async () => {
    linqStub = await startHostedLocalLinqStub();
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_ASSISTANT_MODEL: assistantModel,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: String(idleCheckpointDelayMs),
        HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "300000",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
          buildLinqRecipientPhoneNumber(userId),
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: "linq-local-test-token",
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        OPENAI_API_KEY: "stub-local-openai-key",
      },
      assistantProviderStubModelId: assistantModel,
      faultInjection: true,
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-shutdown-conversation-ahead-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted shutdown checkpoint conversation-ahead e2e",
      streamLogs: streamDevLogs,
      testControls: true,
    });
  }, 300_000);

  it("commits one shutdown snapshot and cold-restores the appended conversation once", async () => {
    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;
    const firstReplyMatcher = matchLinqMessageText(firstReplyText);
    const conversationAheadReplyMatcher = matchLinqMessageText(conversationAheadReplyText);

    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(userId),
      memberId: userId,
      memberPhone,
    });
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId,
      memberId: userId,
      recipientPhone: memberPhone,
    });
    await seedActivatedWorkspaceCheckpoint();

    const baselineStatus = await readHostedRunnerStatusWithLogLimit(100);
    const baselineAcceptedRequestCount = requireLinqStub().acceptedSendRequests.length;
    const baselineMessageIdCount = requireLinqStub().listObservedMessageIds(chatId).length;
    const baselineFirstAcceptedCount = requireLinqStub().countAcceptedSends(
      replyPath,
      firstReplyMatcher,
    );
    const baselineConversationAheadAcceptedCount = requireLinqStub().countAcceptedSends(
      replyPath,
      conversationAheadReplyMatcher,
    );
    const baselineProviderRequestCount = countAssistantProviderResponsesApiRequests();
    const baselineContainerStartCount = countContainerStartLogs();

    requireScenario().queueAssistantResponses([firstReplyText], {
      matchInputContains: firstInboundText,
    });
    requireScenario().queueAssistantResponses([conversationAheadReplyText], {
      matchInputContains: conversationAheadInboundText,
    });

    const firstWebhookResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, chatId, {
        eventId: `evt_shutdown_conversation_first_${runId}`,
        messageId: `msg_shutdown_conversation_first_${runId}`,
        text: firstInboundText,
      }),
    );
    expect(firstWebhookResponse.status).toBe(202);
    await expect(firstWebhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(userId);
    const firstReply = await requireLinqStub().waitForAdditionalAcceptedSend({
      baselineCount: baselineFirstAcceptedCount,
      expectedPath: replyPath,
      matchRequest: firstReplyMatcher,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(firstReply)).toBe(firstReplyText);
    const firstReplyStatus = await readHostedRunnerStatusWithLogLimit(100);
    expect(firstReplyStatus.inFlight).toBe(true);
    const shutdownBaselineIdleSnapshotCount =
      countIdleShutdownSnapshotLogs(firstReplyStatus);

    await requireScenario().harness.armShutdownCheckpointPublicationBarrierForTest(userId);
    gracefulStopPromise =
      requireScenario().harness.beginShutdownCheckpointGracefulStopForTest(userId);
    await waitForShutdownCheckpointPublicationBarrier();
    const publicationHeldStatus = await readHostedRunnerStatusWithLogLimit(100);
    const publicationHeldWorkspaceVersion = requireWorkspaceVersion(publicationHeldStatus);
    expect(countIdleShutdownSnapshotLogs(publicationHeldStatus)).toBe(
      shutdownBaselineIdleSnapshotCount,
    );

    const conversationAheadWebhookResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, chatId, {
        eventId: `evt_shutdown_conversation_ahead_${runId}`,
        messageId: `msg_shutdown_conversation_ahead_${runId}`,
        text: conversationAheadInboundText,
      }),
    );
    expect(conversationAheadWebhookResponse.status).toBe(202);
    await expect(conversationAheadWebhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    await waitForConversationMailboxLag();
    expect(requireLinqStub().countAcceptedSends(replyPath, conversationAheadReplyMatcher)).toBe(
      baselineConversationAheadAcceptedCount,
    );
    expect(countAssistantProviderResponsesApiRequests()).toBe(
      baselineProviderRequestCount + 1,
    );

    await expect(
      requireScenario().harness.releaseShutdownCheckpointPublicationBarrierForTest(userId),
    ).resolves.toEqual({ ok: true, released: true });
    await expect(gracefulStopPromise).resolves.toEqual({ ok: true });
    gracefulStopPromise = null;
    await expect(
      requireScenario().harness.readShutdownCheckpointPublicationBarrierForTest(userId),
    ).resolves.toEqual({ state: "unarmed" });

    const committedShutdownStatus = await waitForCommittedShutdownCheckpoint({
      baselineIdleSnapshotCount: shutdownBaselineIdleSnapshotCount,
      publicationHeldWorkspaceVersion,
    });
    expect(isHostedWorkspaceSnapshotV2Ref(
      committedShutdownStatus.workspace?.snapshotRef ?? null,
    )).toBe(true);
    expect(countIdleShutdownSnapshotLogs(committedShutdownStatus)).toBe(
      shutdownBaselineIdleSnapshotCount + 1,
    );
    const committedShutdownSnapshotAtMs = requireLatestIdleShutdownSnapshotAtMs(
      committedShutdownStatus,
    );
    expect(requireLinqStub().countAcceptedSends(replyPath, firstReplyMatcher)).toBe(
      baselineFirstAcceptedCount + 1,
    );

    const restoredReply = await requireLinqStub().waitForAdditionalAcceptedSend({
      baselineCount: baselineConversationAheadAcceptedCount,
      expectedPath: replyPath,
      matchRequest: conversationAheadReplyMatcher,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(restoredReply))
      .toBe(conversationAheadReplyText);
    expect(countContainerStartLogs()).toBeGreaterThanOrEqual(baselineContainerStartCount + 2);

    const acceptedReplies = requireLinqStub().acceptedSendRequests
      .slice(baselineAcceptedRequestCount)
      .filter((request) => request.url === replyPath);
    expect(acceptedReplies.map((request) => requireLinqStub().readObservedMessageText(request)))
      .toEqual([firstReplyText, conversationAheadReplyText]);
    expect(requireLinqStub().listObservedMessageIds(chatId)).toHaveLength(
      baselineMessageIdCount + 2,
    );

    const providerRequests = requireScenario().assistantProviderRequests
      .filter((request) => request.url === "/v1/responses")
      .slice(baselineProviderRequestCount);
    expect(providerRequests).toHaveLength(2);
    expect(readAssistantProviderRequestText(providerRequests[0]!)).toContain(firstInboundText);
    expect(readAssistantProviderRequestText(providerRequests[1]!))
      .toContain(conversationAheadInboundText);

    const finalStatus = await waitForRestoredTerminalBoundaryAfterNaturalCheckpoint({
      afterIdleSnapshotAtMs: committedShutdownSnapshotAtMs,
    });
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    const finalIdleSnapshotAtMs = requireLatestIdleShutdownSnapshotAtMs(finalStatus);
    expect(finalIdleSnapshotAtMs)
      .toBeGreaterThan(committedShutdownSnapshotAtMs);
    expect(hasReachedRestoredTerminalBoundary(
      finalStatus,
      finalIdleSnapshotAtMs,
    )).toBe(true);
    await assertNoDuplicateReplyAfterTerminalBoundary({
      baselineConversationAheadAcceptedCount,
      baselineFirstAcceptedCount,
      baselineMessageIdCount,
      conversationAheadReplyMatcher,
      firstReplyMatcher,
      providerRequestCount: baselineProviderRequestCount + 2,
      replyPath,
    });
  }, 600_000);
});

async function seedActivatedWorkspaceCheckpoint(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "murph-shutdown-conversation-ahead-"));
  cleanupPaths.push(root);
  const operatorHomeRoot = path.join(root, "operator-home");
  const vaultRoot = path.join(root, "vault");
  await mkdir(operatorHomeRoot, { recursive: true });
  await createIntegratedVaultServices().core.init({
    requestId: `seed-shutdown-conversation-ahead-${runId}`,
    timezone: "America/New_York",
    vault: vaultRoot,
  });

  const snapshot = await snapshotHostedExecutionContext({
    operatorHomeRoot,
    vaultRoot,
  });
  const hash = sha256HostedBundleHex(snapshot.bundle);
  const snapshotRef = createSnapshotBundleRef({
    hash,
    size: snapshot.bundle.byteLength,
  });
  const checkpoint = await seedHostedWorkspaceCheckpointForTest({
    browserVaultReplicaRef: createBrowserVaultReplicaRef(hash),
    environment: requireScenario().runtimeEnv,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatusJson: {
      seededShutdownConversationAhead: true,
    },
    snapshotRef,
    userId,
  });
  expect(checkpoint.status).toBe("updated");

  const uploadResponse = await requireScenario().harness.request(
    `/__test/artifacts?userId=${encodeURIComponent(userId)}&sha256=${hash}`,
    {
      body: new Blob([new Uint8Array(snapshot.bundle)]),
      headers: {
        [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
      },
      method: "PUT",
    },
  );
  expect(uploadResponse.status).toBe(200);
}

async function waitForShutdownCheckpointPublicationBarrier(): Promise<void> {
  const startedAt = Date.now();
  let lastState: string | null = null;
  while (Date.now() - startedAt < 120_000) {
    const barrier = await requireScenario().harness
      .readShutdownCheckpointPublicationBarrierForTest(userId);
    lastState = barrier.state;
    if (barrier.state === "entered") {
      return;
    }
    await sleep(100);
  }
  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for shutdown checkpoint publication to enter its test barrier.",
    `last barrier state: ${lastState ?? "unread"}`,
  ]));
}

async function waitForConversationMailboxLag(): Promise<HostedRunnerStatusResponse> {
  const startedAt = Date.now();
  let lastStatus: HostedRunnerStatusResponse | null = null;
  while (Date.now() - startedAt < 30_000) {
    lastStatus = await readHostedRunnerStatusWithLogLimit(100);
    const conversation = lastStatus.mailboxLag.find((lane) => lane.lane === "conversation");
    if (conversation && BigInt(conversation.lag) > 0n) {
      return lastStatus;
    }
    await sleep(100);
  }
  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for conversation mailbox lag while checkpoint publication was held.",
    ...(lastStatus ? [`last status: ${JSON.stringify(lastStatus)}`] : []),
  ]));
}

async function waitForCommittedShutdownCheckpoint(input: {
  baselineIdleSnapshotCount: number;
  publicationHeldWorkspaceVersion: bigint;
}): Promise<HostedRunnerStatusResponse> {
  const startedAt = Date.now();
  let lastStatus: HostedRunnerStatusResponse | null = null;
  while (Date.now() - startedAt < 60_000) {
    lastStatus = await readHostedRunnerStatusWithLogLimit(100);
    if (
      lastStatus.workspace
      && isHostedWorkspaceSnapshotV2Ref(lastStatus.workspace.snapshotRef)
      && requireWorkspaceVersion(lastStatus) > input.publicationHeldWorkspaceVersion
      && countIdleShutdownSnapshotLogs(lastStatus) === input.baselineIdleSnapshotCount + 1
    ) {
      return lastStatus;
    }
    await sleep(100);
  }
  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for the held shutdown checkpoint to commit exactly once.",
    ...(lastStatus ? [`last status: ${JSON.stringify(lastStatus)}`] : []),
  ]));
}

async function waitForRestoredTerminalBoundaryAfterNaturalCheckpoint(input: {
  afterIdleSnapshotAtMs: number;
}): Promise<HostedRunnerStatusResponse> {
  const startedAt = Date.now();
  let lastStatus: HostedRunnerStatusResponse | null = null;
  while (Date.now() - startedAt < idleCheckpointWaitTimeoutMs) {
    lastStatus = await readHostedRunnerStatusWithLogLimit(100);
    const latestIdleSnapshotAtMs = readLatestIdleShutdownSnapshotAtMs(lastStatus);
    if (
      !lastStatus.lastErrorCode
      && lastStatus.mailboxLag.every((lane) => lane.lag === "0")
      && latestIdleSnapshotAtMs !== null
      && latestIdleSnapshotAtMs > input.afterIdleSnapshotAtMs
      && hasReachedRestoredTerminalBoundary(
        lastStatus,
        latestIdleSnapshotAtMs,
      )
    ) {
      return lastStatus;
    }
    await sleep(100);
  }
  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for a restored terminal boundary after the natural idle checkpoint.",
    ...(lastStatus ? [`last status: ${JSON.stringify(lastStatus)}`] : []),
  ]));
}

function requireLatestIdleShutdownSnapshotAtMs(
  status: HostedRunnerStatusResponse,
): number {
  const value = readLatestIdleShutdownSnapshotAtMs(status);
  if (value === null) {
    throw new Error("Hosted runner status is missing a timestamped idle shutdown snapshot.");
  }
  return value;
}

function readLatestIdleShutdownSnapshotAtMs(
  status: HostedRunnerStatusResponse,
): number | null {
  let latestIdleSnapshotAtMs: number | null = null;
  for (const entry of status.recentLogs ?? []) {
    if (
      entry.eventCode !== "checkpoint.snapshot_finished"
      || entry.redactedJson?.checkpointReason !== "idle_shutdown"
    ) {
      continue;
    }
    const entryAtMs = Date.parse(entry.at);
    if (
      Number.isFinite(entryAtMs)
      && (latestIdleSnapshotAtMs === null || entryAtMs > latestIdleSnapshotAtMs)
    ) {
      latestIdleSnapshotAtMs = entryAtMs;
    }
  }
  return latestIdleSnapshotAtMs;
}

function hasAssistantPassFinishedAtOrAfter(
  status: HostedRunnerStatusResponse,
  afterAtMs: number,
): boolean {
  return (status.recentLogs ?? []).some((entry) =>
    entry.eventCode === "assistant.pass_finished"
    && Date.parse(entry.at) >= afterAtMs
  );
}

function hasReachedRestoredTerminalBoundary(
  status: HostedRunnerStatusResponse,
  naturalIdleSnapshotAtMs: number,
): boolean {
  return hasAssistantPassFinishedAtOrAfter(status, naturalIdleSnapshotAtMs)
    || (
      !status.inFlight
      && hasIdleShutdownSnapshotWithoutRuntimeWakeAt(
        status,
        naturalIdleSnapshotAtMs,
      )
    )
    || (
      !status.inFlight
      && hasEmptyMailboxImportAtOrAfter(
        status,
        naturalIdleSnapshotAtMs,
      )
    );
}

function hasIdleShutdownSnapshotWithoutRuntimeWakeAt(
  status: HostedRunnerStatusResponse,
  expectedAtMs: number,
): boolean {
  return (status.recentLogs ?? []).some((entry) =>
    entry.eventCode === "checkpoint.snapshot_finished"
    && entry.redactedJson?.checkpointReason === "idle_shutdown"
    && entry.redactedJson.runtimeWakePendingAtCheckpoint === false
    && Date.parse(entry.at) === expectedAtMs
  );
}

function hasEmptyMailboxImportAtOrAfter(
  status: HostedRunnerStatusResponse,
  expectedAtMs: number,
): boolean {
  return (status.recentLogs ?? []).some((entry) =>
    entry.eventCode === "mailbox.imported"
    && Date.parse(entry.at) >= expectedAtMs
    && entry.redactedJson?.fetchedCount === 0
    && entry.redactedJson.importedCount === 0
    && entry.redactedJson.blockedCount === 0
    && entry.redactedJson.stateChanged === false
  );
}

async function assertNoDuplicateReplyAfterTerminalBoundary(input: {
  baselineConversationAheadAcceptedCount: number;
  baselineFirstAcceptedCount: number;
  baselineMessageIdCount: number;
  conversationAheadReplyMatcher: ObservedLinqRequestMatcher;
  firstReplyMatcher: ObservedLinqRequestMatcher;
  providerRequestCount: number;
  replyPath: string;
}): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 3_000) {
    expect(requireLinqStub().countAcceptedSends(input.replyPath, input.firstReplyMatcher))
      .toBe(input.baselineFirstAcceptedCount + 1);
    expect(requireLinqStub().countAcceptedSends(
      input.replyPath,
      input.conversationAheadReplyMatcher,
    )).toBe(input.baselineConversationAheadAcceptedCount + 1);
    expect(requireLinqStub().listObservedMessageIds(chatId)).toHaveLength(
      input.baselineMessageIdCount + 2,
    );
    expect(countAssistantProviderResponsesApiRequests()).toBe(input.providerRequestCount);
    await sleep(250);
  }
}

async function readHostedRunnerStatusWithLogLimit(
  logLimit: number,
): Promise<HostedRunnerStatusResponse> {
  const status = parseHostedRunnerStatusResponse(
    await requireScenario().harness.requestJson(
      `/internal/users/${encodeURIComponent(userId)}/status?logLimit=${logLimit}`,
      {
        headers: {
          [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
        },
      },
    ),
  );
  if (status.userId !== userId) {
    throw new Error("Hosted runner status read returned a different user.");
  }
  return status;
}

function countIdleShutdownSnapshotLogs(status: HostedRunnerStatusResponse): number {
  return (status.recentLogs ?? []).filter((entry) =>
    entry.eventCode === "checkpoint.snapshot_finished"
    && entry.redactedJson?.checkpointReason === "idle_shutdown"
  ).length;
}

function requireWorkspaceVersion(status: HostedRunnerStatusResponse): bigint {
  const version = status.workspace?.version;
  if (!version || !/^\d+$/u.test(version)) {
    throw new Error("Hosted workspace status is missing a numeric version.");
  }
  return BigInt(version);
}

function countContainerStartLogs(): number {
  return readStructuredLogRecords().filter((record) =>
    record.message === "Hosted execution container starting."
  ).length;
}

function readStructuredLogRecords(): Array<{ message?: unknown }> {
  const output = [
    requireScenario().harness.stdoutTail(2_000_000),
    requireScenario().harness.stderrTail(2_000_000),
  ].join("\n");
  return output.split(/\r?\n/u).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      return [];
    }
    try {
      const value: unknown = JSON.parse(trimmed);
      return value && typeof value === "object" && !Array.isArray(value)
        ? [value as { message?: unknown }]
        : [];
    } catch {
      return [];
    }
  });
}

function matchLinqMessageText(expectedText: string): ObservedLinqRequestMatcher {
  return (request) => requireLinqStub().readObservedMessageText(request) === expectedText;
}

function countAssistantProviderResponsesApiRequests(): number {
  return requireScenario().assistantProviderRequests.filter((request) =>
    request.url === "/v1/responses"
  ).length;
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

function createSnapshotBundleRef(input: {
  hash: string;
  size: number;
}): HostedExecutionSnapshotRef {
  return {
    hash: input.hash,
    key: `cloudflare-workspace-snapshots/${input.hash}.bundle`,
    size: input.size,
    updatedAt: new Date().toISOString(),
  };
}

function createBrowserVaultReplicaRef(sourceBundleHash: string): HostedBrowserVaultReplicaRef {
  return {
    byteLength: 256,
    dataVersion: `shutdown-ahead-${sourceBundleHash.slice(0, 16)}`,
    generatedAt: new Date().toISOString(),
    keyId: "browser-vault-replica:shutdown-ahead",
    objectKey: `browser-vault/shutdown-ahead-${sourceBundleHash.slice(0, 32)}.json`,
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:shutdown-ahead",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
  };
}

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", linqWebhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return await fetch(`${requireScenario().harness.webBaseUrl}/api/hosted-onboarding/linq/webhook`, {
    body: rawBody,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-webhook-signature": `sha256=${signature}`,
      "x-webhook-timestamp": timestamp,
    },
    method: "POST",
  });
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local shutdown conversation-ahead scenario was not started.");
  }
  return scenario;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local shutdown conversation-ahead Linq stub was not started.");
  }
  return linqStub;
}
