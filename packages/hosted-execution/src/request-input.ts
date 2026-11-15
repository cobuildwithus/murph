import { ContractValidationError } from "@murphai/contracts/validation-error";

export class RequestInputError extends Error {
  override name = "RequestInputError";
}

export class RequestBodyTooLargeError extends Error {
  constructor(limitBytes: number, message = `Request body exceeded ${limitBytes} bytes.`) {
    super(message);
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
