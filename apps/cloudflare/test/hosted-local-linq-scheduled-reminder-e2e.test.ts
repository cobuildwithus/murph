import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { upsertAutomation } from "@murphai/core";
import type {
  HostedBrowserVaultReplicaRef,
  HostedExecutionSnapshotRef,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  sha256HostedBundleHex,
  snapshotHostedExecutionContext,
} from "@murphai/runtime-state/node";
import {
  seedHostedWorkspaceCheckpointForTest,
  signalHostedManualRunRuntimeForTest,
} from "#hosted-web-testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  buildHostedAssistantNotificationDecisionResponse,
} from "./helpers/hosted-local-e2e-support.js";
import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  type ObservedLinqRequest,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";
const userId = `member_local_linq_scheduled_reminder_${Date.now()}`;
const linqWebhookSecret = "linq-local-scheduled-reminder-secret";
const reminderText = "Time to sleep. Put the phone down and get some rest.";
const scheduledChatId = `chat_local_scheduled_reminder_${Date.now()}`;
const scheduledReminderLeadMs = 180_000;
// Keep Temporal's owner recheck after local runner cold-start/bootstrap, while
// still well before the reminder due time.
const scheduledReminderIdleCheckpointDelayMs = 60_000;
const scheduledReminderMinimumRunwayMs = 45_000;
const scheduledReminderSendWaitMs = 90_000;
const productionLikeAssistantModel = "gpt-5.5";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

const cleanupPaths: string[] = [];
let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

vi.mock("server-only", () => ({}));

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

describe("hosted local Linq scheduled reminder e2e", () => {
  beforeAll(async () => {
    await startScenario();
  }, 600_000);

  it("wakes from the scheduled alarm and sends a due canonical notification reminder", async () => {
    const scheduledReminderTimes = resolveScheduledReminderTimes();
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(userId),
      memberId: userId,
      memberPhone: buildLinqRecipientPhoneNumber(userId),
    });
    const snapshot = await createScheduledReminderSnapshot(scheduledReminderTimes);
    const checkpoint = await seedHostedWorkspaceCheckpointForTest({
      browserVaultReplicaRef: createBrowserVaultReplicaRef(snapshot.hash),
      environment: requireScenario().runtimeEnv,
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatusJson: {
        seeded: true,
      },
      snapshotRef: createSnapshotBundleRef({
        hash: snapshot.hash,
        size: snapshot.bytes.byteLength,
      }),
      userId,
    });
    expect(checkpoint.status).toBe("updated");
    await uploadHostedSnapshotArtifact(snapshot);

    const unscheduledStatus = await requireScenario().harness.readUserStatus(userId);
    expect(unscheduledStatus.workspace?.nextWakeAt ?? null).toBeNull();
    expect(unscheduledStatus.nextAlarmAt ?? null).toBeNull();

    await signalHostedManualRunRuntimeForTest({
      environment: requireScenario().runtimeEnv,
      userId,
    });
    await waitForHostedWorkspaceNextWakeAt({
      expectedNextWakeAt: scheduledReminderTimes.dueAtIso,
      userId,
    });
    assertScheduledReminderRunway(scheduledReminderTimes.dueAtIso);

    requireScenario().queueAssistantResponses([
      buildHostedAssistantNotificationDecisionResponse({
        privateSummary: "deliver sleep reminder",
        text: reminderText,
      }),
    ]);
    await sleepUntil(scheduledReminderTimes.dueAtIso);
    const sendRequest = await waitForScheduledReminderSendWithoutNudge({
      expectedPath: `/chats/${encodeURIComponent(scheduledChatId)}/messages`,
      timeoutMs: scheduledReminderSendWaitMs,
      userId,
    });
    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    const finalNextWakeAt = finalStatus.workspace?.nextWakeAt;
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    expect(finalNextWakeAt ?? null).toBeNull();
    // recentLogs is bounded; assert the durable reminder send plus terminal scan/delivery signals.
    expect(finalStatus.recentLogs ?? []).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventCode: "outbox.delivery_finished",
        redactedJson: expect.objectContaining({
          failed: 0,
          sent: 1,
        }),
      }),
      expect.objectContaining({
        eventCode: "assistant.automation_detail",
        redactedJson: expect.objectContaining({
          failureReason: "due",
          safeDetails: "due",
          type: "cron.scan.job",
        }),
      }),
    ]));

    expect(sendRequest.method).toBe("POST");
    expect(requireLinqStub().readObservedMessageText(sendRequest)).toBe(reminderText);
  }, 480_000);
});

async function startScenario(): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: String(scheduledReminderIdleCheckpointDelayMs),
      LINQ_API_BASE_URL: requireLinqStub().baseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      OPENAI_API_KEY: "stub-local-openai-key",
    },
    assistantProviderStubModelId: productionLikeAssistantModel,
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-linq-scheduled-reminder-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted Linq scheduled reminder e2e",
    streamLogs: streamDevLogs,
  });
}

async function createScheduledReminderSnapshot(scheduledReminderTimes: {
  createdAtIso: string;
  dueAtIso: string;
}): Promise<{
  bytes: Uint8Array;
  hash: string;
}> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-scheduled-reminder-"));
  const operatorHomeRoot = `${vaultRoot}-operator-home`;
  cleanupPaths.push(vaultRoot, operatorHomeRoot);
  await writeSyntheticVaultMetadata(vaultRoot, scheduledReminderTimes);
  await upsertAutomation({
    automationId: "automation_01JX8VBQY2M5ZBV64ZP4N1DRBB",
    continuityPolicy: "preserve",
    instructions: "Send the user a short reminder to go to sleep.",
    now: new Date(scheduledReminderTimes.createdAtIso),
    route: {
      channel: "linq",
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      threadId: scheduledChatId,
    },
    schedule: {
      kind: "at",
      at: scheduledReminderTimes.dueAtIso,
    },
    slug: "one-shot-sleep-reminder",
    status: "active",
    summary: "One-shot sleep reminder.",
    tags: ["assistant", "scheduled"],
    title: "Sleep reminder",
    vaultRoot,
  });

  const snapshot = await snapshotHostedExecutionContext({
    operatorHomeRoot,
    vaultRoot,
  });

  return {
    bytes: snapshot.bundle,
    hash: sha256HostedBundleHex(snapshot.bundle),
  };
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

async function waitForHostedWorkspaceNextWakeAt(input: {
  expectedNextWakeAt: string;
  userId: string;
}): Promise<void> {
  const startedAt = Date.now();
  let latestNextWakeAt: string | null = null;
  let latestNextAlarmAt: string | null = null;
  let latestError: string | null = null;

  while ((Date.now() - startedAt) < 120_000) {
    try {
      const status = await requireScenario().harness.readUserStatus(input.userId);
      latestNextWakeAt = status.workspace?.nextWakeAt ?? null;
      latestNextAlarmAt = status.nextAlarmAt ?? null;
      if (latestNextWakeAt === input.expectedNextWakeAt) {
        return;
      }
    } catch (error) {
      latestError = error instanceof Error ? error.message : String(error);
    }

    await sleep(1_000);
  }

  throw new Error(await requireScenario().buildFailureMessage(input.userId, [
    "Timed out waiting for the hosted workspace to checkpoint the scheduled reminder wake.",
    `expectedNextWakeAt: ${input.expectedNextWakeAt}`,
    `latestNextWakeAt: ${latestNextWakeAt ?? "null"}`,
    `latestNextAlarmAt: ${latestNextAlarmAt ?? "null"}`,
    latestError ? `latest status read error: ${latestError}` : null,
  ].filter((line): line is string => Boolean(line))));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepUntil(dueAtIso: string): Promise<void> {
  const dueAtMs = Date.parse(dueAtIso);
  if (!Number.isFinite(dueAtMs)) {
    throw new Error(`Invalid scheduled reminder due timestamp: ${dueAtIso}`);
  }

  const delayMs = dueAtMs - Date.now() + 750;
  if (delayMs > 0) {
    await sleep(delayMs);
  }
}

function assertScheduledReminderRunway(dueAtIso: string): void {
  const dueAtMs = Date.parse(dueAtIso);
  if (!Number.isFinite(dueAtMs)) {
    throw new Error(`Invalid scheduled reminder due timestamp: ${dueAtIso}`);
  }

  const remainingMs = dueAtMs - Date.now();
  if (remainingMs < scheduledReminderMinimumRunwayMs) {
    throw new Error([
      "Scheduled reminder E2E reached Temporal scheduling too close to due time.",
      `remainingMs: ${remainingMs}`,
      `minimumRunwayMs: ${scheduledReminderMinimumRunwayMs}`,
      `dueAtIso: ${dueAtIso}`,
    ].join("\n"));
  }
}

async function waitForScheduledReminderSendWithoutNudge(input: {
  expectedPath: string;
  timeoutMs: number;
  userId: string;
}): Promise<ObservedLinqRequest> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < input.timeoutMs) {
    const matchingRequest = requireLinqStub().observedRequests.find((request) =>
      request.method === "POST" && request.url === input.expectedPath
    );
    if (matchingRequest) return matchingRequest;

    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(input.userId, [
    "Timed out waiting for the scheduled Linq reminder send without runner nudges.",
    `expected path: ${input.expectedPath}`,
    `observed requests: ${JSON.stringify(summarizeObservedLinqRequests())}`,
  ]));
}

function summarizeObservedLinqRequests(): Array<{ method: string; url: string }> {
  return requireLinqStub().observedRequests.slice(-20).map((request) => ({
    method: request.method,
    url: request.url,
  }));
}

async function writeSyntheticVaultMetadata(
  vaultRoot: string,
  scheduledReminderTimes: {
    createdAtIso: string;
  },
): Promise<void> {
  await mkdir(vaultRoot, { recursive: true });
  await writeFile(
    path.join(vaultRoot, "vault.json"),
    `${JSON.stringify({
      createdAt: scheduledReminderTimes.createdAtIso,
      formatVersion: 1,
      timezone: "Asia/Kuala_Lumpur",
      title: "Synthetic Scheduled Reminder Vault",
      vaultId: "vault_01JX8VBQY2M5ZBV64ZP4N1DRBD",
    }, null, 2)}\n`,
    "utf8",
  );
}

function resolveScheduledReminderTimes(now = new Date()): {
  createdAtIso: string;
  dueAtIso: string;
} {
  const dueAtMs = now.getTime() + scheduledReminderLeadMs;
  return {
    createdAtIso: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    dueAtIso: new Date(dueAtMs).toISOString(),
  };
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
    dataVersion: `scheduled-reminder-${sourceBundleHash.slice(0, 16)}`,
    generatedAt: new Date().toISOString(),
    keyId: "browser-vault-replica:scheduled-reminder",
    objectKey: `browser-vault/${userId}/scheduled-reminder-replica.json`,
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:scheduled-reminder",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
  };
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local Linq stub was not initialized.");
  }

  return linqStub;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local full-stack scenario was not initialized.");
  }

  return scenario;
}
