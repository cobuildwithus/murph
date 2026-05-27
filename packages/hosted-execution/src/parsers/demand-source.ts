import {
  HOSTED_RUNTIME_DEMAND_RUN_SOURCES,
  type HostedRuntimeDemandRunSource,
} from "../orchestration-control.ts";
import {
  requireString,
} from "./assertions.ts";

export function parseHostedRuntimeDemandRunSource(
  value: unknown,
  label: string,
): HostedRuntimeDemandRunSource {
  const source = requireString(value, label);
  if (HOSTED_RUNTIME_DEMAND_RUN_SOURCES.includes(source as HostedRuntimeDemandRunSource)) {
    return source as HostedRuntimeDemandRunSource;
  }
  throw new TypeError(`${label} is not supported.`);
}
