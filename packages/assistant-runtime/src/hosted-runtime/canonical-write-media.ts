import { applyHostedCanonicalWriteReceipt } from "@murphai/core";
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
  publishHostedWorkspaceMediaReferencesForSnapshot,
  readHostedMediaReferenceCatalogue,
  writeHostedMediaReferenceCatalogue,
} from "./media-references.ts";

export async function externalizeHostedCanonicalWriteMediaPayloads(input: {
  mediaStore?: HostedRuntimeMediaStore | null;
  persistence: HostedCanonicalWritePersistenceInput;
  vaultRoot: string;
}): Promise<HostedCanonicalWritePersistenceInput> {
  if (!input.mediaStore || !receiptHasRawPayload(input.persistence)) {
    return input.persistence;
  }

  await publishHostedWorkspaceMediaReferencesForSnapshot({
    mediaStore: input.mediaStore,
    vaultRoot: input.vaultRoot,
  });
  const catalogue = await readHostedMediaReferenceCatalogue({
    vaultRoot: input.vaultRoot,
  });
  const mediaRefsByPath = new Map(
    catalogue.entries.map((entry) => [entry.relativePath, entry]),
  );
  let omittedPayloadCount = 0;
  const actions = input.persistence.receipt.actions.map((action) => {
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
      mediaRef: {
        id: mediaRef.mediaId,
        mediaKind: mediaRef.mediaKind,
        expiresAt: mediaRef.expiresAt,
        recordedAt: mediaRef.recordedAt,
      },
    };
  });

  if (omittedPayloadCount === 0) {
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
