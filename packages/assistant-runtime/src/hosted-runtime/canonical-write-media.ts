import path from "node:path";

import { collectEventRawReferencePaths } from "@murphai/contracts";
import {
  applyHostedCanonicalWriteReceipt,
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
    if (action.kind !== "raw_upsert" || !action.contentRef) {
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
    if (entry && !actionPaths.has(relativePath)) {
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
  return {
    kind: "raw_upsert",
    targetRelativePath: entry.relativePath,
    sha256: entry.sha256,
    byteLength: entry.byteSize,
    mediaType: entry.mimeType ?? "application/octet-stream",
    originalFileName: path.posix.basename(entry.relativePath),
    effect: "reuse",
    mediaRef: {
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
      entries.set(action.targetRelativePath, {
        byteSize: action.byteLength,
        expiresAt: action.mediaRef.expiresAt,
        mediaId: action.mediaRef.id,
        mediaKind: action.mediaRef.mediaKind,
        mimeType: action.mediaType,
        recordedAt: action.mediaRef.recordedAt,
        relativePath: action.targetRelativePath,
        sha256: action.sha256,
      });
      changed = true;
    } else {
      const existing = entries.get(action.targetRelativePath);
      if (existing && (action.kind !== "delete_if_match" || (
        existing.sha256 === action.expectedSha256 && existing.byteSize === action.expectedByteLength
      ))) {
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
