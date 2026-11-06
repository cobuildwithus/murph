import type { GameError, GameErrorCode } from "../contract";
import { GAME_ERROR_STATUS, GameRuleError } from "../rules";
import { hostedOnboardingError, isHostedOnboardingError } from "../../hosted-onboarding/errors";

// Thrown so the shared route wrapper renders the {error:{code,message,retryable}}
// envelope with Cache-Control: no-store.
export function gameHttpError(
  code: GameErrorCode,
  httpStatus: number,
  message: string,
  retryable = false,
  details?: Record<string, unknown>,
) {
  return hostedOnboardingError({ code, details, httpStatus, message, retryable });
}

export function gameMediaUnavailable(cause?: unknown) {
  return hostedOnboardingError({ code: "GAME_MEDIA_UNAVAILABLE", httpStatus: 503,
    message: "Game media isn't available here yet.", retryable: true, cause });
}

/** Unexpected failures after input parsing must keep the native client's pending write. */
export async function withGameServiceFailures<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isHostedOnboardingError(error)) {
      if (error.httpStatus < 500 || error.retryable) throw error;
      throw hostedOnboardingError({ code: error.code, httpStatus: error.httpStatus,
        message: error.message, details: error.details, retryable: true, cause: error });
    }
    throw hostedOnboardingError({ code: "INTERNAL_ERROR", httpStatus: 500,
      message: "Internal error.", retryable: true, cause: error });
  }
}

export function gameCommandError(error: GameError, httpStatus: number) {
  return gameHttpError(error.code, httpStatus, error.message, error.retryable ?? false);
}

export function invalidGameRequest(message: string) {
  return gameHttpError("INVALID_REQUEST", 400, message);
}

export function gameNotFound() {
  return gameHttpError("GAME_NOT_FOUND", 404, "That game isn't available.");
}

/** For service calls that throw rule errors instead of returning a result. */
export async function withGameRuleErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof GameRuleError) throw gameCommandError(error.error, GAME_ERROR_STATUS[error.error.code]);
    throw error;
  }
}
