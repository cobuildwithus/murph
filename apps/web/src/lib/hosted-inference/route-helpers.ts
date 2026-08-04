import {
  HostedInferenceConnectionError,
} from "./connection-store";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

export function mapHostedInferenceConnectionError(
  error: unknown,
): unknown {
  if (!(error instanceof HostedInferenceConnectionError)) {
    return error;
  }
  return hostedOnboardingError({
    cause: error,
    code: error.code,
    httpStatus: hostedInferenceConnectionErrorStatus(error),
    message: error.message,
  });
}

function hostedInferenceConnectionErrorStatus(
  error: HostedInferenceConnectionError,
): number {
  switch (error.code) {
    case "HOSTED_INFERENCE_CONNECTION_CONFLICT":
      return 409;
    case "HOSTED_INFERENCE_CONNECTION_NOT_FOUND":
      return 404;
    case "HOSTED_INFERENCE_CONNECTION_REVERIFICATION_REQUIRED":
      return 409;
    case "HOSTED_INFERENCE_PERSONAL_CHAT_REQUIRED":
      return 403;
    case "HOSTED_MEMBER_NOT_FOUND":
      return 403;
  }
}
