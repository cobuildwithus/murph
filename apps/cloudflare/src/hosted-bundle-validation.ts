import {
  decodeHostedBundleBase64,
  listHostedBundleArtifacts,
  type HostedExecutionBundleKind,
} from "@murphai/runtime-state/node/hosted-bundle-codec";
import type {
  HostedExecutionBundleRef,
} from "@murphai/hosted-execution/contracts";

export const HOSTED_BUNDLE_ARCHIVE_VALIDATION_ERROR_CODE =
  "bundle_archive_validation_error";

export type HostedBundleArchiveValidationOperation =
  | "cleanup-authoritative-next"
  | "runner-input"
  | "runner-output";

export class HostedBundleArchiveValidationError extends Error {
  readonly code = HOSTED_BUNDLE_ARCHIVE_VALIDATION_ERROR_CODE;
  readonly details: {
    bundleArchiveOperation: HostedBundleArchiveValidationOperation;
    bundleRefHash: string | null;
    bundleRefKey: string | null;
    bundleRefPresent: boolean;
    bundleRefSize: number | null;
  };
  readonly operation: HostedBundleArchiveValidationOperation;
  readonly refHash: string | null;
  readonly refKey: string | null;
  readonly refSize: number | null;

  constructor(input: {
    cause: unknown;
    operation: HostedBundleArchiveValidationOperation;
    ref?: HostedExecutionBundleRef | null;
  }) {
    super(readHostedBundleValidationMessage(input.cause), {
      cause: input.cause,
    });
    this.name = "HostedBundleArchiveValidationError";
    this.operation = input.operation;
    this.refHash = input.ref?.hash ?? null;
    this.refKey = input.ref?.key ?? null;
    this.refSize = input.ref?.size ?? null;
    this.details = {
      bundleArchiveOperation: input.operation,
      bundleRefHash: this.refHash,
      bundleRefKey: this.refKey,
      bundleRefPresent: input.ref !== null && input.ref !== undefined,
      bundleRefSize: this.refSize,
    };
  }
}

export interface HostedBundleArchiveValidationErrorDetails {
  operation: HostedBundleArchiveValidationOperation;
  refHash: string | null;
  refKey: string | null;
  refSize: number | null;
}

export function assertHostedBundleArchiveValid(input: {
  bytes: Uint8Array | ArrayBuffer | null;
  expectedKind: HostedExecutionBundleKind;
  operation: HostedBundleArchiveValidationOperation;
  ref?: HostedExecutionBundleRef | null;
}): void {
  if (!input.bytes) {
    return;
  }

  try {
    listHostedBundleArtifacts({
      bytes: input.bytes,
      expectedKind: input.expectedKind,
    });
  } catch (error) {
    if (isHostedBundleArchiveValidationFailure(error)) {
      throw new HostedBundleArchiveValidationError({
        cause: error,
        operation: input.operation,
        ref: input.ref ?? null,
      });
    }

    throw error;
  }
}

export function assertHostedBundlePayloadArchiveValid(input: {
  bundle: string | null;
  expectedKind: HostedExecutionBundleKind;
  operation: HostedBundleArchiveValidationOperation;
  ref?: HostedExecutionBundleRef | null;
}): void {
  let bytes: Uint8Array | null;

  try {
    bytes = decodeHostedBundleBase64(input.bundle);
  } catch (error) {
    if (isHostedBundleArchiveValidationFailure(error)) {
      throw new HostedBundleArchiveValidationError({
        cause: error,
        operation: input.operation,
        ref: input.ref ?? null,
      });
    }

    throw error;
  }

  assertHostedBundleArchiveValid({
    bytes,
    expectedKind: input.expectedKind,
    operation: input.operation,
    ref: input.ref ?? null,
  });
}

export function isHostedBundleArchiveValidationError(
  error: unknown,
): error is HostedBundleArchiveValidationError {
  return error instanceof HostedBundleArchiveValidationError;
}

export function readHostedBundleArchiveValidationErrorDetails(
  error: unknown,
): HostedBundleArchiveValidationErrorDetails | null {
  if (error instanceof HostedBundleArchiveValidationError) {
    return {
      operation: error.operation,
      refHash: error.refHash,
      refKey: error.refKey,
      refSize: error.refSize,
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
    refHash: readHostedBundleValidationString(details?.bundleRefHash ?? details?.refHash),
    refKey: readHostedBundleValidationString(details?.bundleRefKey ?? details?.refKey),
    refSize: readHostedBundleValidationNumber(details?.bundleRefSize ?? details?.refSize),
  };
}

export function isHostedBundleArchiveValidationFailure(error: unknown): boolean {
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
  return value === "cleanup-authoritative-next"
      || value === "runner-input"
      || value === "runner-output"
    ? value
    : null;
}

function readHostedBundleValidationString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readHostedBundleValidationNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readHostedBundleValidationMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "";

  if (message.length === 0) {
    return "Hosted bundle archive is invalid.";
  }

  if (message === "Hosted bundle payload must be valid base64.") {
    return "Hosted bundle archive payload is invalid.";
  }

  if (message === "Hosted bundle archive is invalid.") {
    return message;
  }

  if (
    message === "Hosted bundle archive kind is invalid."
    || message.startsWith("Hosted bundle kind mismatch:")
  ) {
    return "Hosted bundle archive kind is invalid.";
  }

  if (message.startsWith("Hosted bundle archive exceeds ")) {
    return message;
  }

  if (message === "Hosted bundle path is invalid.") {
    return "Hosted bundle archive contains an invalid file path.";
  }

  if (message === "Hosted bundle root is invalid.") {
    return "Hosted bundle archive contains an invalid root.";
  }

  if (message.startsWith("Hosted bundle archive contains duplicate file")) {
    return "Hosted bundle archive contains duplicate file entries.";
  }

  if (
    message === "Hosted bundle archive contains invalid artifact metadata."
    || message === "Hosted bundle archive contains invalid inline file contents."
    || message === "Hosted bundle archive contains an invalid file entry."
  ) {
    return message;
  }

  if (message.startsWith("Hosted bundle artifact ")) {
    return "Hosted bundle artifact integrity validation failed.";
  }

  return "Hosted bundle archive is invalid.";
}
