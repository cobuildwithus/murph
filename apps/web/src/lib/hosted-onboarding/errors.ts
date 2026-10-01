export interface HostedOnboardingErrorInput {
  code: string;
  message: string;
  httpStatus: number;
  cause?: unknown;
  details?: Record<string, unknown>;
  retryable?: boolean;
}

export class HostedOnboardingError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(input: HostedOnboardingErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "HostedOnboardingError";
    this.code = input.code;
    this.httpStatus = input.httpStatus;
    this.details = input.details;
    this.retryable = input.retryable ?? false;
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
