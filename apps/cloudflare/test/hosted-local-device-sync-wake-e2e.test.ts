import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHostedExecutionDeviceSyncWake,
} from "@murphai/hosted-execution";

import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";

const runId = Date.now();
const userId = `member_local_device_sync_wake_${runId}`;
const connectionId = `dsc_local_device_sync_wake_${runId}`;
const productionLikeAssistantModel = "gpt-5.6-terra";
const deviceSyncPublicBaseUrl = "https://device-sync.example.test/api/device-sync";
const whoopBaseUrl = "https://whoop-oauth.example.test";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let scenario: HostedLocalFullStackScenario | null = null;

describe("hosted local device-sync wake e2e", () => {
  beforeAll(async () => {
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        DEVICE_SYNC_PUBLIC_BASE_URL: deviceSyncPublicBaseUrl,
        DEVICE_SYNC_SECRET: "synthetic-device-sync-runtime-secret",
        HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        OPENAI_API_KEY: "stub-local-openai-key",
        WHOOP_BASE_URL: whoopBaseUrl,
        WHOOP_CLIENT_ID: "synthetic-whoop-client",
        WHOOP_CLIENT_SECRET: "synthetic-whoop-secret",
      },
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-device-sync-wake-",
      requiredRunnerEnvProfile: "assistant",
      scenarioLabel: "Local hosted device-sync wake e2e",
      streamLogs: streamDevLogs,
    });
  }, 600_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
  }, 120_000);

  it("runs a device-sync system wake without a child startup workspace-read 404", async () => {
    await requireScenario().seedActiveHostedMember({ memberId: userId });
    await requireScenario().runWake(buildDeviceSyncWake(), userId);

    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    if (finalStatus.lastErrorCode ?? null) {
      throw new Error(await requireScenario().buildFailureMessage(userId, [
        "Hosted runner recorded an error during the natural device-sync wake.",
        `final status: ${JSON.stringify(finalStatus)}`,
      ]));
    }

    const logs = readStructuredLogs();
    const workspaceRead404 = logs.find((record) => {
      const details = readDetails(record);
      return record.message === "Hosted runtime control-plane response returned non-OK."
        && details.description === "Hosted workspace read"
        && details.responseStatus === 404;
    });
    const containerFailure = logs.find((record) =>
      record.message === "Hosted execution container failed."
      && record.userId === userId
    );
    const workspaceReadForwards = logs.filter((record) => {
      const details = readDetails(record);
      return record.message === "Hosted runner web-control request forwarding."
        && details.operation === "workspace_read";
    });
    const runnerWorkspaceRead = logs.find((record) => {
      const details = readDetails(record);
      return record.message === "Hosted runner workspace read completed."
        && record.userId === userId
        && details.workspacePresent === true;
    });

    expect(workspaceRead404).toBeUndefined();
    expect(containerFailure).toBeUndefined();
    expect(workspaceReadForwards).toHaveLength(1);
    expect(runnerWorkspaceRead).toBeDefined();
  }, 300_000);
});

function buildDeviceSyncWake() {
  const occurredAt = new Date().toISOString();
  return buildHostedExecutionDeviceSyncWake({
    connectionId,
    eventId: `device-sync:reconcile-due:${userId}:${connectionId}:${runId}`,
    hint: {
      jobs: [
        {
          dedupeKey: `local-device-sync-reconcile:${runId}`,
          kind: "reconcile",
          priority: 80,
        },
      ],
      nextReconcileAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      reason: "scheduled-reconcile",
    },
    occurredAt,
    provider: "whoop",
    reason: "reconcile_due",
    userId,
  });
}

function readStructuredLogs(): Record<string, unknown>[] {
  const output = [
    requireScenario().harness.stdoutTail(2_000_000),
    requireScenario().harness.stderrTail(2_000_000),
  ].join("\n");
  const records: Record<string, unknown>[] = [];

  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (isRecord(parsed)) {
      records.push(parsed);
    }
  }

  return records;
}

function readDetails(record: Record<string, unknown>): Record<string, unknown> {
  return isRecord(record.details) ? record.details : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local full-stack scenario was not initialized.");
  }

  return scenario;
}
