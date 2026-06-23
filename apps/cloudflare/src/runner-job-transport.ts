import type {
  HostedAssistantWorkspaceRuntimeJobInput,
  HostedAssistantWorkspaceRuntimeJobResult,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";
import {
  parseHostedAssistantWorkspaceRuntimeJobInput,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";
import {
  parseHostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/parsers";

import {
  parseHostedWorkspaceSnapshotPreparedRestore,
  type HostedWorkspaceSnapshotPreparedRestore,
} from "./workspace-snapshot-restore-preparation.ts";

export const HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND = "workspace-invocation";
const HOSTED_WORKSPACE_SNAPSHOT_PATH_HASH_SECRET_PATTERN = /^[a-f0-9]{64}$/u;

export interface HostedExecutionWorkspaceInvocationDiagnostics {
  workspaceSnapshotPathHashSecret?: string;
}

export interface HostedExecutionWorkspaceInvocationJobInput
  extends HostedAssistantWorkspaceRuntimeJobInput {
  diagnostics?: HostedExecutionWorkspaceInvocationDiagnostics;
  kind: typeof HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND;
  preparedSnapshotRestore?: HostedWorkspaceSnapshotPreparedRestore;
}

export type HostedExecutionRunnerJobInput = HostedExecutionWorkspaceInvocationJobInput;

export type HostedExecutionRunnerJobResult = HostedAssistantWorkspaceRuntimeJobResult;

export interface HostedExecutionRunnerJobParsers {
  parseWorkspaceJobInput(value: unknown): HostedAssistantWorkspaceRuntimeJobInput;
}

export function parseHostedExecutionRunnerJobInput(
  value: unknown,
  parsers: HostedExecutionRunnerJobParsers = {
    parseWorkspaceJobInput: parseHostedAssistantWorkspaceRuntimeJobInput,
  },
): HostedExecutionRunnerJobInput {
  const record = requireRecord(value, "Hosted execution runner job input");
  const kind = requireHostedExecutionWorkspaceJobKind(record.kind);
  const diagnostics = parseHostedExecutionWorkspaceInvocationDiagnostics(record.diagnostics);
  const preparedSnapshotRestore = record.preparedSnapshotRestore === undefined
    ? undefined
    : parseHostedWorkspaceSnapshotPreparedRestore(
        record.preparedSnapshotRestore,
        "Hosted execution runner job input.preparedSnapshotRestore",
      );

  return {
    ...parsers.parseWorkspaceJobInput(record),
    ...(diagnostics ? { diagnostics } : {}),
    kind,
    ...(preparedSnapshotRestore ? { preparedSnapshotRestore } : {}),
  };
}

export function isHostedExecutionWorkspaceInvocationJob(
  job: HostedExecutionRunnerJobInput,
): job is HostedExecutionWorkspaceInvocationJobInput {
  return job.kind === HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND;
}

export function readHostedExecutionRunnerJobUserId(
  job: HostedExecutionRunnerJobInput,
): string {
  return job.request.userId;
}

export function assertHostedExecutionRunnerJobResult(
  value: unknown,
  _job: HostedExecutionRunnerJobInput,
): HostedExecutionRunnerJobResult {
  return parseHostedWorkspaceInvocationResult(value);
}

function requireHostedExecutionWorkspaceJobKind(
  value: unknown,
): typeof HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND {
  if (value === HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND) {
    return HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND;
  }

  throw new TypeError("Hosted execution runner job input.kind must be workspace-invocation.");
}

function parseHostedExecutionWorkspaceInvocationDiagnostics(
  value: unknown,
): HostedExecutionWorkspaceInvocationDiagnostics | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = requireRecord(
    value,
    "Hosted execution runner job input.diagnostics",
  );
  const workspaceSnapshotPathHashSecret = requireOptionalDerivedDiagnosticsKey(
    record.workspaceSnapshotPathHashSecret,
    "Hosted execution runner job input.diagnostics.workspaceSnapshotPathHashSecret",
  );

  if (!workspaceSnapshotPathHashSecret) {
    return undefined;
  }

  return {
    workspaceSnapshotPathHashSecret,
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireOptionalDerivedDiagnosticsKey(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }

  if (!HOSTED_WORKSPACE_SNAPSHOT_PATH_HASH_SECRET_PATTERN.test(normalized)) {
    throw new TypeError(
      `${label} must be a 64-character lowercase hexadecimal derived diagnostics key.`,
    );
  }

  return normalized;
}
