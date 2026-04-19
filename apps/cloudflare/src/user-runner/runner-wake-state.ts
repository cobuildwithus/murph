import type { HostedWakeLifecycleState } from "@murphai/hosted-execution";

export type HostedWakeDrainState = HostedWakeLifecycleState;

export function shouldAdvanceHostedWakeCursor(
  state: HostedWakeDrainState,
): boolean {
  return state === "completed"
    || state === "quarantined";
}
