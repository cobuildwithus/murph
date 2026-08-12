/**
 * Signed callback request-body ceiling for the shared vault-share delivery seam.
 * Projection-specific bounds must keep their maximum legal request within this limit.
 */
export const HOSTED_VAULT_SHARE_DELIVER_BODY_LIMIT_BYTES = 19 * 1024;

/** Maximum active share generations one signed callback may attempt. */
export const HOSTED_VAULT_SHARE_DELIVER_MAX_SHARES_PER_PAGE = 32;
