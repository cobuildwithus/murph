/** Temporary fleet-wide deployment bridge. Deploy enabled while the durable
 * Web gate is draining, then activate Postgres after inventory/import proof.
 * Remove this switch with the frozen legacy namespace after its rollback window.
 */
export function usesPostgresRuntimeOwner(source: Readonly<Record<string, unknown>>): boolean {
  const value = source.HOSTED_RUNTIME_POSTGRES_ENABLED;
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new TypeError("HOSTED_RUNTIME_POSTGRES_ENABLED must be true or false.");
}
