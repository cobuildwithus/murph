import { commandHostedRuntimeOwner } from "./runtime-owner-client.ts";

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

/** The destination still validates its own authority. Never retry a stale
 * request against the other backend. The disabled legacy deployment remains
 * fenced by ensure-processing and each migrated object's durable freeze.
 */
export async function usesPostgresRuntimeOwner(
  source: Readonly<Record<string, unknown>>,
  userId: string,
): Promise<boolean> {
  if (!supportsPostgresRuntimeOwner(source)) return false;
  const state = await commandHostedRuntimeOwner({ source, userId, command: { operation: "reconcile" } });
  if (state.cutover === "draining") throw new HostedRuntimeMemberMigratingError();
  return state.cutover === "postgres";
}
