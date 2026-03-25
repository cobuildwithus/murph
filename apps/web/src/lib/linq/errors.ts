export class HostedLinqError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(input: {
    code: string;
    message: string;
    httpStatus?: number;
    retryable?: boolean;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = "HostedLinqError";
    this.code = input.code;
    this.httpStatus = input.httpStatus ?? 500;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
  }
}

export function hostedLinqError(input: {
  code: string;
  message: string;
  httpStatus?: number;
  retryable?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
}): HostedLinqError {
  return new HostedLinqError(input);
}

export function isHostedLinqError(error: unknown): error is HostedLinqError {
  return error instanceof HostedLinqError;
}
