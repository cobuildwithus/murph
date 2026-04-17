import type { HostedExecutionDispatchLifecycleState } from "@murphai/hosted-execution";

export type HostedWakeDrainState = HostedExecutionDispatchLifecycleState | "quarantined";

export function shouldAdvanceHostedWakeCursor(
  state: HostedWakeDrainState,
): boolean {
  return state === "completed"
    || state === "poisoned"
    || state === "quarantined";
}
