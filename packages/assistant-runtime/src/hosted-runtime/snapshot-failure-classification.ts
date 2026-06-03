const HOSTED_BUNDLE_ARCHIVE_VALIDATION_ERROR_CODE =
  "bundle_archive_validation_error";

type HostedBundleArchiveValidationOperation = "runner-output";
type HostedBundleArchiveValidationCause =
  | "archive_invalid"
  | "artifact_integrity"
  | "duplicate_file_entries"
  | "invalid_artifact_metadata"
  | "invalid_file_entry"
  | "invalid_file_path"
  | "invalid_inline_file_contents"
  | "invalid_root"
  | "kind_invalid"
  | "payload_invalid"
  | "size_limit";

class HostedBundleArchiveValidationError extends Error {
  readonly code = HOSTED_BUNDLE_ARCHIVE_VALIDATION_ERROR_CODE;
  readonly operation: HostedBundleArchiveValidationOperation;
  readonly refHash: string | null;
  readonly refKeyPresent: boolean;
  readonly refSize: number | null;
  readonly validationCause: HostedBundleArchiveValidationCause;
  readonly validationMessage: string;

  constructor(input: {
    cause: unknown;
    operation: HostedBundleArchiveValidationOperation;
  }) {
    const validation = readHostedBundleValidationClassification(input.cause);
    super(validation.message, {
      cause: input.cause,
    });
    this.name = "HostedBundleArchiveValidationError";
    this.operation = input.operation;
    this.refHash = null;
    this.refKeyPresent = false;
    this.refSize = null;
    this.validationCause = validation.cause;
    this.validationMessage = validation.message;
  }
}

export interface HostedBundleArchiveValidationErrorDetails {
  operation: HostedBundleArchiveValidationOperation;
  refHash: string | null;
  refKeyPresent: boolean;
  refSize: number | null;
  validationCause: HostedBundleArchiveValidationCause | null;
  validationMessage: string | null;
}

export function classifyHostedWorkspaceSnapshotFailure(error: unknown): unknown {
  if (
    readHostedBundleArchiveValidationErrorDetails(error) !== null
    || !isHostedBundleArchiveValidationFailure(error)
  ) {
    return error;
  }

  return new HostedBundleArchiveValidationError({
    cause: error,
    operation: "runner-output",
  });
}

export function readHostedBundleArchiveValidationErrorDetails(
  error: unknown,
): HostedBundleArchiveValidationErrorDetails | null {
  if (error instanceof HostedBundleArchiveValidationError) {
    return {
      operation: error.operation,
      refHash: error.refHash,
      refKeyPresent: error.refKeyPresent,
      refSize: error.refSize,
      validationCause: error.validationCause,
      validationMessage: error.validationMessage,
    };
  }

  if (readHostedBundleValidationErrorCode(error) !== HOSTED_BUNDLE_ARCHIVE_VALIDATION_ERROR_CODE) {
    return null;
  }

  const details = readHostedBundleValidationRecord(error, "details")
    ?? readHostedBundleValidationRecord(error, "context");
  const operation = readHostedBundleValidationOperation(
    details?.bundleArchiveOperation ?? details?.operation,
  );

  if (!operation) {
    return null;
  }

  return {
    operation,
    refHash: readHostedBundleValidationString(
      details?.bundleRefHash ?? details?.refHash,
    ),
    refKeyPresent: readHostedBundleValidationRefKeyPresent(details),
    refSize: readHostedBundleValidationNumber(
      details?.bundleRefSize ?? details?.refSize,
    ),
    validationCause: readHostedBundleArchiveValidationCause(
      details?.bundleArchiveValidationCause ?? details?.validationCause,
    ),
    validationMessage: readHostedBundleValidationString(
      details?.bundleArchiveValidationMessage ?? details?.validationMessage,
    ),
  };
}

function isHostedBundleArchiveValidationFailure(error: unknown): boolean {
  if (error instanceof HostedBundleArchiveValidationError) {
    return true;
  }

  if (readHostedBundleArchiveValidationErrorDetails(error)) {
    return true;
  }

  const message = error instanceof Error ? error.message : "";

  return message === "Hosted bundle payload must be valid base64."
    || message === "Hosted bundle archive is invalid."
    || message === "Hosted bundle archive kind is invalid."
    || message.startsWith("Hosted bundle archive contains ")
    || message.startsWith("Hosted bundle archive exceeds ")
    || message === "Hosted bundle path is invalid."
    || message === "Hosted bundle root is invalid."
    || message.startsWith("Hosted bundle artifact ")
    || message.startsWith("Hosted bundle kind mismatch:")
    || /^Hosted bundle .+ (?:hash|size) mismatch:/u.test(message);
}

const HOSTED_BUNDLE_ARCHIVE_VALIDATION_CAUSE_SET = new Set<string>([
  "archive_invalid",
  "artifact_integrity",
  "duplicate_file_entries",
  "invalid_artifact_metadata",
  "invalid_file_entry",
  "invalid_file_path",
  "invalid_inline_file_contents",
  "invalid_root",
  "kind_invalid",
  "payload_invalid",
  "size_limit",
]);

function readHostedBundleArchiveValidationCause(
  value: unknown,
): HostedBundleArchiveValidationCause | null {
  return typeof value === "string" && HOSTED_BUNDLE_ARCHIVE_VALIDATION_CAUSE_SET.has(value)
    ? value as HostedBundleArchiveValidationCause
    : null;
}

function readHostedBundleValidationErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  return readHostedBundleValidationString(
    (error as { code?: unknown; errorCode?: unknown }).code
      ?? (error as { code?: unknown; errorCode?: unknown }).errorCode,
  );
}

function readHostedBundleValidationRecord(
  error: unknown,
  key: "context" | "details",
): Record<string, unknown> | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const value = (error as { context?: unknown; details?: unknown })[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readHostedBundleValidationOperation(
  value: unknown,
): HostedBundleArchiveValidationOperation | null {
  return value === "runner-output" ? value : null;
}

function readHostedBundleValidationString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readHostedBundleValidationNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readHostedBundleValidationRefKeyPresent(
  details: Record<string, unknown> | null | undefined,
): boolean {
  if (!details) {
    return false;
  }

  if (details.bundleRefKeyPresent === true || details.refKeyPresent === true) {
    return true;
  }

  return readHostedBundleValidationString(details.bundleRefKey ?? details.refKey) !== null;
}

function readHostedBundleValidationClassification(cause: unknown): {
  cause: HostedBundleArchiveValidationCause;
  message: string;
} {
  const message = cause instanceof Error ? cause.message : "";

  if (message.length === 0) {
    return {
      cause: "archive_invalid",
      message: "Hosted bundle archive is invalid.",
    };
  }

  if (message === "Hosted bundle payload must be valid base64.") {
    return {
      cause: "payload_invalid",
      message: "Hosted bundle archive payload is invalid.",
    };
  }

  if (
    message === "Hosted bundle archive kind is invalid."
    || message.startsWith("Hosted bundle kind mismatch:")
  ) {
    return {
      cause: "kind_invalid",
      message: "Hosted bundle archive kind is invalid.",
    };
  }

  if (message.startsWith("Hosted bundle archive exceeds ")) {
    return {
      cause: "size_limit",
      message,
    };
  }

  if (message === "Hosted bundle path is invalid.") {
    return {
      cause: "invalid_file_path",
      message: "Hosted bundle archive contains an invalid file path.",
    };
  }

  if (message === "Hosted bundle root is invalid.") {
    return {
      cause: "invalid_root",
      message: "Hosted bundle archive contains an invalid root.",
    };
  }

  if (message.startsWith("Hosted bundle archive contains duplicate file")) {
    return {
      cause: "duplicate_file_entries",
      message: "Hosted bundle archive contains duplicate file entries.",
    };
  }

  return {
    cause: "archive_invalid",
    message,
  };
}
