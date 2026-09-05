import type {
  HostedCanonicalWritePersistenceInput,
  HostedCanonicalWriteReceiptAction,
  HostedCanonicalWriteReceiptContentRef,
} from "@murphai/core";

import type {
  HostedRuntimeMediaStore,
} from "./platform.ts";
import {
  publishHostedWorkspaceMediaReferencesForSnapshot,
  readHostedMediaReferenceCatalogue,
} from "./media-references.ts";

export async function externalizeHostedCanonicalWriteMediaPayloads(input: {
  mediaStore?: HostedRuntimeMediaStore | null;
  persistence: HostedCanonicalWritePersistenceInput;
  vaultRoot: string;
}): Promise<HostedCanonicalWritePersistenceInput> {
  if (!input.mediaStore || !receiptHasHostedMediaPayload(input.persistence)) {
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
    return withoutContentRef;
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

function receiptHasHostedMediaPayload(
  persistence: HostedCanonicalWritePersistenceInput,
): boolean {
  return persistence.receipt.actions.some((action) =>
    action.kind === "raw_upsert"
    && Boolean(action.contentRef)
    && (
      action.mediaType.toLowerCase().startsWith("image/")
      || action.mediaType.toLowerCase().startsWith("video/")
    )
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
