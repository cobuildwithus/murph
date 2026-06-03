import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import type { HostedRuntimeBridgeCheckpointLease } from "@murphai/assistant-runtime/hosted-checkpoint-bridge";

import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "../runner-outbound/headers.ts";
import { writeRunnerRuntimeWriteFenceHeaders } from "../runner-outbound/write-fence.ts";

const HOSTED_RUNTIME_STALE_INVOCATION_AUTHORITY_CODE =
  "HOSTED_RUNTIME_STALE_INVOCATION_AUTHORITY";
const HOSTED_RUNTIME_INTERNAL_AUTHORITY_REJECTED_REASON =
  "internal_authority_rejected";
export class HostedRuntimeInternalAuthorityRejectedError extends Error {
  readonly code = HOSTED_RUNTIME_STALE_INVOCATION_AUTHORITY_CODE;
  readonly reason = HOSTED_RUNTIME_INTERNAL_AUTHORITY_REJECTED_REASON;
  readonly responseStatus: number;
  readonly status: number;
  readonly statusCode: number;

  constructor(input: {
    description: string;
    status: number;
  }) {
    super(
      `${input.description} failed with HTTP ${input.status}. `
      + `Hosted invocation is stale: ${HOSTED_RUNTIME_INTERNAL_AUTHORITY_REJECTED_REASON}.`,
    );
    this.name = "HostedRuntimeInternalAuthorityRejectedError";
    this.responseStatus = input.status;
    this.status = input.status;
    this.statusCode = input.status;
  }
}

export function isHostedRuntimeInternalAuthorityRejectedError(
  error: unknown,
): error is HostedRuntimeInternalAuthorityRejectedError {
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);

    if (current instanceof HostedRuntimeInternalAuthorityRejectedError) {
      return true;
    }

    const code = (current as { code?: unknown }).code;
    if (code === HOSTED_RUNTIME_STALE_INVOCATION_AUTHORITY_CODE) {
      return true;
    }

    current = "cause" in current
      ? (current as { cause?: unknown }).cause
      : null;
  }

  return false;
}

export interface HostedWorkspaceCheckpointBridgeAuthority {
  readCurrentLease():
    | HostedRuntimeBridgeCheckpointLease
    | null
    | Promise<HostedRuntimeBridgeCheckpointLease | null>;
  recordCheckpoint?(input: {
    workspaceVersion: string;
  }): Promise<void> | void;
}
export async function createHostedRuntimeWriteFenceHeaders(
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority,
): Promise<Headers> {
  const headers = new Headers();
  const lease = await workspaceCheckpointBridge.readCurrentLease();
  if (lease) {
    writeRunnerRuntimeWriteFenceHeaders(headers, lease);
  }
  return headers;
}

export async function requireHostedRuntimeWriteFenceHeaders(
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority,
  description: string,
): Promise<Headers> {
  const headers = new Headers();
  const lease = await workspaceCheckpointBridge.readCurrentLease();
  if (!lease) {
    throw new Error(`${description} requires an active hosted runtime write fence.`);
  }
  writeRunnerRuntimeWriteFenceHeaders(headers, lease);
  return headers;
}
export function isInternalAuthorityRejectedStatus(status: number): boolean {
  return status === 401 || status === 403;
}
