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
