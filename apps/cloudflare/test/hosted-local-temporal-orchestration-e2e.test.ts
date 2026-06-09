import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
  type HostedRuntimeWorkflowState,
} from "@murphai/hosted-execution/orchestration-control";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  createHostedRuntimeTemporalClientFromEnv,
} from "@murphai/hosted-orchestrator-temporal/client/temporal-client";

import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  signalHostedMailboxAppendRuntimeForTest,
  signalHostedManualRunRuntimeForTest,
} from "#hosted-web-testing";

vi.mock("server-only", () => ({}));

const runUserId = `member_local_temporal_orchestration_${Date.now()}`;
const mailboxWorkspaceUserId =
  `member_local_temporal_mailbox_workspace_${Date.now()}`;

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
    expect(workflowState.lastReconciliationStatus).toBe("work_pending");
    expect(workflowState.lastExecutionAt).not.toBeNull();
    expect(workflowState.lastExecutionErrorCode).toBeNull();

    const finalStatus = await activeScenario.waitForHostedCompletion(
      mailboxWorkspaceUserId,
    );
    expect(finalStatus.workspace).not.toBeNull();
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
  }, 300_000);
});

async function waitForWorkflowExecutionState(input: {
  env: NodeJS.ProcessEnv;
  workflowId: string;
}): Promise<HostedRuntimeWorkflowState> {
  const client = await createHostedRuntimeTemporalClientFromEnv(input.env);
  const handle = client.workflow.getHandle(input.workflowId);
  const deadline = Date.now() + 180_000;
  let latestState: HostedRuntimeWorkflowState | null = null;
  let latestError: string | null = null;

  try {
    while (Date.now() < deadline) {
      try {
        latestState = await handle.query<HostedRuntimeWorkflowState>(
          HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
        );
        if (latestState.lastExecutionKind !== null) {
          return latestState;
        }
      } catch (error) {
        latestError = error instanceof Error ? error.message : String(error);
      }

      await sleep(1_000);
    }
  } finally {
    await client.connection.close();
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
