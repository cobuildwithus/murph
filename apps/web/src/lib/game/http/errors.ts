import type { GameError, GameErrorCode } from "../contract";
import { GAME_ERROR_STATUS, GameRuleError } from "../rules";
import { hostedOnboardingError } from "../../hosted-onboarding/errors";

// Thrown so the shared route wrapper renders the {error:{code,message,retryable}}
// envelope with Cache-Control: no-store.
export function gameHttpError(
  code: GameErrorCode | "GAME_MEDIA_UNAVAILABLE",
  httpStatus: number,
  message: string,
  retryable = false,
  details?: Record<string, unknown>,
) {
  return hostedOnboardingError({ code, details, httpStatus, message, retryable });
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
