export class ClinicalRecordsControlPlaneError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(input: {
    cause?: unknown;
    code: string;
    details?: Record<string, unknown>;
    httpStatus: number;
    message: string;
    retryable?: boolean;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "ClinicalRecordsControlPlaneError";
    this.code = input.code;
    this.details = input.details;
    this.httpStatus = input.httpStatus;
    this.retryable = input.retryable ?? false;
  }
}

export function clinicalRecordsError(
  input: ConstructorParameters<typeof ClinicalRecordsControlPlaneError>[0],
): ClinicalRecordsControlPlaneError {
  return new ClinicalRecordsControlPlaneError(input);
}

export function isClinicalRecordsControlPlaneError(
  value: unknown,
): value is ClinicalRecordsControlPlaneError {
  return value instanceof ClinicalRecordsControlPlaneError;
}
