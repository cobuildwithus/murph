/**
 * Signed callback request-body ceiling for the shared vault-share delivery seam.
 * Projection-specific bounds must keep their maximum legal request within this limit.
 */
export const HOSTED_VAULT_SHARE_SERIALIZED_PROJECTION_MAX_BYTES = 320 * 1024;
export const HOSTED_VAULT_SHARE_DELIVER_BODY_LIMIT_BYTES =
  HOSTED_VAULT_SHARE_SERIALIZED_PROJECTION_MAX_BYTES;
