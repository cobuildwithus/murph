/** Deployment capability, never a member's backend selection. Enabling this
 * allows mixed ownership without pausing members still running on legacy.
 */
export function supportsPostgresRuntimeOwner(source: Readonly<Record<string, unknown>>): boolean {
  const value = source.HOSTED_RUNTIME_POSTGRES_ENABLED;
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new TypeError("HOSTED_RUNTIME_POSTGRES_ENABLED must be true or false.");
}

export class HostedRuntimeMemberMigratingError extends Error {
  constructor() {
    super("This member is completing a runtime handoff.");
    this.name = "HostedRuntimeMemberMigratingError";
  }
}
