export const BROWSER_VAULT_REPLICA_SCHEMA = "murph.browser-vault-replica" as const;

/**
 * Increment when a projection-shape or projection-interpretation change makes
 * an otherwise source-current browser replica incomplete for current readers.
 */
export const BROWSER_VAULT_REPLICA_CURRENT_GENERATION = 5 as const;
