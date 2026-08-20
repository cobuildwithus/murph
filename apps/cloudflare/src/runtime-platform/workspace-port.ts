import {
  HostedRuntimeCanonicalCheckpointError,
  type HostedRuntimePlatform,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  checkpointHostedRuntimeBridgeWebWorkspace,
  HostedRuntimeBridgeCheckpointLeaseError,
} from "@murphai/assistant-runtime/hosted-checkpoint-bridge";
import {
  parseHostedWorkspaceCheckpointResponse,
  parseHostedWorkspaceReadResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BYTE_SIZE_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SHA_STATUS_KEY,
  type HostedWorkspaceCheckpointRequest,
  type HostedWorkspaceCheckpointResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";

import type { HostedWorkspaceCheckpointBridgeAuthority } from "./authority-headers.ts";
import {
  isHostedRuntimeInternalAuthorityRejectedError,
  requireHostedRuntimeWriteFenceHeaders,
} from "./authority-headers.ts";
import { readHostedRuntimeControlPlaneFetchFailureDiagnostics } from "./control-plane-fetch.ts";
import {
  fetchHostedWebControlPlaneJson,
  HostedWebControlPlaneResponseError,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedWebWorkspacePort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority | null;
}) {
  return {
    async read(context?: { signal?: AbortSignal | null }) {
      const payload = await fetchHostedWebControlPlaneJson({
        boundUserId: input.boundUserId,
        description: "Hosted workspace read",
        fetchImpl: input.fetchImpl,
        ...(input.workspaceCheckpointBridge
          ? {
              headers: await requireHostedRuntimeWriteFenceHeaders(
                input.workspaceCheckpointBridge,
                "Hosted workspace read",
              ),
            }
          : {}),
        method: "GET",
        path: HOSTED_RUNTIME_WORKSPACE_PATH,
        signal: context?.signal ?? null,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedWorkspaceReadResponse(payload);
    },
    async checkpoint(
      request: Parameters<NonNullable<HostedRuntimePlatform["workspacePort"]>["checkpoint"]>[0],
    ) {
      const checkpointWorkspace = async (
        checkpointRequest: Parameters<
          NonNullable<HostedRuntimePlatform["workspacePort"]>["checkpoint"]
        >[0],
      ) => {
        const payload = await fetchHostedWebControlPlaneJson({
          body: checkpointRequest,
          boundUserId: input.boundUserId,
          description: "Hosted workspace checkpoint",
          fetchImpl: input.fetchImpl,
          ...(input.workspaceCheckpointBridge
            ? {
                headers: await requireHostedRuntimeWriteFenceHeaders(
                  input.workspaceCheckpointBridge,
                  "Hosted workspace checkpoint",
                ),
              }
            : {}),
          path: HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
          timeoutMs: input.timeoutMs,
          transport: input.transport,
        });

        return parseHostedWorkspaceCheckpointResponse(payload);
      };

      if (!input.workspaceCheckpointBridge) {
        return await checkpointWorkspace(request);
      }
      const workspaceCheckpointBridge = input.workspaceCheckpointBridge;

      const checkpointThroughBridge = async () =>
        await checkpointHostedRuntimeBridgeWebWorkspace({
          checkpointWorkspace,
          readCurrentLease: workspaceCheckpointBridge.readCurrentLease,
          request,
          userId: input.boundUserId,
        });
      let response: HostedWorkspaceCheckpointResponse;
      try {
        response = await checkpointThroughBridge();
      } catch (error) {
        if (
          request.reason !== "canonical_runtime_commit"
          || !isAmbiguousHostedWorkspaceCheckpointError(error)
        ) {
          throw error;
        }

        let retried: HostedWorkspaceCheckpointResponse;
        try {
          retried = await checkpointThroughBridge();
        } catch (retryError) {
          if (
            isTransientHostedWorkspaceCheckpointError(error)
            && isTransientHostedWorkspaceCheckpointError(retryError)
          ) {
            throw new HostedRuntimeCanonicalCheckpointError({
              cause: error,
            });
          }
          throw error;
        }
        if (retried.checkpointed) {
          response = retried;
        } else if (isExactCanonicalCheckpointSuccessor({
          boundUserId: input.boundUserId,
          request,
          response: retried,
        })) {
          response = {
            checkpointed: true,
            workspace: retried.workspace,
          };
        } else {
          throw error;
        }
      }
      if (response.checkpointed) {
        await workspaceCheckpointBridge.recordCheckpoint?.({
          workspaceVersion: response.workspace.version,
        });
      }
      return response;
    },
  };
}

function isTransientHostedWorkspaceCheckpointError(error: unknown): boolean {
  if (
    error instanceof HostedRuntimeBridgeCheckpointLeaseError
    || isHostedRuntimeInternalAuthorityRejectedError(error)
  ) {
    return false;
  }
  if (error instanceof HostedWebControlPlaneResponseError) {
    return error.status === 408 || error.status >= 500;
  }

  const diagnostics = readHostedRuntimeControlPlaneFetchFailureDiagnostics(error);
  if (diagnostics) {
    if (diagnostics.fetchCallerSignalAborted) {
      return false;
    }
    return diagnostics.fetchCauseKind === "cloudflare_rpc_destroy"
      || diagnostics.fetchCauseKind === "fetch_failed"
      || diagnostics.fetchCauseKind === "network"
      || diagnostics.fetchCauseKind === "timeout";
  }

  return hasErrorName(error, "TimeoutError");
}

function hasErrorName(error: unknown, name: string): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error && current.name === name) {
      return true;
    }
    current = "cause" in current
      ? (current as { cause?: unknown }).cause
      : null;
  }
  return false;
}

function isAmbiguousHostedWorkspaceCheckpointError(error: unknown): boolean {
  if (
    error instanceof HostedRuntimeBridgeCheckpointLeaseError
    || isHostedRuntimeInternalAuthorityRejectedError(error)
  ) {
    return false;
  }
  if (error instanceof HostedWebControlPlaneResponseError) {
    return error.status === 408 || error.status >= 500;
  }
  return true;
}

function isExactCanonicalCheckpointSuccessor(input: {
  boundUserId: string;
  request: HostedWorkspaceCheckpointRequest;
  response: HostedWorkspaceCheckpointResponse;
}): boolean {
  if (
    input.request.reason !== "canonical_runtime_commit"
    || input.response.checkpointed
    || input.response.checkpointConflictReason !== "workspace_version"
    || !hasExplicitCanonicalCheckpointState(input.request)
  ) {
    return false;
  }

  const receiptLogSha256 = input.request.redactedStatus?.[
    HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SHA_STATUS_KEY
  ];
  const receiptLogByteSize = input.request.redactedStatus?.[
    HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BYTE_SIZE_STATUS_KEY
  ];
  if (
    typeof receiptLogSha256 !== "string"
    || !/^[a-f0-9]{64}$/u.test(receiptLogSha256)
    || typeof receiptLogByteSize !== "number"
    || !Number.isSafeInteger(receiptLogByteSize)
    || receiptLogByteSize <= 0
  ) {
    return false;
  }

  const successorVersion = incrementWorkspaceVersion(
    input.request.expectedWorkspaceVersion,
  );
  const workspace = input.response.workspace;
  return successorVersion !== null
    && workspace.userId === input.boundUserId
    && workspace.version === successorVersion
    && (workspace.inboxMediaRetentionWakeAt ?? null)
      === (input.request.inboxMediaRetentionWakeAt ?? null)
    && (workspace.nextWakeAt ?? null) === (input.request.nextWakeAt ?? null)
    && (workspace.nextWakeReason ?? null) === (input.request.nextWakeReason ?? null)
    && areJsonValuesEqual(workspace.snapshotRef, input.request.snapshotRef)
    && areJsonValuesEqual(
      workspace.redactedStatus ?? null,
      input.request.redactedStatus ?? null,
    );
}

function hasExplicitCanonicalCheckpointState(
  request: HostedWorkspaceCheckpointRequest,
): boolean {
  return Object.hasOwn(request, "inboxMediaRetentionWakeAt")
    && Object.hasOwn(request, "nextWakeAt")
    && Object.hasOwn(request, "nextWakeReason")
    && Object.hasOwn(request, "redactedStatus");
}

function incrementWorkspaceVersion(version: string): string | null {
  if (!/^[0-9]+$/u.test(version)) {
    return null;
  }
  return (BigInt(version) + 1n).toString();
}

function areJsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => areJsonValuesEqual(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }

  const leftKeys = Object.keys(left);
  return leftKeys.length === Object.keys(right).length
    && leftKeys.every((key) =>
      Object.hasOwn(right, key)
      && areJsonValuesEqual(left[key], right[key])
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
