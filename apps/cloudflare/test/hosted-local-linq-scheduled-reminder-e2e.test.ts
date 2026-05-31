import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

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
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  buildHostedAssistantNotificationDecisionResponse,
} from "./helpers/hosted-local-e2e-support.js";
import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildHostedLinqInboundEvent,
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  type ObservedLinqRequest,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";
const userId = `member_local_linq_scheduled_reminder_${Date.now()}`;
const linqWebhookSecret = "linq-local-scheduled-reminder-secret";
const reminderText = "Time to sleep. Put the phone down and get some rest.";
const setupReplyText = "Done - I will remind you here in about seven minutes.";
const setupRequestText = "Remind me here in about seven minutes to go to sleep.";
const scheduledChatId = `chat_local_scheduled_reminder_${Date.now()}`;
const scheduledReminderLeadMs = 420_000;
// Keep Temporal's owner recheck after local runner cold-start/bootstrap, while
// still well before the reminder due time.
const scheduledReminderIdleCheckpointDelayMs = 60_000;
const scheduledReminderMinimumRunwayMs = 45_000;
const scheduledReminderSendWaitMs = 120_000;
const productionLikeAssistantModel = "gpt-5.5";
const execFileAsync = promisify(execFile);

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

  it("creates a reminder from the hosted assistant turn, wakes from the scheduled alarm, and sends it", async () => {
    const scheduledReminderTimes = resolveScheduledReminderTimes();
    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(userId),
      memberId: userId,
      memberPhone,
    });
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId: scheduledChatId,
      memberId: userId,
      recipientPhone: memberPhone,
    });
    const snapshot = await createEmptyReminderSnapshot();
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

    const reminderPath = `/chats/${encodeURIComponent(scheduledChatId)}/messages`;
    const setupReplyBaselineCount = requireLinqStub().countObservedSends(reminderPath);
    requireScenario().queueAssistantResponses([
      buildHostedAssistantAutomationSaveDirectiveResponse({
        dueAtIso: scheduledReminderTimes.dueAtIso,
        text: setupReplyText,
      }),
    ]);
    const webhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      scheduledChatId,
      {
        eventId: `evt_scheduled_reminder_setup_${userId}`,
        messageId: `msg_scheduled_reminder_setup_${userId}`,
        text: setupRequestText,
      },
    ));
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    await requireScenario().waitForLatestPendingWake(userId);
    const setupReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: setupReplyBaselineCount,
      expectedPath: reminderPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(setupReply)).toBe(setupReplyText);
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
    const reminderSendBaselineCount = requireLinqStub().countObservedSends(reminderPath);
    await sleepUntil(scheduledReminderTimes.dueAtIso);
    const sendRequest = await waitForScheduledReminderSendWithoutNudge({
      baselineCount: reminderSendBaselineCount,
      expectedPath: reminderPath,
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
  }, 720_000);
});

async function startScenario(): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: String(scheduledReminderIdleCheckpointDelayMs),
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        buildLinqRecipientPhoneNumber(userId),
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

async function createEmptyReminderSnapshot(): Promise<{
  bytes: Uint8Array;
  hash: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "murph-hosted-reminder-turn-"));
  const operatorHomeRoot = path.join(root, "operator-home");
  const vaultRoot = path.join(root, "vault");
  cleanupPaths.push(root);
  await mkdir(operatorHomeRoot, { recursive: true });
  await initializeSyntheticVault(vaultRoot);

  const snapshot = await snapshotHostedExecutionContext({
    operatorHomeRoot,
    vaultRoot,
  });

  return {
    bytes: snapshot.bundle,
    hash: sha256HostedBundleHex(snapshot.bundle),
  };
}

async function initializeSyntheticVault(
  vaultRoot: string,
): Promise<void> {
  try {
    await execFileAsync("pnpm", [
      "exec",
      "vault-cli",
      "init",
      "--vault",
      vaultRoot,
      "--request-id",
      "hosted-local-reminder-turn-seed",
      "--timezone",
      "Asia/Kuala_Lumpur",
    ], {
      env: process.env,
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
    });
  } catch (error) {
    throw new Error(
      [
        "Failed to initialize the hosted reminder E2E vault.",
        redactSyntheticVaultCliOutput(readExecFileErrorField(error, "stderr"), vaultRoot),
        redactSyntheticVaultCliOutput(readExecFileErrorField(error, "stdout"), vaultRoot),
      ].filter(Boolean).join("\n"),
    );
  }
}

function readExecFileErrorField(error: unknown, field: "stderr" | "stdout"): string {
  if (!error || typeof error !== "object" || !(field in error)) {
    return "";
  }
  const value = (error as Record<typeof field, unknown>)[field];
  return typeof value === "string" ? value : "";
}

function redactSyntheticVaultCliOutput(value: string, vaultRoot: string): string {
  return value
    .split(vaultRoot).join("<vault-root>")
    .split(process.cwd()).join("<repo-root>")
    .slice(-2000);
}

function buildHostedAssistantAutomationSaveDirectiveResponse(input: {
  dueAtIso: string;
  text: string;
}): string {
  return JSON.stringify({
    __murphE2eVaultCliCommands: [
      {
        args: [
          "automation",
          "save",
          "Sleep reminder",
          "--request-id",
          `hosted-local-reminder-${userId}`,
          "--instructions",
          "Send the user a short reminder to go to sleep.",
          "--summary",
          "One-shot sleep reminder.",
          "--tags",
          "assistant",
          "--tags",
          "scheduled",
          "--continuity-policy",
          "preserve",
          "--schedule-kind",
          "at",
          "--schedule-at",
          input.dueAtIso,
          "--channel",
          "linq",
          "--thread-id",
          scheduledChatId,
        ],
      },
    ],
    text: input.text,
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

async function waitForHostedWorkspaceNextWakeAt(input: {
  expectedNextWakeAt: string;
  userId: string;
}): Promise<void> {
  const startedAt = Date.now();
  let latestNextWakeAt: string | null = null;
  let latestNextAlarmAt: string | null = null;
  let latestError: string | null = null;

  while ((Date.now() - startedAt) < 120_000) {
    let status: Awaited<ReturnType<HostedLocalFullStackScenario["harness"]["readUserStatus"]>>;
    try {
      status = await requireScenario().harness.readUserStatus(input.userId);
    } catch (error) {
      latestError = error instanceof Error ? error.message : String(error);
      await sleep(1_000);
      continue;
    }

    if (status.lastErrorCode) {
      throw new Error(await requireScenario().buildFailureMessage(input.userId, [
        "Hosted runner reported an error before checkpointing the scheduled reminder wake.",
        `lastErrorCode: ${status.lastErrorCode}`,
      ]));
    }

    latestNextWakeAt = status.workspace?.nextWakeAt ?? null;
    latestNextAlarmAt = status.nextAlarmAt ?? null;
    if (latestNextWakeAt === input.expectedNextWakeAt) {
      return;
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
  baselineCount: number;
  expectedPath: string;
  timeoutMs: number;
  userId: string;
}): Promise<ObservedLinqRequest> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < input.timeoutMs) {
    const matchingRequests = requireLinqStub().observedRequests.filter((request) =>
      request.method === "POST" && request.url === input.expectedPath
    );
    if (matchingRequests.length > input.baselineCount) {
      return matchingRequests.at(-1)!;
    }

    await sleep(250);
  }

  throw new Error(await requireScenario().buildFailureMessage(input.userId, [
    "Timed out waiting for the scheduled Linq reminder send without runner nudges.",
    `expected path: ${input.expectedPath}`,
    `baseline count: ${input.baselineCount}`,
    `observed requests: ${JSON.stringify(summarizeObservedLinqRequests())}`,
  ]));
}

function summarizeObservedLinqRequests(): Array<{ method: string; url: string }> {
  return requireLinqStub().observedRequests.slice(-20).map((request) => ({
    method: request.method,
    url: request.url,
  }));
}

function resolveScheduledReminderTimes(now = new Date()): {
  dueAtIso: string;
} {
  const dueAtMs = now.getTime() + scheduledReminderLeadMs;
  return {
    dueAtIso: new Date(dueAtMs).toISOString(),
  };
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
