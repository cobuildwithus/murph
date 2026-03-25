export interface HostedOnboardingErrorInput {
  code: string;
  message: string;
  httpStatus: number;
  details?: Record<string, unknown>;
  retryable?: boolean;
}

export class HostedOnboardingError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(input: HostedOnboardingErrorInput) {
    super(input.message);
    this.name = "HostedOnboardingError";
    this.code = input.code;
    this.httpStatus = input.httpStatus;
    this.details = input.details;
    this.retryable = input.retryable ?? false;
  }
}

export function hostedOnboardingError(input: HostedOnboardingErrorInput): HostedOnboardingError {
  return new HostedOnboardingError(input);
}

export function isHostedOnboardingError(error: unknown): error is HostedOnboardingError {
  return error instanceof HostedOnboardingError;
}
