import type { RunnerOutboundEnvironmentSource } from "./runner-outbound/shared.ts";
import { readHostedRunnerBankFromName } from "./hosted-runner-release.ts";
import { isHostedStandbySlotName, HOSTED_STANDBY_LOCATION_HINT } from "./standby-runner-contract.ts";

/** Resolve the persisted physical target, including legacy standby banks. */
export function readRuntimeTargetAdapter(source: RunnerOutboundEnvironmentSource, target: string) {
  if (readHostedRunnerBankFromName(target) === "next") return source.NEXT_RUNNER_CONTAINER?.getByName?.(target) ?? null;
  if (isHostedStandbySlotName(target)) return source.STANDBY_RUNNER_CONTAINER?.getByName(target, { locationHint: HOSTED_STANDBY_LOCATION_HINT }) ?? null;
  return source.RUNNER_CONTAINER?.getByName?.(target) ?? null;
}
