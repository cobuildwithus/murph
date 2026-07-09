import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  seedHostedWorkspaceCheckpointForTest,
} from "#hosted-web-testing";
import {
  saveAssistantAutomationState,
  upsertAssistantInputEvent,
} from "@murphai/assistant-engine";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedBrowserVaultReplicaRef,
  type HostedExecutionSnapshotRef,
} from "@murphai/hosted-execution/contracts";
import {
  sha256HostedBundleHex,
  snapshotHostedExecutionContext,
} from "@murphai/runtime-state/node";
import {
  resolveAssistantStatePaths,
  writeAssistantStateVersionedJson,
} from "@murphai/runtime-state/node/assistant-state-fs";
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
} from "./helpers/hosted-local-linq-support.js";

const runId = Date.now();
const userId = `member_local_warm_reuse_${runId}`;
const chatId = `chat_local_warm_reuse_${runId}`;
const pendingUserId = `member_local_pending_linq_typing_${runId}`;
const pendingChatId = `chat_local_pending_linq_typing_${runId}`;
const linqWebhookSecret = "linq-local-warm-reuse-secret";
const productionLikeAssistantModel = "gpt-5.5";
const firstUserText = "warm reuse setup input";
const secondUserText = "warm reuse followup input";
const firstReplyText = "Warm reuse setup reply.";
const secondReplyText = "Warm reuse followup reply.";
const pendingInputText = "pending restored Linq input";
const pendingReplyText = "Pending restored Linq reply.";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let scenario: HostedLocalFullStackScenario | null = null;
let linqStub: HostedLocalLinqStub | null = null;
const cleanupPaths: string[] = [];

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

describe("hosted local runner warm reuse e2e", () => {
  beforeAll(async () => {
    await startScenario();
  }, 300_000);

  it("processes consecutive foreground nudges through a warm runner", async () => {
    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    const homePhone = buildLinqHomePhoneNumber(userId);
    const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;
    const typingPath = `/chats/${encodeURIComponent(chatId)}/typing`;

    await requireScenario().seedActiveHostedLinqMember({
      homePhone,
      memberId: userId,
      memberPhone,
    });
    await requireScenario().runWake(buildActivationWake(userId), userId);
    await requireScenario().waitForHostedCompletion(userId);
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId,
      memberId: userId,
      recipientPhone: memberPhone,
    });

    const baselineSendCount = requireLinqStub().countObservedSends(replyPath);
    requireScenario().queueAssistantResponses([firstReplyText], {
      matchInputContains: firstUserText,
    });
    requireScenario().queueAssistantResponses([secondReplyText], {
      matchInputContains: secondUserText,
    });

    const firstWebhookResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, chatId, {
        eventId: `evt_warm_reuse_first_${runId}`,
        messageId: `msg_warm_reuse_first_${runId}`,
        text: firstUserText,
      }),
    );
    expect(firstWebhookResponse.status).toBe(202);

    await requireScenario().waitForLatestPendingWake(userId);
    const firstReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: baselineSendCount,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(firstReply)).toBe(firstReplyText);
    const firstStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(firstStatus.lastErrorCode ?? null).toBeNull();

    const requestCountBeforeSecondReply = requireLinqStub().observedRequests.length;
    const secondWebhookResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, chatId, {
        eventId: `evt_warm_reuse_second_${runId}`,
        messageId: `msg_warm_reuse_second_${runId}`,
        text: secondUserText,
      }),
    );
    expect(secondWebhookResponse.status).toBe(202);

    await requireScenario().waitForLatestPendingWake(userId);
    const secondReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: baselineSendCount + 1,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(secondReply)).toBe(secondReplyText);
    const requestsAfterSecondInbound =
      requireLinqStub().observedRequests.slice(requestCountBeforeSecondReply);
    const secondReplyTypingStarts = requestsAfterSecondInbound.filter((request) =>
      request.method === "POST" && request.url === typingPath
    );
    expect(secondReplyTypingStarts.length).toBeGreaterThanOrEqual(1);
    const secondReplySendIndex = requestsAfterSecondInbound.indexOf(secondReply);
    const secondReplyTypingStartIndex = requestsAfterSecondInbound.indexOf(
      secondReplyTypingStarts[0]!,
    );
    expect(secondReplySendIndex).toBeGreaterThanOrEqual(0);
    expect(secondReplyTypingStartIndex).toBeGreaterThanOrEqual(0);
    expect(secondReplySendIndex).toBeGreaterThan(secondReplyTypingStartIndex);

    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
  }, 600_000);

  it("replies from pending Linq input restored without initial delivery context without typing", async () => {
    const memberPhone = buildLinqRecipientPhoneNumber(pendingUserId);
    const homePhone = buildLinqHomePhoneNumber(pendingUserId);
    const replyPath = `/chats/${encodeURIComponent(pendingChatId)}/messages`;
    const typingPath = `/chats/${encodeURIComponent(pendingChatId)}/typing`;

    await requireScenario().seedActiveHostedLinqMember({
      homePhone,
      memberId: pendingUserId,
      memberPhone,
    });
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId: pendingChatId,
      memberId: pendingUserId,
      recentInboundAt: new Date().toISOString(),
      recipientPhone: memberPhone,
    });
    await seedPendingLinqInputWorkspaceCheckpoint({
      chatId: pendingChatId,
      messageId: `msg_pending_linq_typing_${runId}`,
      text: pendingInputText,
      userId: pendingUserId,
    });

    requireScenario().queueAssistantResponses([pendingReplyText], {
      matchInputContains: pendingInputText,
    });
    const baselineSendCount = requireLinqStub().countObservedSends(replyPath);
    const requestCountBeforeInvocation = requireLinqStub().observedRequests.length;

    const invocationSettledPromise =
      requireScenario().harness.runHostedManualInvocationForTest(pendingUserId)
        .catch(() => undefined);
    const reply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: baselineSendCount,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId: pendingUserId,
    });
    expect(requireLinqStub().readObservedMessageText(reply)).toBe(pendingReplyText);

    const requestsAfterInvocation =
      requireLinqStub().observedRequests.slice(requestCountBeforeInvocation);
    const typingStarts = requestsAfterInvocation.filter((request) =>
      request.method === "POST" && request.url === typingPath
    );
    expect(typingStarts).toHaveLength(0);

    const replySendIndex = requestsAfterInvocation.indexOf(reply);
    expect(replySendIndex).toBeGreaterThanOrEqual(0);

    const providerRequests = requireScenario().assistantProviderRequests
      .filter((request) => request.url === "/v1/responses");
    expect(providerRequests.some((request) => request.body.includes(pendingInputText)))
      .toBe(true);

    await invocationSettledPromise;
  }, 600_000);
});

async function startScenario(): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "15000",
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        [
          buildLinqRecipientPhoneNumber(userId),
          buildLinqRecipientPhoneNumber(pendingUserId),
        ].join(","),
      LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      OPENAI_API_KEY: "stub-local-openai-key",
    },
    assistantProviderStubModelId: productionLikeAssistantModel,
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-warm-reuse-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted runner warm reuse e2e",
    streamLogs: streamDevLogs,
    testControls: true,
  });
}

async function seedPendingLinqInputWorkspaceCheckpoint(input: {
  chatId: string;
  messageId: string;
  text: string;
  userId: string;
}): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "murph-pending-linq-typing-"));
  cleanupPaths.push(root);
  const operatorHomeRoot = path.join(root, "operator-home");
  const vaultRoot = path.join(root, "vault");
  await mkdir(operatorHomeRoot, { recursive: true });

  const now = new Date().toISOString();
  await createIntegratedVaultServices().core.init({
    requestId: `seed-pending-linq-typing-${input.userId}`,
    timezone: "UTC",
    vault: vaultRoot,
  });
  await saveAssistantAutomationState(vaultRoot, {
    autoReply: [{
      channel: "linq",
      eligibleAfter: null,
      enabledAt: now,
    }],
    updatedAt: now,
    version: 1,
  });

  const pendingInput = await upsertAssistantInputEvent({
    event: {
      content: {
        text: input.text,
        transcriptText: input.text,
        userMessageContent: [
          {
            text: input.text,
            type: "text" as const,
          },
        ],
      },
      conversation: {
        accountId: "linq",
        actorId: input.userId,
        actorIsSelf: false,
        source: "linq",
        threadId: input.chatId,
        threadIsDirect: true,
      },
      occurredAt: now,
      receivedAt: now,
      replyTarget: {
        channel: "linq",
        messageId: input.messageId,
        threadId: input.chatId,
      },
      sourceRef: {
        dedupeKey: `dedupe_pending_linq_typing_${input.userId}`,
        eventId: `evt_pending_linq_typing_${input.userId}`,
        itemId: `mailbox_item_pending_linq_typing_${input.userId}`,
        kind: "hosted-mailbox" as const,
        lane: "conversation" as const,
        laneSeq: "1",
        payloadSchema: "murph.hosted-mailbox-payload.v1",
        payloadSource: "inline" as const,
        source: "hosted-mailbox" as const,
        wakeSchema: "murph.hosted-execution-wake.v1",
      },
    },
    vault: vaultRoot,
  });
  await writePendingAssistantInputIndexForTest({
    inputIds: [pendingInput.inputId],
    vaultRoot,
  });

  const snapshot = await snapshotHostedExecutionContext({
    operatorHomeRoot,
    vaultRoot,
  });
  const hash = sha256HostedBundleHex(snapshot.bundle);
  const checkpoint = await seedHostedWorkspaceCheckpointForTest({
    browserVaultReplicaRef: createBrowserVaultReplicaRef({
      sourceBundleHash: hash,
    }),
    environment: requireScenario().runtimeEnv,
    nextWakeAt: new Date(Date.now() - 1_000).toISOString(),
    nextWakeReason: "assistant",
    redactedStatusJson: {
      seededPendingLinqInputForTypingProof: true,
    },
    snapshotRef: createSnapshotBundleRef({
      hash,
      size: snapshot.bundle.byteLength,
    }),
    userId: input.userId,
  });
  expect(checkpoint.status).toBe("updated");

  await uploadHostedSnapshotArtifact({
    bytes: snapshot.bundle,
    hash,
    userId: input.userId,
  });
}

async function writePendingAssistantInputIndexForTest(input: {
  inputIds: readonly string[];
  vaultRoot: string;
}): Promise<void> {
  await writeAssistantStateVersionedJson({
    filePath: path.join(
      resolveAssistantStatePaths(input.vaultRoot).assistantStateRoot,
      "hosted-pending-inputs.json",
    ),
    schema: "murph.hosted-pending-assistant-inputs.v1",
    schemaVersion: 1,
    value: {
      backfilled: true,
      inputIds: [...input.inputIds],
    },
  });
}

async function uploadHostedSnapshotArtifact(input: {
  bytes: Uint8Array;
  hash: string;
  userId: string;
}): Promise<void> {
  await requireScenario().harness.request(
    `/__test/artifacts?userId=${encodeURIComponent(input.userId)}&sha256=${input.hash}`,
    {
      body: new Blob([new Uint8Array(input.bytes)]),
      headers: {
        [HOSTED_EXECUTION_USER_ID_HEADER]: input.userId,
      },
      method: "PUT",
    },
  );
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

function createBrowserVaultReplicaRef(input: {
  sourceBundleHash: string;
}): HostedBrowserVaultReplicaRef {
  return {
    byteLength: 256,
    dataVersion: `pending-linq-typing-${input.sourceBundleHash.slice(0, 16)}`,
    generatedAt: new Date().toISOString(),
    keyId: "browser-vault-replica:pending-linq-typing",
    objectKey: `browser-vault/pending-linq-typing-${input.sourceBundleHash.slice(0, 32)}.json`,
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:pending-linq-typing",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash: input.sourceBundleHash,
  };
}

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
  const body = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signLinqWebhook(linqWebhookSecret, body, timestamp);
  return await fetch(`${requireScenario().harness.webBaseUrl}/api/hosted-onboarding/linq/webhook`, {
    body,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-webhook-signature": signature,
      "x-webhook-timestamp": timestamp,
    },
    method: "POST",
  });
}

function buildActivationWake(userId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${userId}:evt_runner_warm_reuse`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId: userId,
    occurredAt: new Date().toISOString(),
  });
}

function signLinqWebhook(secret: string, payload: string, timestamp: string): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  return `sha256=${signature}`;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local full-stack scenario was not started.");
  }
  return scenario;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local Linq stub was not started.");
  }
  return linqStub;
}
