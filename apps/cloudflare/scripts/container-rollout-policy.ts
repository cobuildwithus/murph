import { normalizeOptionalString } from "./deploy-automation/shared.ts";

export type ContainerRolloutMode = "gradual" | "immediate" | "worker-only";

export const CONTAINER_ROLLOUT_MODE_ERROR = "HOSTED_EXECUTION_CONTAINER_ROLLOUT must be 'gradual', 'immediate', or 'worker-only'.";

/** Compatible image releases roll gradually; migrations select immediate explicitly. */
export function readContainerRolloutMode(value: string | undefined): ContainerRolloutMode {
  const mode = normalizeOptionalString(value) ?? "gradual";
  if (mode === "gradual" || mode === "immediate" || mode === "worker-only") return mode;
  throw new Error(CONTAINER_ROLLOUT_MODE_ERROR);
}
