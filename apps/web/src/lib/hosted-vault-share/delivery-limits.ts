import {
  HOSTED_VAULT_SHARE_SERIALIZED_PROJECTION_MAX_BYTES,
} from "@murphai/hosted-execution/vault-share";

/**
 * Signed callback request-body ceiling for the shared vault-share delivery seam.
 * Projection-specific bounds must keep their maximum legal request within this limit.
 */
export { HOSTED_VAULT_SHARE_SERIALIZED_PROJECTION_MAX_BYTES };
export const HOSTED_VAULT_SHARE_DELIVER_BODY_LIMIT_BYTES =
  HOSTED_VAULT_SHARE_SERIALIZED_PROJECTION_MAX_BYTES;

/**
 * Maximum destination snapshots materialized by one Web delivery request.
 * Larger exact-scope cohorts continue through an opaque destination cursor.
 */
export const HOSTED_VAULT_SHARE_DELIVER_MAX_SHARES_PER_PAGE = 25;

export const HOSTED_VAULT_SHARE_DELIVER_PAGE_READ_LIMIT =
  HOSTED_VAULT_SHARE_DELIVER_MAX_SHARES_PER_PAGE + 1;
