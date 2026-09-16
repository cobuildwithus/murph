import { HOSTED_RUNTIME_ROLLING_PROTOCOL, HOSTED_RUNTIME_NAMESPACE_PROBE_NAME, type HostedRuntimeMigrationCompatibility } from "@murphai/hosted-execution/runtime-migration";

/** Derived locally from the actual bound namespace. Never obtain a stub or
 * create an object; callers cannot supply a substitute namespace fingerprint.
 */
export function readRuntimeMigrationCompatibility(source: Readonly<Record<string, unknown>>): HostedRuntimeMigrationCompatibility {
  const namespace = source.USER_RUNNER;
  if (!namespace || typeof namespace !== "object" || !("idFromName" in namespace) || typeof namespace.idFromName !== "function") {
    throw new Error("Compatible runtime migration requires namespace addressing.");
  }
  const namespaceProbeId = String(namespace.idFromName(HOSTED_RUNTIME_NAMESPACE_PROBE_NAME));
  if (!/^[a-f0-9]{64}$/u.test(namespaceProbeId)) throw new Error("Runtime migration namespace binding is invalid.");
  return { protocol: HOSTED_RUNTIME_ROLLING_PROTOCOL, namespaceProbeId };
}
