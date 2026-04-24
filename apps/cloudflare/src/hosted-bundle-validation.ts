import {
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

  return message === "Hosted bundle archive is invalid."
    || message === "Hosted bundle archive kind is invalid."
    || message.startsWith("Hosted bundle archive contains ")
    || message.startsWith("Hosted bundle archive exceeds ")
    || message.startsWith("Hosted bundle kind mismatch:")
    || /^Hosted bundle .+ (?:hash|size) mismatch:/u.test(message);
}

function readHostedBundleValidationMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }

  return "Hosted bundle archive is invalid.";
}
