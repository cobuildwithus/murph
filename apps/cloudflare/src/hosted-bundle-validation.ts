import {
  decodeHostedBundleBase64,
  HOSTED_BUNDLE_SCHEMA,
  listHostedBundleArtifacts as listHostedBundleArtifactsNode,
  type HostedBundleArtifactLocation,
  type HostedExecutionBundleKind,
} from "@murphai/runtime-state/node/hosted-bundle-codec";
import type {
  HostedExecutionBundleRef,
} from "@murphai/hosted-execution/contracts";

export const HOSTED_BUNDLE_ARCHIVE_VALIDATION_ERROR_CODE =
  "bundle_archive_validation_error";
const MAX_HOSTED_BUNDLE_ARCHIVE_COMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_HOSTED_BUNDLE_ARCHIVE_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;
const MAX_HOSTED_BUNDLE_ARCHIVE_FILE_COUNT = 50_000;
const MAX_HOSTED_BUNDLE_PATH_LENGTH = 4_096;
const MAX_HOSTED_BUNDLE_ROOT_LENGTH = 256;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const WINDOWS_DRIVE_PREFIX_PATTERN = /^[A-Za-z]:/;
const hostedBundleTextDecoder = new TextDecoder();

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
    listHostedBundleArtifactsNode({
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

export async function assertHostedBundleArchiveValidAsync(input: {
  bytes: Uint8Array | ArrayBuffer | null;
  expectedKind: HostedExecutionBundleKind;
  operation: HostedBundleArchiveValidationOperation;
  ref?: HostedExecutionBundleRef | null;
}): Promise<void> {
  if (!input.bytes) {
    return;
  }

  try {
    await listHostedBundleArtifactsAsync({
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

export async function assertHostedBundlePayloadArchiveValidAsync(input: {
  bundle: string | null;
  expectedKind: HostedExecutionBundleKind;
  operation: HostedBundleArchiveValidationOperation;
  ref?: HostedExecutionBundleRef | null;
}): Promise<void> {
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

  await assertHostedBundleArchiveValidAsync({
    bytes,
    expectedKind: input.expectedKind,
    operation: input.operation,
    ref: input.ref ?? null,
  });
}

export async function listHostedBundleArtifactsAsync(input: {
  bytes: Uint8Array | ArrayBuffer | null;
  expectedKind: HostedExecutionBundleKind;
}): Promise<HostedBundleArtifactLocation[]> {
  if (!input.bytes) {
    return [];
  }

  return parseHostedBundleArchiveForValidation(input.bytes, input.expectedKind);
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

async function parseHostedBundleArchiveForValidation(
  bytes: Uint8Array | ArrayBuffer,
  expectedKind: HostedExecutionBundleKind,
): Promise<HostedBundleArtifactLocation[]> {
  const compressed = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;

  if (compressed.byteLength > MAX_HOSTED_BUNDLE_ARCHIVE_COMPRESSED_BYTES) {
    throw new Error(
      `Hosted bundle archive exceeds the ${MAX_HOSTED_BUNDLE_ARCHIVE_COMPRESSED_BYTES} byte compressed size limit.`,
    );
  }

  if (typeof DecompressionStream !== "function") {
    return listHostedBundleArtifactsNode({
      bytes: compressed,
      expectedKind,
    });
  }

  const uncompressed = await gunzipHostedBundleArchive(compressed);
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(hostedBundleTextDecoder.decode(uncompressed)) as Record<string, unknown>;
  } catch {
    throw new Error("Hosted bundle archive is invalid.");
  }

  if (parsed.schema !== HOSTED_BUNDLE_SCHEMA || !Array.isArray(parsed.files)) {
    throw new Error("Hosted bundle archive is invalid.");
  }

  if (!isHostedExecutionBundleKind(parsed.kind)) {
    throw new Error("Hosted bundle archive kind is invalid.");
  }

  if (parsed.kind !== expectedKind) {
    throw new Error(`Hosted bundle kind mismatch: expected ${expectedKind}, got ${parsed.kind}.`);
  }

  if (parsed.files.length > MAX_HOSTED_BUNDLE_ARCHIVE_FILE_COUNT) {
    throw new Error(
      `Hosted bundle archive exceeds the ${MAX_HOSTED_BUNDLE_ARCHIVE_FILE_COUNT} file entry limit.`,
    );
  }

  const seen = new Set<string>();
  const artifacts: HostedBundleArtifactLocation[] = [];
  for (const file of parsed.files) {
    const parsedFile = parseHostedBundleArchiveFileForValidation(file);
    const key = `${parsedFile.root}:${parsedFile.path}`;
    if (seen.has(key)) {
      throw new Error("Hosted bundle archive contains duplicate file entries.");
    }
    seen.add(key);
    if (parsedFile.artifact) {
      artifacts.push({
        path: parsedFile.path,
        ref: parsedFile.artifact,
        root: parsedFile.root,
      });
    }
  }

  return artifacts;
}

async function gunzipHostedBundleArchive(bytes: Uint8Array): Promise<Uint8Array> {
  let response: Response;
  try {
    const compressedBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    response = new Response(
      new Blob([compressedBuffer]).stream().pipeThrough(new DecompressionStream("gzip")),
    );
  } catch {
    throw new Error("Hosted bundle archive is invalid.");
  }

  let uncompressed: Uint8Array;
  try {
    uncompressed = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw new Error("Hosted bundle archive is invalid.");
  }

  if (uncompressed.byteLength > MAX_HOSTED_BUNDLE_ARCHIVE_UNCOMPRESSED_BYTES) {
    throw new Error(
      `Hosted bundle archive exceeds the ${MAX_HOSTED_BUNDLE_ARCHIVE_UNCOMPRESSED_BYTES} byte uncompressed size limit.`,
    );
  }

  return uncompressed;
}

function parseHostedBundleArchiveFileForValidation(file: unknown): {
  artifact?: HostedBundleArtifactLocation["ref"];
  path: string;
  root: string;
} {
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    throw new Error("Hosted bundle archive contains an invalid file entry.");
  }

  const record = file as Record<string, unknown>;
  if (typeof record.path !== "string" || typeof record.root !== "string") {
    throw new Error("Hosted bundle archive contains an invalid file entry.");
  }

  const parsed = {
    path: normalizeHostedBundlePathForValidation(record.path),
    root: normalizeHostedBundleRootForValidation(record.root),
  };

  if (typeof record.contentsBase64 === "string") {
    assertCanonicalBase64ForValidation(
      record.contentsBase64,
      "Hosted bundle archive contains invalid inline file contents.",
    );
    return parsed;
  }

  if (record.artifact !== undefined) {
    return {
      ...parsed,
      artifact: parseHostedBundleArtifactRefForValidation(record.artifact),
    };
  }

  throw new Error("Hosted bundle archive contains an invalid file entry.");
}

function normalizeHostedBundlePathForValidation(value: string): string {
  const candidate = value.replace(/\\/g, "/");

  if (
    !candidate
    || candidate.includes("\u0000")
    || WINDOWS_DRIVE_PREFIX_PATTERN.test(candidate)
    || candidate.startsWith("/")
  ) {
    throw new Error("Hosted bundle path is invalid.");
  }

  const parts: string[] = [];
  for (const part of candidate.split("/")) {
    if (part.length === 0 || part === ".") {
      continue;
    }
    if (part === "..") {
      if (parts.length === 0) {
        throw new Error("Hosted bundle path is invalid.");
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  const normalized = parts.join("/");
  if (!normalized || normalized.length > MAX_HOSTED_BUNDLE_PATH_LENGTH) {
    throw new Error("Hosted bundle path is invalid.");
  }

  return normalized;
}

function normalizeHostedBundleRootForValidation(value: string): string {
  const normalized = value.trim();

  if (
    normalized.length === 0
    || normalized.length > MAX_HOSTED_BUNDLE_ROOT_LENGTH
    || normalized.includes("\u0000")
  ) {
    throw new Error("Hosted bundle root is invalid.");
  }

  return normalized;
}

function parseHostedBundleArtifactRefForValidation(
  value: unknown,
): HostedBundleArtifactLocation["ref"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Hosted bundle archive contains invalid artifact metadata.");
  }

  const record = value as Record<string, unknown>;
  const byteSize = record.byteSize;
  const sha256 = record.sha256;
  if (
    typeof byteSize !== "number"
    || !Number.isSafeInteger(byteSize)
    || byteSize < 0
    || typeof sha256 !== "string"
    || !SHA256_HEX_PATTERN.test(sha256)
  ) {
    throw new Error("Hosted bundle archive contains invalid artifact metadata.");
  }

  return {
    byteSize,
    sha256,
  };
}

function assertCanonicalBase64ForValidation(
  value: string,
  errorMessage: string,
): void {
  if (value.length === 0) {
    return;
  }

  if (value.length % 4 !== 0 || !isCanonicalBase64TextForValidation(value)) {
    throw new Error(errorMessage);
  }

  let decoded: string;
  try {
    decoded = atob(value);
  } catch {
    throw new Error(errorMessage);
  }

  let encoded = "";
  const chunkSize = 12_288;
  for (let offset = 0; offset < decoded.length; offset += chunkSize) {
    encoded += btoa(decoded.slice(offset, offset + chunkSize));
  }

  if (encoded !== value) {
    throw new Error(errorMessage);
  }
}

function isCanonicalBase64TextForValidation(value: string): boolean {
  let paddingStart = value.length;

  if (value.endsWith("==")) {
    paddingStart = value.length - 2;
  } else if (value.endsWith("=")) {
    paddingStart = value.length - 1;
  }

  for (let index = 0; index < paddingStart; index += 1) {
    if (!isBase64DataCharacterForValidation(value.charCodeAt(index))) {
      return false;
    }
  }

  for (let index = paddingStart; index < value.length; index += 1) {
    if (value[index] !== "=") {
      return false;
    }
  }

  return true;
}

function isBase64DataCharacterForValidation(charCode: number): boolean {
  return (
    (charCode >= 65 && charCode <= 90)
    || (charCode >= 97 && charCode <= 122)
    || (charCode >= 48 && charCode <= 57)
    || charCode === 43
    || charCode === 47
  );
}

function isHostedExecutionBundleKind(value: unknown): value is HostedExecutionBundleKind {
  return value === "vault";
}
