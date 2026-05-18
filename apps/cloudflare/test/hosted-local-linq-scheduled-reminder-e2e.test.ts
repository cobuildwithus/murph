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
} from "#hosted-web-testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";
const userId = `member_local_linq_scheduled_reminder_${Date.now()}`;
const linqWebhookSecret = "linq-local-scheduled-reminder-secret";
const reminderText = "Time to sleep. Put the phone down and get some rest.";
const scheduledChatId = `chat_local_scheduled_reminder_${Date.now()}`;
const scheduledReminderLeadMs = 90_000;
const productionLikeAssistantModel = "gpt-5.5";
const hostedLocalWorkerRestartBody = "Your worker restarted mid-request.";
const hostedLocalWorkerRestartMaxRetries = 4;

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

const cleanupPaths: string[] = [];
let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

type HostedUserStatus =
  Awaited<ReturnType<HostedLocalFullStackScenario["harness"]["readUserStatus"]>>;

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

    const schedulingResult = await requireScenario().harness.runHostedManualInvocationForTest(userId);
    expect(schedulingResult.status).toBe("scheduled");

    const scheduledStatus = await waitForScheduledAlarmAt(scheduledReminderTimes.dueAtIso);
    expect(scheduledStatus.lastErrorCode ?? null).toBeNull();
    expect(scheduledStatus.workspace?.nextWakeAt ?? null).toBeNull();
    expect(scheduledStatus.nextAlarmAt).toBe(scheduledReminderTimes.dueAtIso);
    expect(scheduledStatus.recentLogs ?? []).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventCode: "assistant.automation_detail",
        redactedJson: expect.objectContaining({
          failureReason: "not_due",
          safeDetails: "not_due",
          type: "cron.scan.job",
        }),
      }),
    ]));

    await sleepUntil(scheduledReminderTimes.dueAtIso);
    requireScenario().queueAssistantResponses([
      buildHostedAssistantNotificationDecisionResponse({
        privateSummary: "deliver sleep reminder",
        text: reminderText,
      }),
    ]);
    await runHostedScheduledAlarm();
    const sendRequest = await requireLinqStub().waitForSend({
      expectedPath: `/chats/${encodeURIComponent(scheduledChatId)}/messages`,
      scenario: requireScenario(),
      userId,
    });
    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    const finalNextWakeAt = finalStatus.workspace?.nextWakeAt;
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    expect(finalNextWakeAt ?? null).toBeNull();
    expect(finalStatus.recentLogs ?? []).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventCode: "assistant.automation_detail",
        redactedJson: expect.objectContaining({
          safeDetails: "cron_job_enqueue_succeeded",
          type: "cron.job.completed",
        }),
      }),
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
          failureRuntimeStatePresent: false,
          failureReason: "due",
          safeDetails: "due",
          type: "cron.scan.job",
        }),
      }),
    ]));

    expect(sendRequest.method).toBe("POST");
    expect(requireLinqStub().readObservedMessageText(sendRequest)).toBe(reminderText);
  }, 300_000);
});

async function startScenario(): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
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

async function runHostedScheduledAlarm(): Promise<void> {
  for (let attempt = 0; attempt <= hostedLocalWorkerRestartMaxRetries; attempt += 1) {
    try {
      await requireScenario().harness.runHostedAlarmForTest(userId);
      return;
    } catch (error) {
      if (!isHostedLocalWorkerRestartError(error) || attempt >= hostedLocalWorkerRestartMaxRetries) {
        throw error;
      }

      await sleep(250 * (attempt + 1));
    }
  }

  throw new Error("Hosted local worker restart retry loop exhausted.");
}

async function waitForScheduledAlarmAt(expectedNextAlarmAt: string): Promise<HostedUserStatus> {
  const startedAt = Date.now();
  let lastStatus: HostedUserStatus | null = null;

  while ((Date.now() - startedAt) < 10_000) {
    const status = await requireScenario().harness.readUserStatus(userId);
    lastStatus = status;

    if (status.lastErrorCode) {
      throw new Error(`Hosted runner errored before scheduling reminder alarm: ${status.lastErrorCode}`);
    }

    if (status.nextAlarmAt === expectedNextAlarmAt) {
      return status;
    }

    await sleep(250);
  }

  throw new Error(JSON.stringify({
    expectedNextAlarmAt,
    lastErrorCode: lastStatus?.lastErrorCode ?? null,
    lastNextAlarmAt: lastStatus?.nextAlarmAt ?? null,
  }));
}

function isHostedLocalWorkerRestartError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(hostedLocalWorkerRestartBody);
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
