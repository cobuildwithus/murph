import type { HostedWakeLifecycleState } from "@murphai/hosted-execution";

export type HostedWakeDrainState = HostedWakeLifecycleState | "quarantined";

export function shouldAdvanceHostedWakeCursor(
  state: HostedWakeDrainState,
): boolean {
  return state === "completed"
    || state === "poisoned"
    || state === "quarantined";
}
