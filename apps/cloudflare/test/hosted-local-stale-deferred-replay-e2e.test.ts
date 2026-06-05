import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  seedHostedWorkspaceCheckpointForTest,
} from "#hosted-web-testing";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedBrowserVaultReplicaRef,
  type HostedExecutionSnapshotRef,
} from "@murphai/hosted-execution/contracts";
import {
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
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
const userId = `member_local_stale_deferred_${runId}`;
const chatId = `chat_local_stale_deferred_${runId}`;
const linqWebhookSecret = "linq-local-stale-deferred-secret";
const productionLikeAssistantModel = "gpt-5.5";
const replyText = "Reply after stale deferred wake preemption.";

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

describe("hosted local stale deferred invocation recovery", () => {
  beforeAll(async () => {
    await startScenario();
  }, 600_000);

  it(
    "preempts a stale write fence when a Linq message arrives",
    async () => {
      const memberPhone = buildLinqRecipientPhoneNumber(userId);
      const homePhone = buildLinqHomePhoneNumber(userId);
      const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;

      await requireScenario().seedActiveHostedLinqMember({
        homePhone,
        memberId: userId,
        memberPhone,
      });
      await requireScenario().bindActiveHostedLinqHomeChat({
        chatId,
        memberId: userId,
        recipientPhone: memberPhone,
      });
      await seedActivatedWorkspaceCheckpoint();

      const baselineSendCount = requireLinqStub().countObservedSends(replyPath);
      requireScenario().queueAssistantResponses([replyText]);

      const initialStatus = await readHostedRunnerStatusWithLogLimit(100);
      const initialConversationSeq = readConversationMaxSeq(initialStatus);
      const stuckInvocation = await requireScenario().harness.startStuckInvocationForTest(
        userId,
        {
          reason: "manual",
          startedAgoMs: 35_000,
        },
      );
      expect(stuckInvocation.ok).toBe(true);

      const webhookResponse = await postSignedLinqWebhook(
        buildHostedLinqInboundEvent(userId, chatId, {
          eventId: `evt_stale_deferred_${runId}`,
          messageId: `msg_stale_deferred_${runId}`,
          text: "stale deferred turn",
        }),
      );
      expect(webhookResponse.status).toBe(202);

      const conversationSeq = await waitForConversationSeqAbove(
        initialConversationSeq,
        { timeoutMs: 10_000 },
      );

      const importedBeforeLeaseExpiry = await waitForConversationImportAtLeast(
        conversationSeq,
        { timeoutMs: 25_000 },
      );

      if (importedBeforeLeaseExpiry === null) {
        throw new Error(await requireScenario().buildFailureMessage(userId, [
          "Foreground Linq input was appended behind an unexpired stale write fence, but it was not imported before the fence lease expired.",
          `stuck invocation attempt: ${stuckInvocation.attemptId}`,
          `expected conversation seq: ${conversationSeq}`,
          `baseline send count: ${baselineSendCount}`,
        ]));
      }

      const reply = await requireLinqStub().waitForAdditionalSend({
        baselineCount: baselineSendCount,
        expectedPath: replyPath,
        scenario: requireScenario(),
        userId,
      });
      expect(requireLinqStub().readObservedMessageText(reply)).toBe(replyText);
    },
    180_000,
  );
});

async function startScenario(): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "30000",
      HOSTED_EXECUTION_RETRY_DELAY_MS: "1000",
      HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "1000",
      HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "2000",
      HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS: "60000",
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        buildLinqRecipientPhoneNumber(userId),
      LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      OPENAI_API_KEY: "stub-local-openai-key",
    },
    assistantProviderStubModelId: productionLikeAssistantModel,
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-stale-deferred-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted stale deferred invocation e2e",
    streamLogs: streamDevLogs,
  });
}

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signLinqWebhook(linqWebhookSecret, rawBody, timestamp);

  return await fetch(`${requireScenario().harness.webBaseUrl}/api/hosted-onboarding/linq/webhook`, {
    body: rawBody,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-webhook-signature": signature,
      "x-webhook-timestamp": timestamp,
    },
    method: "POST",
  });
}

function signLinqWebhook(secret: string, payload: string, timestamp: string): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  return `sha256=${signature}`;
}

async function seedActivatedWorkspaceCheckpoint(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "murph-stale-deferred-vault-"));
  cleanupPaths.push(root);
  const operatorHomeRoot = path.join(root, "operator-home");
  const vaultRoot = path.join(root, "vault");
  await mkdir(operatorHomeRoot, { recursive: true });

  await createIntegratedVaultServices().core.init({
    requestId: `seed-stale-deferred-${runId}`,
    timezone: "Asia/Kuala_Lumpur",
    vault: vaultRoot,
  });

  const snapshot = await snapshotHostedExecutionContext({
    operatorHomeRoot,
    vaultRoot,
  });
  const hash = sha256HostedBundleHex(snapshot.bundle);
  const checkpoint = await seedHostedWorkspaceCheckpointForTest({
    browserVaultReplicaRef: createBrowserVaultReplicaRef(hash),
    environment: requireScenario().runtimeEnv,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatusJson: {
      seeded: true,
    },
    snapshotRef: createSnapshotBundleRef({
      hash,
      size: snapshot.bundle.byteLength,
    }),
    userId,
  });
  expect(checkpoint.status).toBe("updated");

  await uploadHostedSnapshotArtifact({
    bytes: snapshot.bundle,
    hash,
  });
}

async function uploadHostedSnapshotArtifact(input: {
  bytes: Uint8Array;
  hash: string;
}): Promise<void> {
  await requireScenario().harness.request(
    `/__test/artifacts?userId=${encodeURIComponent(userId)}&sha256=${input.hash}`,
    {
      body: new Blob([new Uint8Array(input.bytes)]),
      headers: {
        [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
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

function createBrowserVaultReplicaRef(
  sourceBundleHash: string,
): HostedBrowserVaultReplicaRef {
  return {
    byteLength: 256,
    dataVersion: `stale-deferred-${sourceBundleHash.slice(0, 16)}`,
    generatedAt: new Date().toISOString(),
    keyId: "browser-vault-replica:stale-deferred",
    objectKey: `browser-vault/${userId}/stale-deferred-replica.json`,
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:stale-deferred",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
  };
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

async function waitForConversationSeqAbove(
  previousSeq: string,
  input: { timeoutMs: number },
): Promise<string> {
  const startedAt = Date.now();
  let lastStatus: HostedRunnerStatusResponse | null = null;

  while (Date.now() - startedAt < input.timeoutMs) {
    const status = await readHostedRunnerStatusWithLogLimit(100);
    lastStatus = status;
    const maxSeq = readConversationMaxSeq(status);
    if (compareSeq(maxSeq, previousSeq) > 0) {
      return maxSeq;
    }
    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    `Timed out waiting for conversation seq above ${previousSeq}.`,
    ...(lastStatus ? [`last status: ${JSON.stringify(lastStatus)}`] : []),
  ]));
}

async function waitForConversationImportAtLeast(
  seq: string,
  input: { timeoutMs: number },
): Promise<HostedRunnerStatusResponse | null> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < input.timeoutMs) {
    const status = await readHostedRunnerStatusWithLogLimit(100);
    const importedSeq = readLatestImportedConversationSeq(status);
    if (importedSeq !== null && compareSeq(importedSeq, seq) >= 0) {
      return status;
    }
    await sleep(250);
  }

  return null;
}

function readConversationMaxSeq(status: HostedRunnerStatusResponse): string {
  const lane = status.mailboxLag.find((entry) => entry.lane === "conversation");
  if (!lane) {
    throw new Error("Status did not include conversation mailbox lag.");
  }
  return lane.maxSeq;
}

function readLatestImportedConversationSeq(
  status: Pick<HostedRunnerStatusResponse, "recentLogs">,
): string | null {
  const logs = status.recentLogs ?? [];
  let latest: string | null = null;

  for (const log of logs) {
    if (log.eventCode !== "mailbox.imported") {
      continue;
    }
    const seq = log.redactedJson?.conversationSeqEnd;
    if (typeof seq !== "string" || seq.trim().length === 0) {
      continue;
    }
    if (latest === null || compareSeq(seq, latest) > 0) {
      latest = seq;
    }
  }

  return latest;
}

function compareSeq(left: string, right: string): number {
  const leftNumber = BigInt(left);
  const rightNumber = BigInt(right);
  if (leftNumber > rightNumber) {
    return 1;
  }
  if (leftNumber < rightNumber) {
    return -1;
  }
  return 0;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local stale deferred scenario was not started.");
  }
  return scenario;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local stale deferred Linq stub was not started.");
  }
  return linqStub;
}
