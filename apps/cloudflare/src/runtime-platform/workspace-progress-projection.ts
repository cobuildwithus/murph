import type {
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";

const HOSTED_SYSTEM_PROGRESS_PROJECTION_KEYS = [
  "nextDefaultProcessingWakeAt",
  "nextDefaultProcessingWakeReason",
  "systemMailboxProgressGeneration",
] as const;

export function matchesRequestedHostedSystemProgressProjection(input: {
  request: HostedWorkspaceCheckpointRequest;
  workspace: HostedWorkspaceState;
}): boolean {
  const requestedKeys = HOSTED_SYSTEM_PROGRESS_PROJECTION_KEYS.filter((key) =>
    Object.hasOwn(input.request, key)
  );
  if (requestedKeys.length === 0) {
    return true;
  }
  if (requestedKeys.length !== HOSTED_SYSTEM_PROGRESS_PROJECTION_KEYS.length) {
    return false;
  }

  return HOSTED_SYSTEM_PROGRESS_PROJECTION_KEYS.every((key) =>
    Object.hasOwn(input.workspace, key)
    && input.workspace[key] === input.request[key]
  );
}
