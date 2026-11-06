import path from "node:path";
import { hostedMediaPendingUpload } from "@murphai/runtime-state/node";

import { collectEventRawReferencePaths } from "@murphai/contracts";
import {
  applyHostedCanonicalWriteReceipt,
  canonicalRawArtifactMatches,
  isEventLedgerLogicalPath,
  normalizeRelativeVaultPath,
  VAULT_LAYOUT,
} from "@murphai/core";
import type {
  HostedCanonicalWritePersistenceInput,
  HostedCanonicalWriteReceipt,
  HostedCanonicalWriteReceiptAction,
  HostedCanonicalWriteReceiptContentRef,
} from "@murphai/core";

import type {
  HostedRuntimeMediaStore,
} from "./platform.ts";
import {
  publishHostedWorkspaceMediaReferences,
  readHostedMediaReferenceCatalogue,
  writeHostedMediaReferenceCatalogue,
  type HostedMediaReference,
} from "./media-references.ts";

export async function externalizeHostedCanonicalWriteMediaPayloads(input: {
  mediaStore?: HostedRuntimeMediaStore | null;
  persistence: HostedCanonicalWritePersistenceInput;
  vaultRoot: string;
}): Promise<HostedCanonicalWritePersistenceInput> {
  if (!input.mediaStore) return input.persistence;
  const referencedPaths = readCanonicalEventMediaReferencePaths(input.persistence);
  if (!receiptHasRawPayload(input.persistence) && referencedPaths.size === 0) {
    return input.persistence;
  }

  const entries = await publishHostedWorkspaceMediaReferences({
    mediaStore: input.mediaStore,
    vaultRoot: input.vaultRoot,
  });
  const mediaRefsByPath = new Map(
    entries.map((entry) => [entry.relativePath, entry]),
  );
  let omittedPayloadCount = 0;
  const actions: HostedCanonicalWriteReceiptAction[] = input.persistence.receipt.actions.map((action) => {
    if (action.kind !== "raw_upsert" || !action.contentRef || isRetainedPhotoPath(action.targetRelativePath)) {
      return action;
    }
    const mediaRef = mediaRefsByPath.get(action.targetRelativePath);
    if (
      !mediaRef
      || mediaRef.byteSize !== action.byteLength
      || mediaRef.sha256 !== action.sha256
    ) {
      return action;
    }
    omittedPayloadCount += 1;
    const { contentRef: _contentRef, ...withoutContentRef } = action;
    return {
      ...withoutContentRef,
      mediaRef: toHostedMediaReceiptAction(mediaRef).mediaRef,
    };
  });

  // A holder can preserve existing media without writing raw bytes. Carry its
  // published lifetime in the same receipt so an older snapshot can recover it.
  const actionPaths = new Set(actions.map((action) => action.targetRelativePath));
  for (const relativePath of referencedPaths) {
    const entry = mediaRefsByPath.get(relativePath);
    // Keep photo bytes in the receipt for cold CLI/native image reads, and also
    // retain the delivery-object pointer for cleanup after receipt-only recovery.
    if (entry && (!actionPaths.has(relativePath) || isRetainedPhotoPath(relativePath))) {
      if (isRetainedPhotoPath(relativePath)) {
        try {
          if (!await canonicalRawArtifactMatches({ vaultRoot: input.vaultRoot, ...entry })) continue;
        } catch {
          // Keep the historical pointer, but do not assert an unproven identity.
          continue;
        }
      }
      actions.push(toHostedMediaReceiptAction(entry));
    }
  }
  if (omittedPayloadCount === 0 && actions.length === input.persistence.receipt.actions.length) {
    return input.persistence;
  }

  const requiredContentRefs = new Set(
    actions
      .map(readHostedCanonicalWriteActionContentRef)
      .filter((ref): ref is HostedCanonicalWriteReceiptContentRef => Boolean(ref))
      .map(toHostedCanonicalWriteContentRefKey),
  );
  return {
    payloads: input.persistence.payloads.filter((payload) =>
      requiredContentRefs.has(toHostedCanonicalWriteContentRefKey({
        byteSize: payload.byteLength,
        sha256: payload.sha256,
      }))
    ),
    receipt: {
      ...input.persistence.receipt,
      actions,
    },
  };
}

function isRetainedPhotoPath(relativePath: string): boolean {
  return relativePath.startsWith("raw/meals/") || relativePath.startsWith("raw/measurements/");
}

function readCanonicalEventMediaReferencePaths(
  persistence: HostedCanonicalWritePersistenceInput,
): Set<string> {
  const paths = new Set<string>();
  for (const action of persistence.receipt.actions) {
    if (
      action.kind !== "jsonl_append"
      || !action.contentRef
      || !isEventLedgerLogicalPath(action.targetRelativePath)
    ) {
      continue;
    }
    const ref = action.contentRef;
    const payload = persistence.payloads.find((item) =>
      item.sha256 === ref.sha256 && item.byteLength === ref.byteSize
    );
    if (!payload) throw new Error("Canonical event receipt payload is missing.");
    const lines = Buffer.from(payload.bytes).toString("utf8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      const record: unknown = JSON.parse(line);
      if (!record || typeof record !== "object" || Array.isArray(record)) continue;
      for (const rawRef of collectEventRawReferencePaths(record)) {
        let normalized: string;
        try {
          normalized = normalizeRelativeVaultPath(rawRef);
        } catch {
          continue;
        }
        if (
          normalized.startsWith(`${VAULT_LAYOUT.rawInboxDirectory}/`)
          || normalized.startsWith(`${VAULT_LAYOUT.rawCapturesDirectory}/`)
          || normalized.startsWith(`${VAULT_LAYOUT.rawMealsDirectory}/`)
          || normalized.startsWith(`${VAULT_LAYOUT.rawMeasurementsDirectory}/`)
        ) {
          paths.add(normalized);
        }
      }
    }
  }
  return paths;
}

function toHostedMediaReceiptAction(
  entry: HostedMediaReference,
): Extract<HostedCanonicalWriteReceiptAction, { kind: "raw_upsert" }> {
  if (entry.mediaKind === "integration-ingest") throw new Error("Cold history cannot become a raw media receipt.");
  return {
    kind: "raw_upsert",
    targetRelativePath: entry.relativePath,
    sha256: entry.sha256,
    byteLength: entry.byteSize,
    mediaType: entry.mimeType ?? "application/octet-stream",
    originalFileName: path.posix.basename(entry.relativePath),
    effect: "reuse",
    mediaRef: {
      ...(entry.pendingUpload === undefined ? {} : { pendingUpload: entry.pendingUpload }),
      id: entry.mediaId,
      mediaKind: entry.mediaKind,
      expiresAt: entry.expiresAt,
      recordedAt: entry.recordedAt,
    },
  };
}

function receiptHasRawPayload(
  persistence: HostedCanonicalWritePersistenceInput,
): boolean {
  return persistence.receipt.actions.some((action) =>
    action.kind === "raw_upsert"
    && Boolean(action.contentRef)
  );
}

function readHostedCanonicalWriteActionContentRef(
  action: HostedCanonicalWriteReceiptAction,
): HostedCanonicalWriteReceiptContentRef | null {
  return "contentRef" in action && action.contentRef
    ? action.contentRef
    : null;
}

function toHostedCanonicalWriteContentRefKey(
  ref: HostedCanonicalWriteReceiptContentRef,
): string {
  return `${ref.sha256}:${ref.byteSize}`;
}

// Rebuild only metadata after applying the durable receipt. Media bytes remain
// absent until a consumer requests them; later receipt actions supersede earlier ones.
async function restoreHostedCanonicalWriteMediaReferences(input: {
  receipt: HostedCanonicalWriteReceipt;
  vaultRoot: string;
}): Promise<void> {
  if (!input.receipt.actions.some((action) => action.targetRelativePath.startsWith("raw/"))) return;
  const catalogue = await readHostedMediaReferenceCatalogue(input);
  const entries = new Map(catalogue.entries.map((entry) => [entry.relativePath, entry]));
  let changed = false;
  for (const action of input.receipt.actions) {
    if (action.kind === "raw_upsert" && action.mediaRef) {
      const previous = entries.get(action.targetRelativePath);
      const completed = previous && previous.pendingUpload !== true
        && previous.mediaId === action.mediaRef.id && previous.mediaKind === action.mediaRef.mediaKind
        && previous.sha256 === action.sha256 && previous.byteSize === action.byteLength;
      const pendingUpload = hostedMediaPendingUpload(action.targetRelativePath, action.mediaRef.pendingUpload);
      entries.set(action.targetRelativePath, {
        byteSize: action.byteLength,
        expiresAt: action.mediaRef.expiresAt,
        mediaId: action.mediaRef.id,
        mediaKind: action.mediaRef.mediaKind,
        mimeType: action.mediaType,
        // A matching settled catalogue must not regress on replay of old intent.
        ...(pendingUpload === undefined ? {} : { pendingUpload: completed ? false : pendingUpload }),
        recordedAt: action.mediaRef.recordedAt,
        relativePath: action.targetRelativePath,
        sha256: action.sha256,
      });
      changed = true;
    } else if (action.kind !== "delete" && action.kind !== "delete_if_match" && !isRetainedPhotoPath(action.targetRelativePath)) {
      // Keep deleted media receipts until final snapshot reconciliation. Removing
      // the only catalogue pointer here would orphan the encrypted object; eager
      // deletion during replay could destroy media reused by a later receipt.
      const existing = entries.get(action.targetRelativePath);
      if (existing) {
        changed = entries.delete(action.targetRelativePath) || changed;
      }
    }
  }
  if (changed) {
    await writeHostedMediaReferenceCatalogue({
      catalogue: { ...catalogue, entries: [...entries.values()] },
      vaultRoot: input.vaultRoot,
    });
  }
}

export async function applyHostedCanonicalWriteReceiptWithMedia(
  input: Parameters<typeof applyHostedCanonicalWriteReceipt>[0],
): Promise<void> {
  await applyHostedCanonicalWriteReceipt(input);
  await restoreHostedCanonicalWriteMediaReferences(input);
}
