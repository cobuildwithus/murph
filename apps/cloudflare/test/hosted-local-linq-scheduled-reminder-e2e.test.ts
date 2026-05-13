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
import type {
  HostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/runtime-control";
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
const scheduledReminderTimes = resolveScheduledReminderTimes();
const productionLikeAssistantModel = "gpt-5.5";
const hostedLocalWorkerRestartBody = "Your worker restarted mid-request.";
const hostedLocalWorkerRestartMaxRetries = 4;

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

describe("hosted local Linq scheduled reminder e2e", () => {
  beforeAll(async () => {
    await startScenario();
  }, 600_000);

  it("sends a due canonical midnight reminder with missing runtime state", async () => {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(userId),
      memberId: userId,
      memberPhone: buildLinqRecipientPhoneNumber(userId),
    });
    const snapshot = await createScheduledReminderSnapshot();
    const checkpoint = await seedHostedWorkspaceCheckpointForTest({
      browserVaultReplicaRef: createBrowserVaultReplicaRef(snapshot.hash),
      environment: requireScenario().runtimeEnv,
      nextWakeAt: scheduledReminderTimes.dueAtIso,
      nextWakeReason: "assistant",
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

    requireScenario().queueAssistantResponses([
      buildHostedAssistantNotificationDecisionResponse({
        privateSummary: "deliver sleep reminder",
        text: reminderText,
      }),
    ]);
    const workerStartedAt = new Date();
    await runHostedWorkerUntilIdle();
    const workerCompletedAt = new Date();

    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    const finalNextWakeAt = finalStatus.workspace?.nextWakeAt;
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    expect(finalNextWakeAt).toBeDefined();
    expect(resolvePossibleNextKualaLumpurMidnightsForWindow({
      end: workerCompletedAt,
      start: workerStartedAt,
    })).toContain(finalNextWakeAt);
    expect(finalNextWakeAt).toSatisfy(isKualaLumpurMidnight);
    expect(finalStatus.recentLogs ?? []).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventCode: "assistant.automation_detail",
        redactedJson: expect.objectContaining({
          safeDetails: "cron_job_enqueue_succeeded",
          type: "cron.job.completed",
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

    const sendRequest = await requireLinqStub().waitForSend({
      expectedPath: `/chats/${encodeURIComponent(scheduledChatId)}/messages`,
      scenario: requireScenario(),
      userId,
    });
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

async function createScheduledReminderSnapshot(): Promise<{
  bytes: Uint8Array;
  hash: string;
}> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-scheduled-reminder-"));
  const operatorHomeRoot = `${vaultRoot}-operator-home`;
  cleanupPaths.push(vaultRoot, operatorHomeRoot);
  await writeSyntheticVaultMetadata(vaultRoot);
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
      kind: "dailyLocal",
      localTime: "00:00",
    },
    slug: "midnight-sleep-reminder",
    status: "active",
    summary: "Daily sleep reminder at midnight in the vault timezone.",
    tags: ["assistant", "scheduled"],
    title: "Midnight sleep reminder",
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

async function runHostedWorkerUntilIdle(): Promise<HostedWorkspaceInvocationResult> {
  for (let attempt = 0; attempt <= hostedLocalWorkerRestartMaxRetries; attempt += 1) {
    try {
      return await requireScenario().harness.requestJson<HostedWorkspaceInvocationResult>(
        `/__test/users/${encodeURIComponent(userId)}/run-until-idle`,
        {
          headers: {
            [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
          },
          method: "POST",
        },
      );
    } catch (error) {
      if (!isHostedLocalWorkerRestartError(error) || attempt >= hostedLocalWorkerRestartMaxRetries) {
        throw error;
      }

      await sleep(250 * (attempt + 1));
    }
  }

  throw new Error("Hosted local worker restart retry loop exhausted.");
}

function isHostedLocalWorkerRestartError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(hostedLocalWorkerRestartBody);
}

function isKualaLumpurMidnight(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const nextWake = new Date(value);
  if (Number.isNaN(nextWake.getTime())) {
    return false;
  }

  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(nextWake) === "00:00:00";
}

function resolvePossibleNextKualaLumpurMidnightsForWindow(input: {
  end: Date;
  start: Date;
}): string[] {
  return Array.from(new Set([
    resolveNextKualaLumpurMidnightAfter(input.start),
    resolveNextKualaLumpurMidnightAfter(input.end),
  ]));
}

function resolveNextKualaLumpurMidnightAfter(now: Date): string {
  const dayMs = 24 * 60 * 60 * 1000;
  const kualaLumpurOffsetMs = 8 * 60 * 60 * 1000;
  const currentKualaLumpurMidnightUtcMs =
    Math.floor((now.getTime() + kualaLumpurOffsetMs) / dayMs) * dayMs
    - kualaLumpurOffsetMs;
  return new Date(currentKualaLumpurMidnightUtcMs + dayMs).toISOString();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeSyntheticVaultMetadata(vaultRoot: string): Promise<void> {
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
  const dayMs = 24 * 60 * 60 * 1000;
  const kualaLumpurOffsetMs = 8 * 60 * 60 * 1000;
  const currentKualaLumpurMidnightUtcMs =
    Math.floor((now.getTime() + kualaLumpurOffsetMs) / dayMs) * dayMs
    - kualaLumpurOffsetMs;
  const dueAtMs = currentKualaLumpurMidnightUtcMs < now.getTime()
    ? currentKualaLumpurMidnightUtcMs
    : currentKualaLumpurMidnightUtcMs - dayMs;
  return {
    createdAtIso: new Date(dueAtMs - 2 * 60 * 60 * 1000).toISOString(),
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
