import type { HostedExecutionBundleRef as RuntimeHostedExecutionBundleRef } from "@murphai/runtime-state";

export type HostedExecutionBundlePayload = string | null;
export type HostedExecutionBundleRefState = RuntimeHostedExecutionBundleRef | null;

export const HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA =
  "murph.hosted-execution-layered-snapshot.v1";
export const HOSTED_EXECUTION_WORKING_SNAPSHOT_REF_SCHEMA =
  "murph.hosted-execution-working-snapshot.v1";

export interface HostedExecutionLayeredSnapshotRef {
  base: RuntimeHostedExecutionBundleRef | null;
  hot: RuntimeHostedExecutionBundleRef | null;
  schema: typeof HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA;
}

export interface HostedExecutionWorkingSnapshotRef {
  base: RuntimeHostedExecutionBundleRef;
  delta: RuntimeHostedExecutionBundleRef;
  schema: typeof HOSTED_EXECUTION_WORKING_SNAPSHOT_REF_SCHEMA;
}

export type HostedExecutionSnapshotRef =
  | RuntimeHostedExecutionBundleRef
  | HostedExecutionLayeredSnapshotRef
  | HostedExecutionWorkingSnapshotRef;

export type HostedExecutionSnapshotRefState = HostedExecutionSnapshotRef | null;
