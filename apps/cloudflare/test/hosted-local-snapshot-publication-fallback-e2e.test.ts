import { createHash, createHmac } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  seedHostedWorkspaceCheckpointForTest,
} from "#hosted-web-testing";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedBrowserVaultReplicaRef,
  type HostedExecutionSnapshotRef,
} from "@murphai/hosted-execution/contracts";
import {
  isHostedWorkspaceSnapshotV2Ref,
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
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildAssistantProviderShellCommandCall,
} from "./helpers/hosted-local-e2e-support.js";
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
  type ObservedLinqRequest,
} from "./helpers/hosted-local-linq-support.js";

const runId = Date.now();
const userId = `member_local_snapshot_publication_fallback_${runId}`;
const chatId = `chat_local_snapshot_publication_fallback_${runId}`;
const firstInboundText = "Exercise the rejected snapshot publication path.";
const secondInboundText = "Verify the prior workspace snapshot restored cleanly.";
const firstReplyText = "The rejected publication probe completed.";
const secondReplyText = "The prior workspace snapshot restored cleanly.";
const linqApiToken = "linq-local-test-token";
const linqWebhookSecret = "linq-local-snapshot-publication-fallback-secret";
const assistantModel = "gpt-5.6-terra";
const vaultRelativePath = `bank/hosted-e2e/snapshot-publication-${runId}.md`;
const baselineMarker = `snapshot-publication-baseline-${runId}`;
const baselineFileContents = [
  "# Hosted snapshot publication fallback",
  `baseline_marker: ${baselineMarker}`,
  "",
].join("\n");
const baselineFileSha256 = createHash("sha256")
  .update(baselineFileContents)
  .digest("hex");
const publicationFaultMessage =
  "Hosted-local test corrupted snapshot completion metadata before real publication validation.";
const containerDestroyMessage = "Hosted execution container destroy requested.";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

const cleanupPaths: string[] = [];
let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

afterAll(async () => {
  await scenario?.stop();
  scenario = null;
  await linqStub?.stop();
  linqStub = null;
  await Promise.all(cleanupPaths.splice(0).map((target) =>
    rm(target, {
      force: true,
      recursive: true,
    })
  ));
}, 120_000);

describe("hosted local snapshot publication fallback e2e", () => {
  beforeAll(async () => {
    linqStub = await startHostedLocalLinqStub({
      expectedAuthorizationToken: linqApiToken,
    });
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_ASSISTANT_MODEL: assistantModel,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "1000",
        HOSTED_EXECUTION_RETRY_DELAY_MS: "120000",
        HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "2000",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
          buildLinqRecipientPhoneNumber(userId),
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: linqApiToken,
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        OPENAI_API_KEY: "stub-local-openai-key",
      },
      assistantProviderStubModelId: assistantModel,
      faultInjection: true,
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-snapshot-publication-fallback-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted snapshot publication fallback e2e",
      streamLogs: streamDevLogs,
      testControls: true,
    });
  }, 300_000);

  it("keeps the prior snapshot restorable after rejection and later publishes cleanly", async () => {
    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;
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

    const seededSnapshotRef = await seedBaselineWorkspaceSnapshot();
    const seededStatus = await requireScenario().harness.readUserStatus(userId);
    expect(seededStatus.workspace?.snapshotRef).toEqual(seededSnapshotRef);
    await requireScenario().runWake(buildActivationWake(), userId);
    const baselineStatus = await waitForCleanSnapshotPublication(seededSnapshotRef);
    const baselineSnapshotRef = baselineStatus.workspace?.snapshotRef;
    if (!baselineSnapshotRef || !isHostedWorkspaceSnapshotV2Ref(baselineSnapshotRef)) {
      throw new Error("Activation did not publish the production v2 baseline snapshot.");
    }
    const initialWorkspaceVersion = requireWorkspaceVersion(baselineStatus);
    const baselineObservedReplyCount = requireLinqStub().countObservedSends(replyPath);
    const baselineAcceptedReplyCount = requireLinqStub().countAcceptedSends(replyPath);
    const baselineFaultCount = countSnapshotPublicationFaults();
    const baselineInvokeFailureDestroyCount = countInvokeFailureDestroyRequests();

    requireScenario().queueAssistantResponses([firstReplyText], {
      matchInputContains: firstInboundText,
    });
    await requireScenario().harness.armSnapshotPublicationCorruptionForTest(userId);
    const firstWebhookResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, chatId, {
        eventId: `evt_snapshot_publication_rejected_${runId}`,
        messageId: `msg_snapshot_publication_rejected_${runId}`,
        text: firstInboundText,
      }),
    );
    expect(firstWebhookResponse.status).toBe(202);
    await expect(firstWebhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(userId);
    const firstReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: baselineObservedReplyCount,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(firstReply)).toBe(firstReplyText);

    const rejectedPublicationStatus = await waitForRejectedSnapshotPublication({
      baselineFaultCount,
    });
    expect(readSnapshotPublicationValidationStatuses()).toContain(409);
    const publicationRefAtFaultObservation =
      rejectedPublicationStatus.workspace?.snapshotRef;
    expect(isHostedWorkspaceSnapshotV2Ref(publicationRefAtFaultObservation ?? null))
      .toBe(true);
    if (!publicationRefAtFaultObservation) {
      throw new Error("Rejected publication did not retain a restorable snapshot.");
    }
    const recoveryCompletedBeforeFaultObservation = hasCleanSnapshotPublication(
      rejectedPublicationStatus,
      baselineSnapshotRef,
    );
    if (!recoveryCompletedBeforeFaultObservation) {
      expect(publicationRefAtFaultObservation).toEqual(baselineSnapshotRef);
    }
    expect(requireWorkspaceVersion(rejectedPublicationStatus))
      .toBeGreaterThanOrEqual(initialWorkspaceVersion);
    expect(countSnapshotPublicationFaults()).toBe(baselineFaultCount + 1);

    await waitForInvokeFailureDestroy({
      baselineInvokeFailureDestroyCount,
    });

    if (!recoveryCompletedBeforeFaultObservation) {
      requireScenario().queueAssistantResponses([firstReplyText], {
        matchInputContains: firstInboundText,
      });
    }
    const restoredStatus = recoveryCompletedBeforeFaultObservation
      ? rejectedPublicationStatus
      : await waitForCleanSnapshotPublication(baselineSnapshotRef);
    const restoredSnapshotRef = restoredStatus.workspace?.snapshotRef;
    if (!restoredSnapshotRef || !isHostedWorkspaceSnapshotV2Ref(restoredSnapshotRef)) {
      throw new Error("Recovered provider turn did not publish a clean v2 snapshot.");
    }
    const firstReplyAttempts = requireLinqStub().observedRequests.filter((request) =>
      request.method === "POST"
      && request.url === replyPath
      && requireLinqStub().readObservedMessageText(request) === firstReplyText
    );
    expect(firstReplyAttempts.length).toBeGreaterThanOrEqual(1);
    expect(firstReplyAttempts.length).toBeLessThanOrEqual(2);
    const firstReplyIdempotencyKeys =
      firstReplyAttempts.map(readLinqMessageIdempotencyKey);
    expect(firstReplyIdempotencyKeys[0]).toMatch(/^\S+$/u);
    expect(new Set(firstReplyIdempotencyKeys)).toEqual(
      new Set([firstReplyIdempotencyKeys[0]]),
    );
    expect(requireLinqStub().countAcceptedSends(replyPath))
      .toBe(baselineAcceptedReplyCount + 1);

    const providerRequestBaseline = countAssistantProviderResponsesApiRequests();
    const secondReplyMatcher = (request: ObservedLinqRequest) =>
      requireLinqStub().readObservedMessageText(request) === secondReplyText;
    const secondReplyBaseline =
      requireLinqStub().countObservedSends(replyPath, secondReplyMatcher);
    requireScenario().queueAssistantResponses([
      buildAssistantProviderShellCommandCall(`sha256sum ${vaultRelativePath}`),
      secondReplyText,
    ], {
      matchInputContains: secondInboundText,
    });
    const secondWebhookResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, chatId, {
        eventId: `evt_snapshot_publication_recovery_${runId}`,
        messageId: `msg_snapshot_publication_recovery_${runId}`,
        text: secondInboundText,
      }),
    );
    expect(secondWebhookResponse.status).toBe(202);
    await expect(secondWebhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(userId);
    const secondReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: secondReplyBaseline,
      expectedPath: replyPath,
      matchRequest: secondReplyMatcher,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(secondReply)).toBe(secondReplyText);
    expect(requireLinqStub().countAcceptedSends(replyPath))
      .toBe(baselineAcceptedReplyCount + 2);

    const recoveryProviderText = requireScenario().assistantProviderRequests
      .filter((request) => request.url === "/v1/responses")
      .slice(providerRequestBaseline)
      .map(readAssistantProviderRequestText)
      .join("\n\n");
    expect(recoveryProviderText).toContain(baselineFileSha256);

    const finalStatus = await waitForCleanSnapshotPublication(restoredSnapshotRef);
    expect(finalStatus.workspace).not.toBeNull();
    expect(isHostedWorkspaceSnapshotV2Ref(finalStatus.workspace?.snapshotRef ?? null)).toBe(true);
    expect(finalStatus.workspace?.snapshotRef).not.toEqual(baselineSnapshotRef);
    expect(finalStatus.workspace?.snapshotRef).not.toEqual(restoredSnapshotRef);
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    expect(countSnapshotPublicationFaults()).toBe(baselineFaultCount + 1);
  }, 600_000);
});

function buildActivationWake() {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${userId}:snapshot-publication-fallback`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId: userId,
    occurredAt: new Date().toISOString(),
  });
}

async function seedBaselineWorkspaceSnapshot(): Promise<HostedExecutionSnapshotRef> {
  const root = await mkdtemp(path.join(tmpdir(), "murph-snapshot-publication-fallback-"));
  cleanupPaths.push(root);
  const operatorHomeRoot = path.join(root, "operator-home");
  const vaultRoot = path.join(root, "vault");
  await mkdir(operatorHomeRoot, { recursive: true });
  await createIntegratedVaultServices().core.init({
    requestId: `seed-snapshot-publication-fallback-${runId}`,
    timezone: "Asia/Kuala_Lumpur",
    vault: vaultRoot,
  });
  const markerPath = path.join(vaultRoot, vaultRelativePath);
  await mkdir(path.dirname(markerPath), { recursive: true });
  await writeFile(markerPath, baselineFileContents, "utf8");

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
      seededSnapshotPublicationFallback: true,
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
  return snapshotRef;
}

async function waitForRejectedSnapshotPublication(input: {
  baselineFaultCount: number;
}): Promise<HostedRunnerStatusResponse> {
  const startedAt = Date.now();
  let lastStatus: HostedRunnerStatusResponse | null = null;
  while (Date.now() - startedAt < 180_000) {
    lastStatus = await requireScenario().harness.readUserStatus(userId);
    if (countSnapshotPublicationFaults() > input.baselineFaultCount) {
      return lastStatus;
    }
    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for the real snapshot publication validator to reject corrupted metadata.",
    ...(lastStatus ? [`last status: ${JSON.stringify(lastStatus)}`] : []),
  ]));
}

async function waitForInvokeFailureDestroy(input: {
  baselineInvokeFailureDestroyCount: number;
}): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120_000) {
    if (countInvokeFailureDestroyRequests() > input.baselineInvokeFailureDestroyCount) {
      return;
    }
    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for the failed snapshot publication to recycle its runner container.",
  ]));
}

async function waitForCleanSnapshotPublication(
  baselineSnapshotRef: HostedExecutionSnapshotRef,
): Promise<HostedRunnerStatusResponse> {
  const startedAt = Date.now();
  let lastStatus: HostedRunnerStatusResponse | null = null;
  while (Date.now() - startedAt < 240_000) {
    lastStatus = await requireScenario().harness.readUserStatus(userId).catch(() => null);
    if (!lastStatus) {
      await sleep(250);
      continue;
    }
    if (hasCleanSnapshotPublication(lastStatus, baselineSnapshotRef)) {
      return lastStatus;
    }
    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for a clean snapshot publication after the one-shot rejection.",
    ...(lastStatus ? [`last status: ${JSON.stringify(lastStatus)}`] : []),
  ]));
}

function hasCleanSnapshotPublication(
  status: HostedRunnerStatusResponse,
  baselineSnapshotRef: HostedExecutionSnapshotRef,
): boolean {
  const snapshotRef = status.workspace?.snapshotRef ?? null;
  return isHostedWorkspaceSnapshotV2Ref(snapshotRef)
    && JSON.stringify(snapshotRef) !== JSON.stringify(baselineSnapshotRef)
    && !status.inFlight
    && !status.lastErrorCode
    && status.mailboxLag.every((lane) => lane.lag === "0");
}

function countSnapshotPublicationFaults(): number {
  return readStructuredLogRecords().filter((record) =>
    record.message === publicationFaultMessage
  ).length;
}

function readLinqMessageIdempotencyKey(request: {
  body: string;
}): string | null {
  const payload: unknown = JSON.parse(request.body);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const message = (payload as Record<string, unknown>).message;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null;
  }
  const idempotencyKey = (message as Record<string, unknown>).idempotency_key;
  return typeof idempotencyKey === "string" ? idempotencyKey : null;
}

function readSnapshotPublicationValidationStatuses(): number[] {
  return readStructuredLogRecords()
    .filter((record) => record.message === publicationFaultMessage)
    .map((record) => record.details?.validationStatus)
    .filter((status): status is number => typeof status === "number");
}

function countInvokeFailureDestroyRequests(): number {
  return readStructuredLogRecords().filter((record) =>
    record.message === containerDestroyMessage
    && record.details?.destroyRequestReason === "invoke-failure"
  ).length;
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
    const jsonStart = trimmed.indexOf("{");
    const jsonEnd = trimmed.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
      continue;
    }
    try {
      const value: unknown = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
      if (value && typeof value === "object" && !Array.isArray(value)) {
        records.push(value as {
          details?: Record<string, unknown>;
          message?: unknown;
        });
      }
    } catch {
      // Non-JSON child-process output is irrelevant to the structured-log assertions.
    }
  }
  return records;
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

function requireWorkspaceVersion(status: HostedRunnerStatusResponse): bigint {
  const version = status.workspace?.version;
  if (!version) {
    throw new Error("Hosted snapshot publication fallback status is missing a workspace version.");
  }
  return BigInt(version);
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

function createBrowserVaultReplicaRef(
  sourceBundleHash: string,
): HostedBrowserVaultReplicaRef {
  return {
    byteLength: 256,
    dataVersion: `snapshot-publication-${sourceBundleHash.slice(0, 16)}`,
    generatedAt: new Date().toISOString(),
    keyId: "browser-vault-replica:snapshot-publication-fallback",
    objectKey: `browser-vault/${userId}/snapshot-publication-fallback.json`,
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:snapshot-publication-fallback",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
  };
}

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1_000));
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
    throw new Error("Hosted local snapshot publication fallback scenario was not started.");
  }
  return scenario;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local snapshot publication fallback Linq stub was not started.");
  }
  return linqStub;
}
