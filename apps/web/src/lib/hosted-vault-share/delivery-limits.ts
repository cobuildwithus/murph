/**
 * Signed callback request-body ceiling for the shared vault-share delivery seam.
 * Projection-specific bounds must keep their maximum legal request within this limit.
 */
export const HOSTED_VAULT_SHARE_DELIVER_BODY_LIMIT_BYTES = 19 * 1024;

// Every production grant passes through the exact grantor/scope owner that
// serializes and enforces this limit. Delivery reads one extra row only to
// detect invariant corruption and fail closed instead of truncating it.
export const HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_PER_GRANTOR_PROJECTION = 25;
export const HOSTED_VAULT_SHARE_DELIVER_INVARIANT_READ_LIMIT =
  HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_PER_GRANTOR_PROJECTION + 1;
