import type {
  HostedExecutionSnapshotRef,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceCheckpointResponse,
} from "@murphai/hosted-execution/runtime-control";

export interface HostedRuntimeBridgeCheckpointLease {
  attemptId: string;
  leaseGeneration: string;
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
  ) {
    super(`Hosted runtime bridge checkpoint lease validation failed ${stage}.`);
    this.name = "HostedRuntimeBridgeCheckpointLeaseError";
  }
}

export interface HostedRuntimeBridgeCheckpointInput {
  checkpointWorkspace(
    request: HostedWorkspaceCheckpointRequest,
  ): Promise<HostedWorkspaceCheckpointResponse> | HostedWorkspaceCheckpointResponse;
  readCurrentLease():
    | HostedRuntimeBridgeCheckpointLease
    | null
    | Promise<HostedRuntimeBridgeCheckpointLease | null>;
  request: HostedWorkspaceCheckpointRequest;
  snapshotWorkspace(
    context: HostedRuntimeBridgeCheckpointContext,
  ): Promise<Uint8Array | ArrayBuffer> | Uint8Array | ArrayBuffer;
  userId: string;
  writeBundle(
    context: HostedRuntimeBridgeBundleWriteContext,
  ): Promise<HostedExecutionSnapshotRef> | HostedExecutionSnapshotRef;
}

export interface HostedRuntimeBridgeSnapshotInput {
  readCurrentLease():
    | HostedRuntimeBridgeCheckpointLease
    | null
    | Promise<HostedRuntimeBridgeCheckpointLease | null>;
  request: HostedWorkspaceCheckpointRequest;
  snapshotWorkspace(
    context: HostedRuntimeBridgeCheckpointContext,
  ): Promise<Uint8Array | ArrayBuffer> | Uint8Array | ArrayBuffer;
  userId: string;
  writeBundle(
    context: HostedRuntimeBridgeBundleWriteContext,
  ): Promise<HostedExecutionSnapshotRef> | HostedExecutionSnapshotRef;
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

export interface HostedRuntimeBridgeCheckpointContext {
  lease: HostedRuntimeBridgeCheckpointLease;
  request: HostedWorkspaceCheckpointRequest;
  userId: string;
}

export interface HostedRuntimeBridgeBundleWriteContext
  extends HostedRuntimeBridgeCheckpointContext {
  bundle: Uint8Array;
}

export async function checkpointHostedRuntimeBridgeWorkspace(
  input: HostedRuntimeBridgeCheckpointInput,
): Promise<HostedWorkspaceCheckpointResponse> {
  const snapshotRef = await snapshotHostedRuntimeBridgeWorkspaceBundle(input);

  return await checkpointHostedRuntimeBridgeWebWorkspace({
    checkpointWorkspace: input.checkpointWorkspace,
    readCurrentLease: input.readCurrentLease,
    request: {
      ...input.request,
      snapshotRef,
    },
    userId: input.userId,
  });
}

export async function snapshotHostedRuntimeBridgeWorkspaceBundle(
  input: HostedRuntimeBridgeSnapshotInput,
): Promise<HostedExecutionSnapshotRef> {
  const initialLease = requireCheckpointLeaseMatchesRequest({
    lease: await input.readCurrentLease(),
    request: input.request,
    stage: "before_snapshot",
    userId: input.userId,
  });

  const snapshotBundle = asUint8Array(await input.snapshotWorkspace({
    lease: initialLease,
    request: input.request,
    userId: input.userId,
  }));

  const bundleWriteLease = requireCheckpointLeaseMatchesRequest({
    lease: await input.readCurrentLease(),
    request: input.request,
    stage: "before_bundle_write",
    userId: input.userId,
  });

  const snapshotRef = await input.writeBundle({
    bundle: snapshotBundle,
    lease: bundleWriteLease,
    request: input.request,
    userId: input.userId,
  });

  return snapshotRef;
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
    stage: "after_web_checkpoint",
    userId: input.userId,
  });

  return response;
}

function requireCheckpointLeaseMatchesRequest(input: {
  lease: HostedRuntimeBridgeCheckpointLease | null;
  request: HostedWorkspaceCheckpointRequest;
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
    throw new HostedRuntimeBridgeCheckpointLeaseError("stale_workspace_version", input.stage);
  }

  return input.lease;
}

function asUint8Array(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}
