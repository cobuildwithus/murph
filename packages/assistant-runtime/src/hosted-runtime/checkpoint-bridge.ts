import type {
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceCheckpointResponse,
} from "@murphai/hosted-execution/runtime-control";

export interface HostedRuntimeBridgeCheckpointLease {
  attemptId: string;
  leaseGeneration: string;
  providerEgressToken?: string | null;
  userId: string;
  workspaceVersion: string;
}

export type HostedRuntimeBridgeCheckpointLeaseErrorCode =
  | "missing_lease"
  | "stale_attempt"
  | "stale_lease_generation"
  | "stale_workspace_version"
  | "stale_user"
  | "workspace_user_mismatch";

export type HostedRuntimeBridgeCheckpointLeaseStage =
  | "before_snapshot"
  | "before_bundle_write"
  | "before_direct_r2_put"
  | "before_web_checkpoint"
  | "after_web_checkpoint";

export class HostedRuntimeBridgeCheckpointLeaseError extends Error {
  constructor(
    readonly code: HostedRuntimeBridgeCheckpointLeaseErrorCode,
    readonly stage: HostedRuntimeBridgeCheckpointLeaseStage,
    readonly postWebCheckpoint?: {
      responseCheckpointed: boolean;
      leaseMatchesResponse: boolean;
    },
  ) {
    super(`Hosted runtime bridge checkpoint lease validation failed ${stage}.`);
    this.name = "HostedRuntimeBridgeCheckpointLeaseError";
  }
}

export interface HostedRuntimeBridgeWebCheckpointInput {
  checkpointWorkspace(
    request: HostedWorkspaceCheckpointRequest,
  ): Promise<HostedWorkspaceCheckpointResponse> | HostedWorkspaceCheckpointResponse;
  readCurrentLease():
    | HostedRuntimeBridgeCheckpointLease
    | null
    | Promise<HostedRuntimeBridgeCheckpointLease | null>;
  request: HostedWorkspaceCheckpointRequest;
  userId: string;
}

export async function checkpointHostedRuntimeBridgeWebWorkspace(
  input: HostedRuntimeBridgeWebCheckpointInput,
): Promise<HostedWorkspaceCheckpointResponse> {
  requireCheckpointLeaseMatchesRequest({
    lease: await input.readCurrentLease(),
    request: input.request,
    stage: "before_web_checkpoint",
    userId: input.userId,
  });

  const response = await input.checkpointWorkspace(input.request);

  if (response.workspace.userId !== input.userId) {
    throw new HostedRuntimeBridgeCheckpointLeaseError(
      "workspace_user_mismatch",
      "after_web_checkpoint",
    );
  }

  requireCheckpointLeaseMatchesRequest({
    lease: await input.readCurrentLease(),
    request: input.request,
    response,
    stage: "after_web_checkpoint",
    userId: input.userId,
  });

  return response;
}

function requireCheckpointLeaseMatchesRequest(input: {
  lease: HostedRuntimeBridgeCheckpointLease | null;
  request: HostedWorkspaceCheckpointRequest;
  response?: HostedWorkspaceCheckpointResponse;
  stage: HostedRuntimeBridgeCheckpointLeaseStage;
  userId: string;
}): HostedRuntimeBridgeCheckpointLease {
  if (!input.lease) {
    throw new HostedRuntimeBridgeCheckpointLeaseError("missing_lease", input.stage);
  }
  if (input.lease.userId !== input.userId) {
    throw new HostedRuntimeBridgeCheckpointLeaseError("stale_user", input.stage);
  }
  if (input.lease.attemptId !== input.request.attemptId) {
    throw new HostedRuntimeBridgeCheckpointLeaseError("stale_attempt", input.stage);
  }
  if (input.lease.leaseGeneration !== input.request.leaseGeneration) {
    throw new HostedRuntimeBridgeCheckpointLeaseError("stale_lease_generation", input.stage);
  }
  if (input.lease.workspaceVersion !== input.request.expectedWorkspaceVersion) {
    throw new HostedRuntimeBridgeCheckpointLeaseError(
      "stale_workspace_version",
      input.stage,
      input.stage === "after_web_checkpoint" && input.response
        ? {
            responseCheckpointed: input.response.checkpointed,
            leaseMatchesResponse:
              input.lease.workspaceVersion === input.response.workspace.version,
          }
        : undefined,
    );
  }

  return input.lease;
}
