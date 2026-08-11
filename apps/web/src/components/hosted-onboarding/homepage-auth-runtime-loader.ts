import type { HostedAuthRuntime } from "./hosted-auth-runtime";

export type HomepageAuthRuntimeComponent = typeof HostedAuthRuntime;

export async function loadHomepageAuthRuntime(): Promise<HomepageAuthRuntimeComponent> {
  const runtimeModule = await import("./hosted-auth-runtime");
  return runtimeModule.HostedAuthRuntime;
}
