import {
  decodeHostedBundleBase64,
  listHostedBundleArtifacts,
  type HostedExecutionBundleKind,
} from "@murphai/runtime-state/node/hosted-bundle-codec";
import type {
  HostedExecutionBundleRef,
} from "@murphai/hosted-execution/contracts";

export type HostedBundleArchiveValidationOperation =
  | "cleanup-authoritative-next"
  | "runner-input"
  | "runner-output";

export class HostedBundleArchiveValidationError extends Error {
  readonly operation: HostedBundleArchiveValidationOperation;
  readonly refKey: string | null;

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
    this.refKey = input.ref?.key ?? null;
  }
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

export function isHostedBundleArchiveValidationFailure(error: unknown): boolean {
  if (error instanceof HostedBundleArchiveValidationError) {
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
