import {
  hostedOnboardingError,
  type HostedOnboardingErrorInput,
} from "../hosted-onboarding/errors";

export function computerUseError(input: HostedOnboardingErrorInput): Error {
  return hostedOnboardingError(input);
}

export function computerUseNotFoundError(message = "Computer run was not found."): Error {
  return computerUseError({
    code: "HOSTED_COMPUTER_NOT_FOUND",
    httpStatus: 404,
    message,
  });
}

export function computerUseConflictError(input: {
  code: string;
  message: string;
  retryable?: boolean;
}): Error {
  return computerUseError({
    code: input.code,
    httpStatus: 409,
    message: input.message,
    retryable: input.retryable ?? false,
  });
}
