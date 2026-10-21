import type { RunnerOutboundEnvironmentSource } from "./runner-outbound/shared.ts";

export interface RuntimeProviderCaller {
  containerId?: string;
  className?: string;
}

/** These coordinates come from ContainerProxy props, never request headers. */
export function readNativeRuntimeProviderContainer(
  env: RunnerOutboundEnvironmentSource, caller: RuntimeProviderCaller | undefined,
) {
  if (!caller?.containerId) return null;
  const namespace = caller.className === "RunnerContainer" ? env.RUNNER_CONTAINER
    : caller.className === "NextRunnerContainer" ? env.NEXT_RUNNER_CONTAINER
    : caller.className === "StandbyRunnerContainer" ? env.STANDBY_RUNNER_CONTAINER
    : caller.className === "SmallRunnerContainer" ? env.SMALL_RUNNER_CONTAINER : null;
  if (!namespace?.idFromString || !namespace.get) return null;
  return namespace.get(namespace.idFromString(caller.containerId));
}

export async function readNativeRuntimeProviderAuthority(
  env: RunnerOutboundEnvironmentSource, caller: RuntimeProviderCaller | undefined,
) {
  return await readNativeRuntimeProviderContainer(env, caller)?.readProviderAuthority?.() ?? null;
}
