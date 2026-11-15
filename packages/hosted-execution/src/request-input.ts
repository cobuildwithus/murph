import { ContractValidationError } from "@murphai/contracts/validation-error";

export class RequestInputError extends Error {
  override name = "RequestInputError";
}

// Plan 2026-11-14-explicit-request-rejection.md retains RangeError for native
// 400 inference in unmigrated consumers (including runner outbound parsers).
// Remove this base in stage 6 once those consumers recognize explicit rejections.
export class RequestBodyTooLargeError extends RangeError {
  constructor(limitBytes: number) {
    super(`Request body exceeded ${limitBytes} bytes.`);
  }
}

export function isRequestInputError(error: unknown): error is RequestInputError {
  return error instanceof RequestInputError;
}

export function parseInput<T>(value: unknown, parser: (value: unknown) => T): T {
  try {
    return parser(value);
  } catch (error) {
    if (error instanceof ContractValidationError) {
      throw new RequestInputError(error.message, { cause: error });
    }
    throw error;
  }
}
