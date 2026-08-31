import {
  HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
  type HostedCanonicalWriteReceipt,
  type HostedCanonicalWriteReceiptAction,
  type HostedCanonicalWriteReceiptContentRef,
} from "@murphai/core";

export function parseHostedCanonicalWriteReceiptArtifact(
  raw: string,
): HostedCanonicalWriteReceipt | null {
  const parsed: unknown = JSON.parse(raw);
  if (!isPlainObject(parsed)) {
    throw new Error("Hosted canonical write receipt must be an object.");
  }
  if (
    parsed.schema !== HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION
    && parsed.schemaVersion === HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION
  ) {
    return null;
  }
  if (parsed.schema !== HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION) {
    throw new Error("Hosted canonical write receipt schema is invalid.");
  }
  if (
    typeof parsed.operationId !== "string"
    || typeof parsed.operationType !== "string"
    || typeof parsed.summary !== "string"
    || typeof parsed.createdAt !== "string"
    || typeof parsed.updatedAt !== "string"
    || typeof parsed.occurredAt !== "string"
    || typeof parsed.committedAt !== "string"
    || !Array.isArray(parsed.actions)
  ) {
    throw new Error("Hosted canonical write receipt fields are invalid.");
  }

  const actions = parsed.actions.map(parseHostedCanonicalWriteReceiptAction);
  return {
    schema: HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
    operationId: parsed.operationId,
    operationType: parsed.operationType,
    summary: parsed.summary,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    occurredAt: parsed.occurredAt,
    committedAt: parsed.committedAt,
    actions,
  };
}

function parseHostedCanonicalWriteReceiptAction(
  raw: unknown,
): HostedCanonicalWriteReceiptAction {
  if (!isPlainObject(raw) || typeof raw.kind !== "string") {
    throw new Error("Hosted canonical write receipt action is invalid.");
  }
  if (typeof raw.targetRelativePath !== "string") {
    throw new Error("Hosted canonical write receipt action target is invalid.");
  }

  switch (raw.kind) {
    case "text_upsert": {
      if (
        !isSha256(raw.sha256)
        || !isNonNegativeInteger(raw.byteLength)
        || !isTextUpsertEffect(raw.effect)
        || ((raw.expectedSha256 === undefined) !== (raw.expectedByteLength === undefined))
        || (raw.expectedSha256 !== undefined && !isSha256(raw.expectedSha256))
        || (
          raw.expectedByteLength !== undefined
          && !isNonNegativeInteger(raw.expectedByteLength)
        )
      ) {
        throw new Error("Hosted canonical text write receipt action is invalid.");
      }
      const contentRef = parseHostedCanonicalWriteReceiptContentRef(raw.contentRef);
      return {
        kind: "text_upsert",
        targetRelativePath: raw.targetRelativePath,
        sha256: raw.sha256,
        byteLength: raw.byteLength,
        effect: raw.effect,
        ...(raw.allowRaw === true ? { allowRaw: true as const } : {}),
        ...(
          typeof raw.expectedSha256 === "string"
          && typeof raw.expectedByteLength === "number"
            ? {
                expectedSha256: raw.expectedSha256,
                expectedByteLength: raw.expectedByteLength,
              }
            : {}
        ),
        ...(contentRef ? { contentRef } : {}),
      };
    }
    case "jsonl_append": {
      if (
        !isSha256(raw.appendSha256)
        || !isNonNegativeInteger(raw.appendByteLength)
        || !isSha256(raw.baseSha256)
        || !isNonNegativeInteger(raw.baseByteLength)
        || (raw.originalSize !== null && !isNonNegativeInteger(raw.originalSize))
      ) {
        throw new Error("Hosted canonical JSONL append receipt action is invalid.");
      }
      const contentRef = parseHostedCanonicalWriteReceiptContentRef(raw.contentRef);
      return {
        kind: "jsonl_append",
        targetRelativePath: raw.targetRelativePath,
        appendSha256: raw.appendSha256,
        appendByteLength: raw.appendByteLength,
        baseSha256: raw.baseSha256,
        baseByteLength: raw.baseByteLength,
        originalSize: raw.originalSize,
        ...(raw.allowArchivedIntegrationIngestAmendment === true
          ? { allowArchivedIntegrationIngestAmendment: true as const }
          : {}),
        ...(contentRef ? { contentRef } : {}),
      };
    }
    case "raw_upsert": {
      if (
        !isSha256(raw.sha256)
        || !isNonNegativeInteger(raw.byteLength)
        || typeof raw.mediaType !== "string"
        || typeof raw.originalFileName !== "string"
        || !isRawUpsertEffect(raw.effect)
      ) {
        throw new Error("Hosted canonical raw write receipt action is invalid.");
      }
      const contentRef = parseHostedCanonicalWriteReceiptContentRef(raw.contentRef);
      if (!contentRef) {
        throw new Error("Hosted canonical raw write receipt action is missing content.");
      }
      return {
        kind: "raw_upsert",
        targetRelativePath: raw.targetRelativePath,
        sha256: raw.sha256,
        byteLength: raw.byteLength,
        mediaType: raw.mediaType,
        originalFileName: raw.originalFileName,
        effect: raw.effect,
        contentRef,
      };
    }
    case "delete": {
      if (typeof raw.existedBefore !== "boolean") {
        throw new Error("Hosted canonical delete receipt action is invalid.");
      }
      return {
        kind: "delete",
        targetRelativePath: raw.targetRelativePath,
        existedBefore: raw.existedBefore,
        ...(raw.allowRaw === true ? { allowRaw: true as const } : {}),
      };
    }
    case "delete_if_match": {
      if (
        typeof raw.existedBefore !== "boolean"
        || !isSha256(raw.expectedSha256)
        || !isNonNegativeInteger(raw.expectedByteLength)
      ) {
        throw new Error("Hosted canonical guarded delete receipt action is invalid.");
      }
      return {
        kind: "delete_if_match",
        targetRelativePath: raw.targetRelativePath,
        existedBefore: raw.existedBefore,
        expectedSha256: raw.expectedSha256,
        expectedByteLength: raw.expectedByteLength,
        ...(raw.allowRaw === true ? { allowRaw: true as const } : {}),
      };
    }
    default:
      throw new Error("Hosted canonical write receipt action kind is invalid.");
  }
}

function parseHostedCanonicalWriteReceiptContentRef(
  raw: unknown,
): HostedCanonicalWriteReceiptContentRef | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isPlainObject(raw) || !isSha256(raw.sha256) || !isNonNegativeInteger(raw.byteSize)) {
    throw new Error("Hosted canonical write receipt content ref is invalid.");
  }
  return {
    sha256: raw.sha256,
    byteSize: raw.byteSize,
  };
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isTextUpsertEffect(value: unknown): value is "create" | "update" | "reuse" {
  return value === "create" || value === "update" || value === "reuse";
}

function isRawUpsertEffect(value: unknown): value is "copy" | "reuse" {
  return value === "copy" || value === "reuse";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
