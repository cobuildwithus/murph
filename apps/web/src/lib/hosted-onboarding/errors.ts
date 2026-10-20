export interface HostedOnboardingErrorInput {
  code: string;
  message: string;
  httpStatus: number;
  cause?: unknown;
  details?: Record<string, unknown>;
  retryable?: boolean;
  linqRouteAuthorityMismatchReason?: HostedLinqRouteAuthorityMismatchReason;
}

export class HostedOnboardingError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;
  readonly linqRouteAuthorityMismatchReason?: HostedLinqRouteAuthorityMismatchReason;

  constructor(input: HostedOnboardingErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "HostedOnboardingError";
    this.code = input.code;
    this.httpStatus = input.httpStatus;
    this.details = input.details;
    this.retryable = input.retryable ?? false;
    this.linqRouteAuthorityMismatchReason = input.linqRouteAuthorityMismatchReason;
  }
}

const HOSTED_AUTH_MIGRATION_CONFLICT_REASONS = [
  "member_missing",
  "provider_binding_mismatch",
  "verified_credential_missing",
  "source_snapshot_changed",
  "credential_binding_mismatch",
  "credential_not_in_projection",
  "pending_contact_ambiguous",
  "invite_member_mismatch",
  "invite_not_pristine",
  "legacy_binding_present",
  "login_projection_missing",
  "prepared_state_changed",
] as const;

export type HostedAuthMigrationConflictReason =
  (typeof HOSTED_AUTH_MIGRATION_CONFLICT_REASONS)[number];

export class HostedAuthMigrationConflictError extends HostedOnboardingError {
  constructor(readonly reconciliationReason?: HostedAuthMigrationConflictReason) {
    super({ code: "AUTH_IDENTITY_RECONCILIATION_REQUIRED", httpStatus: 409, message: "Authentication identity needs reconciliation before migration." });
    this.name = "HostedAuthMigrationConflictError";
  }
}

export function getHostedAuthMigrationConflictReasonForLog(
  error: unknown,
): HostedAuthMigrationConflictReason | undefined {
  if (!(error instanceof HostedAuthMigrationConflictError)) return undefined;
  // Read only this diagnostic's data property; never invoke getters or coerce values.
  const reason: unknown = Object.getOwnPropertyDescriptor(error, "reconciliationReason")?.value;
  return HOSTED_AUTH_MIGRATION_CONFLICT_REASONS.find((allowed) => allowed === reason);
}

const HOSTED_LINQ_ROUTE_AUTHORITY_MISMATCH_REASONS = [
  "durable_thread_container_mismatch",
  "durable_target_missing",
  "requested_target_missing",
  "member_routing_missing",
  "target_not_owned",
  "route_projection_mismatch",
  "route_projection_chat_missing",
  "route_projection_chat_lookup_key_missing",
  "route_projection_chat_lookup_key_mismatch",
  "route_projection_sender_phone_missing_or_invalid",
  "route_projection_sender_lookup_key_mismatch",
  "pending_recipient_invalid",
  "member_identity_missing",
  "member_recipient_invalid",
] as const;

export type HostedLinqRouteAuthorityMismatchReason =
  (typeof HOSTED_LINQ_ROUTE_AUTHORITY_MISMATCH_REASONS)[number];

export function getHostedLinqRouteAuthorityMismatchReasonForLog(
  error: unknown,
): HostedLinqRouteAuthorityMismatchReason | undefined {
  if (!(error instanceof HostedOnboardingError)) return undefined;
  // Match this owner and read only data properties; never invoke getters or coerce values.
  if (
    Object.getOwnPropertyDescriptor(error, "code")?.value !== "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH"
    || Object.getOwnPropertyDescriptor(error, "message")?.value !== "Linq egress target does not match the runtime user's Linq route."
  ) return undefined;
  const reason: unknown = Object.getOwnPropertyDescriptor(error, "linqRouteAuthorityMismatchReason")?.value;
  return HOSTED_LINQ_ROUTE_AUTHORITY_MISMATCH_REASONS.find((allowed) => allowed === reason);
}

export const HOSTED_STRIPE_EFFECT_PENDING_ERROR_CODE =
  "HOSTED_STRIPE_EFFECT_PENDING";
export const HOSTED_STRIPE_EFFECT_PENDING_MESSAGE =
  "Billing is already changing. Try again shortly.";
export const HOSTED_STRIPE_EFFECT_PENDING_VISIBLE_REASON =
  "stripe-effect-pending";

export function hostedOnboardingError(input: HostedOnboardingErrorInput): HostedOnboardingError {
  return new HostedOnboardingError(input);
}

export function isHostedOnboardingError(error: unknown): error is HostedOnboardingError {
  return error instanceof HostedOnboardingError;
}

export function isHostedStripeEffectPendingError(
  error: unknown,
): error is HostedOnboardingError {
  return isHostedOnboardingError(error)
    && error.code === HOSTED_STRIPE_EFFECT_PENDING_ERROR_CODE;
}
