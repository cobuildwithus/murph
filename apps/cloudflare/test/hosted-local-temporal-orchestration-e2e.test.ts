import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import {
  HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
} from "@murphai/hosted-execution/orchestration-control";
import {
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionEnvironmentInterviewCompletedWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionMemberChannelsUpdatedWake,
} from "@murphai/hosted-execution";
import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
} from "./helpers/hosted-local-linq-support.js";
import {
  appendHostedExecutionWakeForTest,
  queryHostedRuntimeWorkflowForTest,
  readHostedMailboxItemForTest,
  seedHostedWorkspaceInboxMediaRetentionWakeForTest,
  seedHostedWorkspaceWakeForTest,
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
const modelFreeFrontierUserId =
  `member_local_temporal_model_free_frontier_${Date.now()}`;
const defaultOwnedFrontierUserId =
  `member_local_temporal_default_owned_frontier_${Date.now()}`;
const environmentInterviewUserId =
  `member_local_temporal_environment_interview_${Date.now()}`;

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

  it("routes an Environment interview through its model-free runtime owner", async () => {
    const activeScenario = requireScenario();
    await activeScenario.seedActiveHostedMember({
      memberId: environmentInterviewUserId,
    });
    await activeScenario.runWake(
      buildActivationWake(environmentInterviewUserId, "environment-interview"),
      environmentInterviewUserId,
    );
    const activationStatus = await activeScenario.waitForHostedCompletion(
      environmentInterviewUserId,
    );
    const activationReplicaRef =
      activationStatus.workspace?.browserVaultReplicaRef;
    const providerRequestBaseline = activeScenario.assistantProviderRequests.length;
    const completedAt = new Date().toISOString();
    const completionId = randomUUID();
    const eventId = `environment-interview:${completionId}`;
    const append = await appendHostedExecutionWakeForTest({
      environment: activeScenario.runtimeEnv,
      wake: buildHostedExecutionEnvironmentInterviewCompletedWake({
        completedAt,
        completionId,
        eventId,
        memberId: environmentInterviewUserId,
        occurredAt: completedAt,
        topics: [{
          answers: [{
            aspectId: "sleep-environment",
            indicatorId: "night_temp_c",
            note: "The bedroom stays near 19 degrees at night.",
            value: 19,
          }],
          topicId: "sleep:0",
        }],
      }),
    });
    const signalStartedAt = new Date();
    const signal = await signalHostedMailboxAppendRuntimeForTest({
      environment: activeScenario.runtimeEnv,
      expectedUserId: environmentInterviewUserId,
      mailboxItemId: append.wake.id,
    });

    const workflowState = await waitForWorkflowExecutionState({
      env: activeScenario.runtimeEnv,
      executionNotBefore: signalStartedAt,
      workflowId: signal.workflowId,
    });
    expect(workflowState.lastExecutionErrorCode).toBeNull();
    expect(workflowState.lastExecutionKind).toMatch(/runtime_/u);

    const finalStatus = await activeScenario.waitForHostedCompletion(
      environmentInterviewUserId,
    );
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.workspace?.browserVaultReplicaRef).not.toBeNull();
    expect(finalStatus.workspace?.browserVaultReplicaRef).not.toEqual(
      activationReplicaRef,
    );
    await expect(readHostedMailboxItemForTest({
      dedupeKey: eventId,
      environment: activeScenario.runtimeEnv,
      userId: environmentInterviewUserId,
    })).resolves.toMatchObject({
      consumedAt: expect.any(String),
      kind: "environment-interview.completed",
      lane: "system",
    });
    expect(activeScenario.assistantProviderRequests).toHaveLength(
      providerRequestBaseline,
    );
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

  it("routes engagement-blocked system frontiers to their declared owners", async () => {
    const activeScenario = requireScenario();

    await seedEngagementPausedFrontierMember(
      activeScenario,
      modelFreeFrontierUserId,
      "model-free-frontier",
    );
    const modelFreeProviderBaseline =
      activeScenario.assistantProviderRequests.length;
    const modelFreeAppend = await appendHostedExecutionWakeForTest({
      environment: activeScenario.runtimeEnv,
      wake: buildHostedExecutionDeviceSyncWake({
        eventId: `device-sync.wake:temporal-frontier:${Date.now()}`,
        occurredAt: new Date().toISOString(),
        reason: "webhook_hint",
        userId: modelFreeFrontierUserId,
      }),
    });
    const modelFreeSignalStartedAt = new Date();
    const modelFreeSignal = await signalHostedMailboxAppendRuntimeForTest({
      environment: activeScenario.runtimeEnv,
      expectedUserId: modelFreeFrontierUserId,
      mailboxItemId: modelFreeAppend.wake.id,
    });
    const modelFreeState = await waitForWorkflowExecutionState({
      env: activeScenario.runtimeEnv,
      executionNotBefore: modelFreeSignalStartedAt,
      workflowId: modelFreeSignal.workflowId,
    });
    expect(modelFreeState.lastExecutionErrorCode).toBeNull();
    await waitForSystemMailboxHandledThrough({
      expectedSeq: modelFreeAppend.wake.seq,
      userId: modelFreeFrontierUserId,
    });
    expect(activeScenario.assistantProviderRequests).toHaveLength(
      modelFreeProviderBaseline,
    );

    await seedEngagementPausedFrontierMember(
      activeScenario,
      defaultOwnedFrontierUserId,
      "default-owned-frontier",
    );
    const defaultOwnedProviderBaseline =
      activeScenario.assistantProviderRequests.length;
    const defaultOwnedEventId =
      `member.channels.updated:temporal-frontier:${Date.now()}`;
    const defaultOwnedAppend = await appendHostedExecutionWakeForTest({
      environment: activeScenario.runtimeEnv,
      wake: buildHostedExecutionMemberChannelsUpdatedWake({
        eventId: defaultOwnedEventId,
        memberChannels: {
          email: false,
          linq: true,
          telegram: false,
        },
        memberId: defaultOwnedFrontierUserId,
        occurredAt: new Date().toISOString(),
      }),
    });
    const defaultOwnedSignal = await signalHostedMailboxAppendRuntimeForTest({
      environment: activeScenario.runtimeEnv,
      expectedUserId: defaultOwnedFrontierUserId,
      mailboxItemId: defaultOwnedAppend.wake.id,
    });
    const defaultOwnedState = await waitForWorkflowBlockedState({
      env: activeScenario.runtimeEnv,
      workflowId: defaultOwnedSignal.workflowId,
    });
    expect(defaultOwnedState.lastExecutionAt).toBeNull();
    expect(defaultOwnedState.lastExecutionErrorCode).toBeNull();
    expect(defaultOwnedState.lastExecutionKind).toBeNull();
    await expect(readHostedMailboxItemForTest({
      dedupeKey: defaultOwnedEventId,
      environment: activeScenario.runtimeEnv,
      userId: defaultOwnedFrontierUserId,
    })).resolves.toMatchObject({
      consumedAt: null,
      kind: "member.channels.updated",
      lane: "system",
    });
    const defaultOwnedStatus = await activeScenario.harness.readUserStatus(
      defaultOwnedFrontierUserId,
    );
    expect(readSystemMailboxHandledThroughSeq(defaultOwnedStatus)).toBeLessThan(
      BigInt(defaultOwnedAppend.wake.seq),
    );
    expect(activeScenario.assistantProviderRequests).toHaveLength(
      defaultOwnedProviderBaseline,
    );
  }, 300_000);
});

async function seedEngagementPausedFrontierMember(
  activeScenario: HostedLocalFullStackScenario,
  userId: string,
  eventLabel: string,
): Promise<void> {
  const memberPhone = buildLinqRecipientPhoneNumber(userId);
  await activeScenario.seedActiveHostedLinqMember({
    homePhone: buildLinqHomePhoneNumber(userId),
    memberId: userId,
    memberPhone,
    recentInboundAt: null,
  });
  await activeScenario.bindActiveHostedLinqHomeChat({
    chatId: `chat_local_temporal_frontier_${eventLabel}`,
    memberId: userId,
    recentInboundAt: null,
    recipientPhone: memberPhone,
  });
  await activeScenario.runWake(
    buildActivationWake(userId, eventLabel, true),
    userId,
  );
  await activeScenario.waitForHostedCompletion(userId);
  await seedHostedWorkspaceWakeForTest({
    environment: activeScenario.runtimeEnv,
    userId,
    wakeAt: new Date(Date.now() - 60_000),
    wakeReason: "assistant",
  });
}

async function waitForSystemMailboxHandledThrough(input: {
  expectedSeq: string;
  userId: string;
}): Promise<void> {
  await expect.poll(async () => {
    const status = await requireScenario().harness.readUserStatus(input.userId);
    return readSystemMailboxHandledThroughSeq(status);
  }, {
    interval: 250,
    timeout: 120_000,
  }).toBeGreaterThanOrEqual(BigInt(input.expectedSeq));
}

function readSystemMailboxHandledThroughSeq(
  status: Awaited<ReturnType<
    HostedLocalFullStackScenario["harness"]["readUserStatus"]
  >>,
): bigint {
  const value =
    status.workspace?.redactedStatus?.hostedMailboxSystemHandledThroughSeq;
  return typeof value === "string" ? BigInt(value) : 0n;
}

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

async function waitForWorkflowBlockedState(input: {
  env: NodeJS.ProcessEnv;
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
        latestState.lastReconciliationBlockedReason
          === "automation_engagement_paused"
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
      "Timed out waiting for Temporal workflow engagement block.",
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

function buildActivationWake(
  memberId: string,
  eventLabel: string,
  linq = false,
) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${memberId}:evt_temporal_${eventLabel}`,
    memberChannels: {
      email: false,
      linq,
      telegram: false,
    },
    memberId,
    occurredAt: new Date().toISOString(),
  });
}
