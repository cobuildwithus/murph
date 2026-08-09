import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
} from "@murphai/hosted-execution/orchestration-control";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  queryHostedRuntimeWorkflowForTest,
  seedHostedWorkspaceInboxMediaRetentionWakeForTest,
  signalHostedMailboxAppendRuntimeForTest,
  signalHostedManualRunRuntimeForTest,
  signalHostedRetentionRuntimeRecheckForTest,
  updateHostedMemberBillingStatusForTest,
} from "#hosted-web-testing";

vi.mock("server-only", () => ({}));

const runUserId = `member_local_temporal_orchestration_${Date.now()}`;
const mailboxWorkspaceUserId =
  `member_local_temporal_mailbox_workspace_${Date.now()}`;
const pausedRetentionUserId =
  `member_local_temporal_paused_retention_${Date.now()}`;

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let scenario: HostedLocalFullStackScenario | null = null;

describe("hosted local Temporal orchestration e2e", () => {
  beforeAll(async () => {
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      },
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-temporal-orchestration-",
      requiredRunnerEnvProfile: "assistant",
      scenarioLabel: "Local hosted Temporal orchestration e2e",
      streamLogs: streamDevLogs,
    });
  }, 600_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
  }, 120_000);

  it("signals through local Temporal and reaches Cloudflare ensure-processing", async () => {
    const activeScenario = requireScenario();
    expect(activeScenario.harness.runtimeEnv.HOSTED_TEMPORAL_ADDRESS).toBeTruthy();
    expect(activeScenario.harness.runtimeEnv.TEMPORAL_ADDRESS).toBeTruthy();

    await activeScenario.seedActiveHostedMember({ memberId: runUserId });
    await activeScenario.runWake(
      buildActivationWake(runUserId, "manual"),
      runUserId,
    );
    await activeScenario.waitForHostedCompletion(runUserId);

    const signal = await signalHostedManualRunRuntimeForTest({
      environment: activeScenario.runtimeEnv,
      userId: runUserId,
    });

    const workflowState = await waitForWorkflowExecutionState({
      env: activeScenario.runtimeEnv,
      workflowId: signal.workflowId,
    });
    expect(workflowState.userId).toBe(runUserId);
    expect(workflowState.lastExecutionAt).not.toBeNull();
    expect(workflowState.lastExecutionErrorCode).toBeNull();
    expect(workflowState.lastExecutionKind).toMatch(/runtime_/u);

    const finalStatus = await activeScenario.waitForHostedCompletion(runUserId);
    expect(finalStatus.workspace).not.toBeNull();
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
  }, 300_000);

  it("creates workspace before a mailbox append signal starts the workflow", async () => {
    const activeScenario = requireScenario();

    await activeScenario.seedActiveHostedMember({
      memberId: mailboxWorkspaceUserId,
    });
    await expect(
      activeScenario.harness.readUserStatus(mailboxWorkspaceUserId),
    ).resolves.toMatchObject({
      workspace: null,
    });

    const append = await activeScenario.enqueueWake(
      buildActivationWake(mailboxWorkspaceUserId, "mailbox-workspace"),
      mailboxWorkspaceUserId,
    );
    const signal = await signalHostedMailboxAppendRuntimeForTest({
      environment: activeScenario.runtimeEnv,
      expectedUserId: mailboxWorkspaceUserId,
      mailboxItemId: append.wake.id,
    });

    const workflowState = await waitForWorkflowExecutionState({
      env: activeScenario.runtimeEnv,
      workflowId: signal.workflowId,
    });
    expect(workflowState.userId).toBe(mailboxWorkspaceUserId);
    expect(workflowState.lastExecutionAt).not.toBeNull();
    expect(workflowState.lastExecutionErrorCode).toBeNull();

    const finalStatus = await activeScenario.waitForHostedCompletion(
      mailboxWorkspaceUserId,
    );
    expect(finalStatus.workspace).not.toBeNull();
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
  }, 300_000);

  it("runs due retention for a paused member without assistant provider work", async () => {
    const activeScenario = requireScenario();

    await activeScenario.seedActiveHostedMember({
      memberId: pausedRetentionUserId,
    });
    await activeScenario.runWake(
      buildActivationWake(pausedRetentionUserId, "paused-retention"),
      pausedRetentionUserId,
    );
    await activeScenario.waitForHostedCompletion(pausedRetentionUserId);
    const providerRequestBaseline = activeScenario.assistantProviderRequests.length;

    await updateHostedMemberBillingStatusForTest({
      billingStatus: "paused",
      environment: activeScenario.runtimeEnv,
      memberId: pausedRetentionUserId,
    });
    await seedHostedWorkspaceInboxMediaRetentionWakeForTest({
      environment: activeScenario.runtimeEnv,
      userId: pausedRetentionUserId,
      wakeAt: new Date(Date.now() - 60_000),
    });

    const retentionSignalStartedAt = new Date();
    const signal = await signalHostedRetentionRuntimeRecheckForTest({
      environment: activeScenario.runtimeEnv,
      userId: pausedRetentionUserId,
    });
    const workflowState = await waitForWorkflowExecutionState({
      env: activeScenario.runtimeEnv,
      executionNotBefore: retentionSignalStartedAt,
      workflowId: signal.workflowId,
    });
    expect(workflowState.lastExecutionErrorCode).toBeNull();
    expect(workflowState.lastExecutionKind).toMatch(/runtime_/u);
    expect(workflowState.lastReconciliationBlockedReason).toBe("user_not_active");

    const finalStatus = await activeScenario.waitForHostedCompletion(
      pausedRetentionUserId,
    );
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.workspace?.inboxMediaRetentionWakeAt ?? null).toBeNull();
    expect(activeScenario.assistantProviderRequests).toHaveLength(
      providerRequestBaseline,
    );
  }, 300_000);
});

async function waitForWorkflowExecutionState(input: {
  env: NodeJS.ProcessEnv;
  executionNotBefore?: Date;
  workflowId: string;
}): Promise<ObservedHostedRuntimeWorkflowState> {
  const deadline = Date.now() + 180_000;
  let latestState: ObservedHostedRuntimeWorkflowState | null = null;
  let latestError: string | null = null;

  while (Date.now() < deadline) {
    try {
      latestState = readObservedHostedRuntimeWorkflowState(
        await queryHostedRuntimeWorkflowForTest({
          environment: input.env,
          queryName: HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
          workflowId: input.workflowId,
        }),
      );
      if (
        latestState.lastExecutionKind !== null
        && isExecutionAtOrAfter(latestState.lastExecutionAt, input.executionNotBefore)
      ) {
        return latestState;
      }
    } catch (error) {
      latestError = error instanceof Error ? error.message : String(error);
    }

    await sleep(1_000);
  }

  throw new Error(
    [
      "Timed out waiting for Temporal workflow execution state.",
      latestState ? `last state: ${JSON.stringify(latestState)}` : null,
      latestError ? `last query error: ${latestError}` : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n"),
  );
}

function isExecutionAtOrAfter(
  lastExecutionAt: string | null,
  executionNotBefore: Date | undefined,
): boolean {
  if (!executionNotBefore) {
    return true;
  }
  if (!lastExecutionAt) {
    return false;
  }

  const executionAtMs = Date.parse(lastExecutionAt);
  return Number.isFinite(executionAtMs)
    && executionAtMs >= executionNotBefore.getTime();
}

interface ObservedHostedRuntimeWorkflowState {
  lastExecutionAt: string | null;
  lastExecutionErrorCode: string | null;
  lastExecutionKind: string | null;
  lastReconciliationBlockedReason: string | null;
  userId: string;
}

function readObservedHostedRuntimeWorkflowState(
  value: unknown,
): ObservedHostedRuntimeWorkflowState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Hosted runtime Workflow query returned a non-object.");
  }
  const record = value as Record<string, unknown>;
  const lastExecutionAt = readNullableString(record.lastExecutionAt);
  const lastExecutionErrorCode = readNullableString(
    record.lastExecutionErrorCode,
  );
  const lastExecutionKind = readNullableString(record.lastExecutionKind);
  const lastReconciliationBlockedReason = readNullableString(
    record.lastReconciliationBlockedReason,
  );
  if (typeof record.userId !== "string" || record.userId.length === 0) {
    throw new TypeError("Hosted runtime Workflow query returned an invalid userId.");
  }

  return {
    lastExecutionAt,
    lastExecutionErrorCode,
    lastExecutionKind,
    lastReconciliationBlockedReason,
    userId: record.userId,
  };
}

function readNullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new TypeError("Hosted runtime Workflow query returned an invalid field.");
  }
  return value;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local full-stack scenario was not initialized.");
  }

  return scenario;
}

function buildActivationWake(memberId: string, eventLabel: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${memberId}:evt_temporal_${eventLabel}`,
    memberChannels: {
      email: false,
      linq: false,
      telegram: false,
    },
    memberId,
    occurredAt: new Date().toISOString(),
  });
}
