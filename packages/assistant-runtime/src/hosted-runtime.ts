import type {
  HostedWorkspaceInvocationResult,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  normalizeHostedAssistantRuntimeConfig,
  withHostedProcessEnvironment,
} from "./hosted-runtime/environment.ts";
import {
  executeHostedMailboxEvent,
} from "./hosted-runtime/events.ts";
import {
  resolveHostedVercelAiGatewayStripeCustomerId,
} from "./hosted-runtime/billing.ts";
import {
  createHostedAssistantChannelTypingDependencies,
} from "./hosted-runtime/channel-typing.ts";
import type {
  HostedAssistantWorkspaceRuntimeJobInput,
} from "./hosted-runtime/models.ts";
import type {
  HostedMailboxItemImportOutcome,
  HostedMailboxResolvedImportItem,
} from "./hosted-runtime/mailbox-import.ts";
import type { HostedRuntimePlatform } from "./hosted-runtime/platform.ts";
import {
  buildHostedMailboxImportRedactedStatus,
  HostedMailboxImportCheckpointConflictError,
  HostedMailboxImportCheckpointUserMismatchError,
  importHostedMailboxPrefixAndCheckpoint,
} from "./hosted-runtime/mailbox-checkpoint.ts";
import type {
  HostedWorkspaceSnapshotCheckpointBuilder,
} from "./hosted-runtime/workspace-runner.ts";
import {
  createHostedWorkspaceCheckpointRequestBuilder,
  createHostedWorkspaceSnapshotCheckpointRequestBuilder,
  HostedWorkspaceRunnerUserMismatchError,
  runHostedWorkspaceUntilIdleOrBudget,
} from "./hosted-runtime/workspace-runner.ts";
import {
  restoreHostedWorkspaceRuntimeJobWorkspace,
} from "./hosted-runtime/workspace-restore.ts";
import {
  runHostedWorkspaceAssistantPhase,
  type HostedWorkspaceRuntimeAssistantPhase,
} from "./hosted-runtime/workspace-assistant-phase.ts";
import {
  importHostedVaultSyncMailboxItem,
} from "./hosted-runtime/vault-sync-mailbox-import.ts";
import {
  createHostedConversationMailboxImportItem,
} from "./hosted-runtime/mailbox-conversation-import.ts";
import {
  enqueueHostedSystemMailboxItem,
} from "./hosted-runtime/system-mailbox.ts";
import {
  computeHostedRuntimeElapsedMs,
} from "./hosted-runtime/utils.ts";
export {
  formatHostedRuntimeChildResult,
  parseHostedRuntimeChildResult,
} from "./hosted-runtime/child-result.ts";
export {
  resolveHostedVercelAiGatewayStripeCustomerId,
} from "./hosted-runtime/billing.ts";

export type {
  HostedAssistantRuntimeChannelCapabilities,
  HostedAssistantRuntimeConfig,
  HostedAssistantRuntimeDeviceSyncConfig,
  HostedAssistantWorkspaceRuntimeJobInput,
  HostedAssistantWorkspaceRuntimeJobResult,
  HostedAssistantRuntimeManagedAutoReplyChannel,
  HostedAssistantRuntimeResolvedConfig,
} from "./hosted-runtime/models.ts";
export type {
  HostedRuntimeArtifactStore,
  HostedRuntimeBeforeDeliveryMailboxRefresh,
  HostedRuntimeBeforeDeliveryMailboxRefreshInput,
  HostedRuntimeDeviceSyncPort,
  HostedRuntimeEffectsPort,
  HostedRuntimeIssueExportPort,
  HostedRuntimeIssueRecordResponse,
  HostedRuntimeLogPort,
  HostedRuntimeMailboxPort,
  HostedRuntimePlatform,
  HostedRuntimeSharePort,
  HostedRuntimeUsageRecordResponse,
  HostedRuntimeUsageExportPort,
  HostedRuntimeVaultSyncPort,
  HostedRuntimeWorkspacePort,
} from "./hosted-runtime/platform.ts";
export {
  normalizeHostedAssistantRuntimeConfig,
  sanitizeHostedAssistantRuntimeForwardedEnv,
} from "./hosted-runtime/environment.ts";
export {
  executeHostedMailboxEvent,
};
export {
  parseHostedRuntimeBillingStripeCustomerResponse,
  parseHostedRuntimeIssueRecordResponse,
  parseHostedRuntimeUsageRecordResponse,
} from "./hosted-runtime/platform.ts";
export {
  HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY_ENV,
  HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED_ENV,
} from "./hosted-runtime/platform.ts";
export {
  computeHostedRuntimeElapsedMs,
} from "./hosted-runtime/utils.ts";
export {
  createHostedAssistantChannelTypingDependencies,
} from "./hosted-runtime/channel-typing.ts";
export {
  readHostedRunnerCommitTimeoutMs,
} from "./hosted-runtime/timeouts.ts";
export type {
  HostedMailboxImportCheckpointInput,
  HostedMailboxImportCheckpointRequestInput,
  HostedMailboxImportCheckpointResult,
} from "./hosted-runtime/mailbox-checkpoint.ts";
export {
  buildHostedMailboxImportRedactedStatus,
  HostedMailboxImportCheckpointConflictError,
  HostedMailboxImportCheckpointUserMismatchError,
  importHostedMailboxPrefixAndCheckpoint,
};
export type {
  HostedWorkspaceCheckpointMetadata,
  HostedWorkspaceCheckpointRequestBuilder,
  HostedWorkspaceSnapshotCheckpointBuilder,
  HostedWorkspaceSnapshotCheckpointMetadata,
  HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
  HostedWorkspaceSnapshotCheckpointResult,
  HostedWorkspaceRunnerAssistantPhaseInput,
  HostedWorkspaceRunnerAssistantPhaseResult,
  HostedWorkspaceRunnerCheckpointRequestInput,
  HostedWorkspaceRunnerInput,
  HostedWorkspaceRunnerPlatform,
  HostedWorkspaceRunnerResult,
} from "./hosted-runtime/workspace-runner.ts";
export {
  createHostedWorkspaceCheckpointRequestBuilder,
  createHostedWorkspaceSnapshotCheckpointRequestBuilder,
  HostedWorkspaceRunnerUserMismatchError,
  runHostedWorkspaceUntilIdleOrBudget,
};
export type {
  HostedVaultSyncMailboxImportInput,
} from "./hosted-runtime/vault-sync-mailbox-import.ts";
export {
  importHostedVaultSyncMailboxItem,
};
export {
  createHostedConversationMailboxImportItem,
};
export {
  enqueueHostedSystemMailboxItem,
};
export {
  parseHostedAssistantRuntimeConfig,
  parseHostedAssistantWorkspaceRuntimeJobInput,
  parseHostedAssistantWorkspaceRuntimeJobRequest,
} from "./hosted-runtime/parsers.ts";

export interface HostedWorkspaceRuntimeJobOptions {
  createCheckpointSnapshot: HostedWorkspaceSnapshotCheckpointBuilder;
  importItem(item: HostedMailboxResolvedImportItem): Promise<HostedMailboxItemImportOutcome>;
  platform: HostedRuntimePlatform;
  runAssistantPhase?: HostedWorkspaceRuntimeAssistantPhase;
  vaultRoot: string;
}

export class HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError extends Error {
  readonly actualWorkspaceVersion: string | null;
  readonly expectedWorkspaceVersion: string;

  constructor(input: {
    actualWorkspaceVersion: string | null;
    expectedWorkspaceVersion: string;
  }) {
    super("Hosted workspace runtime job read a stale workspace version.");
    this.name = "HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError";
    this.actualWorkspaceVersion = input.actualWorkspaceVersion;
    this.expectedWorkspaceVersion = input.expectedWorkspaceVersion;
  }
}

export async function runHostedWorkspaceRuntimeJobInProcess(
  input: HostedAssistantWorkspaceRuntimeJobInput,
  options: HostedWorkspaceRuntimeJobOptions,
): Promise<HostedWorkspaceInvocationResult> {
  const runtime = normalizeHostedAssistantRuntimeConfig(input.runtime, options.platform);
  const mailboxPort = runtime.platform.mailboxPort ?? null;
  const workspacePort = runtime.platform.workspacePort ?? null;

  if (!mailboxPort) {
    throw new TypeError("Hosted workspace runtime job mailbox port must be injected.");
  }

  if (!workspacePort) {
    throw new TypeError("Hosted workspace runtime job workspace port must be injected.");
  }

  if (typeof workspacePort.read !== "function") {
    throw new TypeError("Hosted workspace runtime job workspace port must support read.");
  }

  assertHostedWorkspaceRuntimeBudgetSupported(input.request.budget?.maxRuntimeMs);

  const workspaceRead = await workspacePort.read();
  assertWorkspaceRunVersionMatchesRequest({
    expectedWorkspaceVersion: input.request.workspaceVersion,
    workspace: workspaceRead.workspace,
  });
  assertWorkspaceRunUserMatchesRequest({
    expectedUserId: input.request.userId,
    workspace: workspaceRead.workspace,
  });
  const restored = await restoreHostedWorkspaceRuntimeJobWorkspace({
    platform: runtime.platform,
    vaultRoot: options.vaultRoot,
    workspace: workspaceRead.workspace,
  });
  const mailboxBudget = createHostedWorkspaceMailboxImportBudget(
    input.request.budget?.maxMailboxItems,
  );
  const runtimeEnv = {
    ...runtime.forwardedEnv,
    ...runtime.userEnv,
  };

  const result = await withHostedProcessEnvironment(
    {
      envOverrides: runtimeEnv,
      operatorHomeRoot: restored.operatorHomeRoot,
      vaultRoot: restored.vaultRoot,
    },
    async () =>
      runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceSnapshotCheckpointRequestBuilder({
          createSnapshot: options.createCheckpointSnapshot,
          metadata: {
            attemptId: input.request.attemptId,
            expectedWorkspaceVersion: input.request.workspaceVersion,
            leaseGeneration: input.request.leaseGeneration,
            nextWakeAt: workspaceRead.workspace?.nextWakeAt ?? null,
            nextWakeReason: workspaceRead.workspace?.nextWakeReason ?? null,
          },
        }),
        expectedUserId: input.request.userId,
        importItem: (item) => mailboxBudget.importItem(item, options.importItem),
        limitPerLane: mailboxBudget.fetchLimitPerLane,
        platform: {
          ...runtime.platform,
          mailboxPort,
          workspacePort,
        },
        requestId: `hosted-workspace-invocation:${input.request.attemptId}`,
        runAssistantPhase: (phaseInput) =>
          (options.runAssistantPhase ?? runHostedWorkspaceAssistantPhase)({
            ...phaseInput,
            request: input.request,
            restored,
            runtime,
            runtimeEnv,
          }),
        vaultRoot: restored.vaultRoot,
        workspace: workspaceRead.workspace,
      }),
  );
  const committedWorkspace = result.latestWorkspace
    ?? result.initialMailboxImport.checkpoint?.workspace
    ?? workspaceRead.workspace;
  const nextWakeAt = resolveHostedWorkspaceRunNextWakeAt({
    assistantPhaseResult: result.assistantPhaseResult,
    committedWorkspace,
  });

  return {
    ...(nextWakeAt === undefined ? {} : { nextWakeAt }),
    ...(committedWorkspace?.redactedStatus
      ? { redactedStatus: committedWorkspace.redactedStatus }
      : { redactedStatus: buildHostedMailboxImportRedactedStatus(result.initialMailboxImport.importResult) }),
    status: resolveHostedWorkspaceInvocationStatus({
      mailboxBudgetExhausted: mailboxBudget.exhausted,
      nextWakeAt,
    }),
  };
}

function assertHostedWorkspaceRuntimeBudgetSupported(maxRuntimeMs: number | null | undefined): void {
  if (maxRuntimeMs === undefined || maxRuntimeMs === null) {
    return;
  }

  throw new TypeError("Hosted workspace runtime job budget.maxRuntimeMs is not supported yet.");
}

function createHostedWorkspaceMailboxImportBudget(maxMailboxItems: number | null | undefined): {
  readonly exhausted: boolean;
  readonly fetchLimitPerLane: number;
  importItem(
    item: HostedMailboxResolvedImportItem,
    importItem: HostedWorkspaceRuntimeJobOptions["importItem"],
  ): Promise<HostedMailboxItemImportOutcome>;
} {
  const importLimit = resolveHostedWorkspaceRunMailboxLimit(maxMailboxItems);
  let importAttempts = 0;
  let exhausted = false;

  return {
    get exhausted() {
      return exhausted;
    },
    fetchLimitPerLane: resolveHostedWorkspaceRunMailboxFetchLimit(importLimit),
    async importItem(item, importItem) {
      if (importAttempts >= importLimit) {
        exhausted = true;
        return {
          reasonCode: "budget.mailbox_items",
          status: "deferred",
        };
      }

      importAttempts += 1;
      return importItem(item);
    },
  };
}

function assertWorkspaceRunVersionMatchesRequest(input: {
  expectedWorkspaceVersion: string;
  workspace: HostedWorkspaceState | null;
}): void {
  const actualWorkspaceVersion = input.workspace?.version ?? null;

  if (actualWorkspaceVersion === input.expectedWorkspaceVersion) {
    return;
  }

  if (actualWorkspaceVersion === null && input.expectedWorkspaceVersion === "0") {
    return;
  }

  throw new HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError({
    actualWorkspaceVersion,
    expectedWorkspaceVersion: input.expectedWorkspaceVersion,
  });
}

function assertWorkspaceRunUserMatchesRequest(input: {
  expectedUserId: string;
  workspace: HostedWorkspaceState | null;
}): void {
  if (input.workspace === null || input.workspace.userId === input.expectedUserId) {
    return;
  }

  throw new HostedWorkspaceRunnerUserMismatchError({
    actualUserId: input.workspace.userId,
    expectedUserId: input.expectedUserId,
  });
}

function resolveHostedWorkspaceRunMailboxLimit(value: number | null | undefined): number {
  return value ?? 50;
}

function resolveHostedWorkspaceRunMailboxFetchLimit(importLimit: number): number {
  return importLimit >= Number.MAX_SAFE_INTEGER ? importLimit : importLimit + 1;
}

function resolveHostedWorkspaceInvocationStatus(input: {
  mailboxBudgetExhausted: boolean;
  nextWakeAt: string | null;
}): HostedWorkspaceInvocationResult["status"] {
  if (input.mailboxBudgetExhausted) {
    return "budget_exhausted";
  }

  if (input.nextWakeAt !== null) {
    return "scheduled";
  }

  return "idle";
}

function resolveHostedWorkspaceRunNextWakeAt(input: {
  assistantPhaseResult: Awaited<ReturnType<typeof runHostedWorkspaceUntilIdleOrBudget>>[
    "assistantPhaseResult"
  ];
  committedWorkspace: HostedWorkspaceState | null;
}): string | null {
  if (
    input.assistantPhaseResult
    && Object.hasOwn(input.assistantPhaseResult, "nextWakeAt")
  ) {
    return input.assistantPhaseResult.nextWakeAt ?? null;
  }

  return input.committedWorkspace?.nextWakeAt ?? null;
}
