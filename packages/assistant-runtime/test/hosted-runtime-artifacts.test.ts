import { parseHostedCanonicalWriteReceiptArtifact } from "../src/hosted-runtime/canonical-write-receipt.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test, vi } from "vitest";
import {
  addCapture,
  applyCanonicalWriteBatch,
  appendJsonlRecord,
  initializeVault,
  readEvent,
  upsertEvent,
  withHostedCanonicalWritePort,
  type HostedCanonicalWritePersistenceInput,
  VAULT_LAYOUT,
} from "@murphai/core";
import {
  assertContract,
  inboxCaptureRecordSchema,
  type InboxCaptureRecord,
} from "@murphai/contracts";
import {
  sha256HostedBundleHex,
  snapshotHostedBundleRoots,
} from "@murphai/runtime-state/node";
import { normalizeParsedEmailMessage, persistCanonicalInboxCapture } from "@murphai/inboxd";
import {
  appendHostedCanonicalWriteReceiptToArtifactLog,
  hostedCanonicalWriteReceiptLogStatusFields,
} from "../src/hosted-runtime/canonical-write-receipt-log.ts";
import { restoreHostedWorkspaceRuntimeJobWorkspace } from "../src/hosted-runtime/workspace-restore.ts";
import { createWorkspaceState } from "./hosted-runtime-workspace-entrypoint.harness.ts";

import {
  createHostedArtifactMaterializer,
  createHostedArtifactResolver,
  createHostedArtifactUploadSink,
} from "../src/hosted-runtime/artifacts.ts";
import {
  externalizeHostedCanonicalWriteMediaPayloads,
  applyHostedCanonicalWriteReceiptWithMedia,
} from "../src/hosted-runtime/canonical-write-media.ts";
import {
  createHostedRuntimeArtifactStoreStub,
  createHostedWorkspaceArtifactPersistInput,
} from "./hosted-runtime-test-helpers.ts";
import type {
  HostedRuntimeMediaStore,
} from "../src/hosted-runtime/platform.ts";
import {
  publishHostedWorkspaceMediaReferencesForSnapshot,
  readHostedMediaReferenceCatalogue,
} from "../src/hosted-runtime/media-references.ts";

test("hosted artifact resolver caches repeated reads by artifact hash", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const { artifactStore, getCalls } = createHostedRuntimeArtifactStoreStub({
    sha_cached: bytes,
  });
  const resolveArtifact = createHostedArtifactResolver({ artifactStore });

  const first = await resolveArtifact({
    ref: {
      byteSize: bytes.byteLength,
      sha256: "sha_cached",
    },
  });
  const second = await resolveArtifact({
    ref: {
      byteSize: bytes.byteLength,
      sha256: "sha_cached",
    },
  });

  assert.equal(first, bytes);
  assert.equal(second, bytes);
  assert.deepEqual(getCalls, ["sha_cached"]);
});

test("hosted artifact resolver fails closed when the artifact store misses a requested hash", async () => {
  const { artifactStore } = createHostedRuntimeArtifactStoreStub();
  const resolveArtifact = createHostedArtifactResolver({ artifactStore });

  await assert.rejects(
    resolveArtifact({
      ref: {
        byteSize: 1,
        sha256: "sha_missing",
      },
    }),
    (error: unknown) => (
      error instanceof Error
      && error.message === "Hosted artifact fetch failed with HTTP 404."
      && (error as { status?: unknown }).status === 404
      && (error as { statusCode?: unknown }).statusCode === 404
    ),
  );
});

test("hosted artifact upload sink skips known and already uploaded hashes", async () => {
  const { artifactStore, putCalls } = createHostedRuntimeArtifactStoreStub();
  const uploadArtifact = createHostedArtifactUploadSink({
    artifactStore,
    knownArtifactHashes: new Set(["sha_known"]),
  });

  await uploadArtifact(
    createHostedWorkspaceArtifactPersistInput({
      bytes: new Uint8Array([1]),
      sha256: "sha_known",
    }),
  );
  await uploadArtifact(
    createHostedWorkspaceArtifactPersistInput({
      bytes: new Uint8Array([2, 3]),
      sha256: "sha_uploaded",
    }),
  );
  await uploadArtifact(
    createHostedWorkspaceArtifactPersistInput({
      bytes: new Uint8Array([4, 5]),
      sha256: "sha_uploaded",
    }),
  );

  assert.equal(putCalls.length, 1);
  assert.equal(putCalls[0]?.sha256, "sha_uploaded");
  assert.deepEqual(Array.from(putCalls[0]?.bytes ?? []), [2, 3]);
});

test("hosted artifact upload sink clones bytes before sending them to the store", async () => {
  const sourceBytes = new Uint8Array([9, 8, 7]);
  const { artifactStore, putCalls, storedBytesByHash } = createHostedRuntimeArtifactStoreStub();
  const uploadArtifact = createHostedArtifactUploadSink({
    artifactStore,
    knownArtifactHashes: new Set(),
  });

  await uploadArtifact(
    createHostedWorkspaceArtifactPersistInput({
      bytes: sourceBytes,
      sha256: "sha_clone",
    }),
  );
  sourceBytes[0] = 0;

  assert.notEqual(putCalls[0]?.bytes, sourceBytes);
  assert.deepEqual(Array.from(putCalls[0]?.bytes ?? []), [9, 8, 7]);
  assert.deepEqual(Array.from(storedBytesByHash.get("sha_clone") ?? []), [9, 8, 7]);
});

test("hosted artifact materializer records only paths that restore", async () => {
  const sourceVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-artifacts-source-"));
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-artifacts-vault-"));
  const operatorHomeRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-artifacts-home-"));
  const artifactBytesByHash = new Map<string, Uint8Array>();

  try {
    const sourceFiles = [
      {
        bytes: Buffer.from("scan artifact\n", "utf8"),
        path: "raw/inbox/example/scan.txt",
      },
      {
        bytes: Buffer.from("derived summary\n", "utf8"),
        path: "derived/inbox/example/attachment/summary.txt",
      },
    ];
    for (const file of sourceFiles) {
      const sourcePath = path.join(sourceVaultRoot, file.path);
      await mkdir(path.dirname(sourcePath), { recursive: true });
      await writeFile(sourcePath, file.bytes);
    }
    const bundle = await snapshotHostedBundleRoots({
      externalizeFile: async (file) => {
        const sha256 = sha256HostedBundleHex(file.bytes);
        artifactBytesByHash.set(sha256, file.bytes);
        return {
          byteSize: file.bytes.byteLength,
          sha256,
        };
      },
      kind: "vault",
      roots: [{
        root: sourceVaultRoot,
        rootKey: "vault",
      }],
    });
    assert.ok(bundle);
    const { artifactStore, getCalls } = createHostedRuntimeArtifactStoreStub(
      Object.fromEntries(artifactBytesByHash),
    );
    const materializedArtifactPaths = new Set<string>();
    const materialize = createHostedArtifactMaterializer({
      artifactResolver: createHostedArtifactResolver({ artifactStore }),
      bundles: [async () => bundle],
      materializedArtifactPaths,
      operatorHomeRoot,
      vaultRoot,
    });

    const missing = await materialize(["raw/inbox/example/missing.txt"]);
    assert.deepEqual([...missing.materializedArtifactPaths], []);
    assert.deepEqual([...missing.missingArtifactPaths], ["vault:raw/inbox/example/missing.txt"]);
    assert.deepEqual([...materializedArtifactPaths], []);

    const overBudget = await materialize(
      ["derived/inbox/example/attachment/summary.txt"],
      { maxFileBytes: 4 },
    );
    assert.deepEqual([...overBudget.materializedArtifactPaths], []);
    assert.deepEqual(
      [...overBudget.missingArtifactPaths],
      ["vault:derived/inbox/example/attachment/summary.txt"],
    );
    assert.deepEqual(getCalls, []);

    const restored = await materialize([
      "derived/inbox/example/attachment/summary.txt",
      "raw/inbox/example/scan.txt",
    ]);
    assert.deepEqual(
      [...restored.materializedArtifactPaths].sort(),
      [
        "vault:derived/inbox/example/attachment/summary.txt",
        "vault:raw/inbox/example/scan.txt",
      ],
    );
    assert.deepEqual([...restored.missingArtifactPaths], []);
    assert.deepEqual(
      [...materializedArtifactPaths].sort(),
      [
        "vault:derived/inbox/example/attachment/summary.txt",
        "vault:raw/inbox/example/scan.txt",
      ],
    );
    await expect(readFile(path.join(vaultRoot, "raw", "inbox", "example", "scan.txt"), "utf8"))
      .resolves.toBe("scan artifact\n");
    await expect(readFile(path.join(vaultRoot, "derived", "inbox", "example", "attachment", "summary.txt"), "utf8"))
      .resolves.toBe("derived summary\n");
  } finally {
    await rm(sourceVaultRoot, { force: true, recursive: true });
    await rm(vaultRoot, { force: true, recursive: true });
    await rm(operatorHomeRoot, { force: true, recursive: true });
  }
});

test("hosted artifact materializer restores retained inbox media from media references", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-06-02T00:00:00.000Z"));
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-media-vault-"));
  const operatorHomeRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-media-home-"));
  const imageBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAABAcU3iAAAADElEQVR42mNk+M8AAwUBAcF/lMsAAAAASUVORK5CYII=",
    "base64",
  );
  const videoBytes = Buffer.from("retained video bytes", "utf8");

  try {
    await initializeVault({ vaultRoot, createdAt: "2026-06-01T00:00:00.000Z" });
    const captureId = "cap_hosted_media_refs";
    const sourceDirectory = path.posix.join(
      VAULT_LAYOUT.rawInboxDirectory,
      "telegram",
      "self",
      "2026",
      "06",
      captureId,
    );
    const imagePath = path.posix.join(sourceDirectory, "attachments", "01__photo.png");
    const videoPath = path.posix.join(sourceDirectory, "attachments", "02__clip.mp4");
    const imageSha256 = createHash("sha256").update(imageBytes).digest("hex");
    const videoSha256 = createHash("sha256").update(videoBytes).digest("hex");
    await writeVaultBytes(vaultRoot, imagePath, imageBytes);
    await writeVaultBytes(vaultRoot, videoPath, videoBytes);

    await appendJsonlRecord({
      vaultRoot,
      relativePath: path.posix.join(
        VAULT_LAYOUT.inboxCaptureLedgerDirectory,
        "2026",
        "2026-06.jsonl",
      ),
      record: assertContract<InboxCaptureRecord>(inboxCaptureRecordSchema, {
        schemaVersion: "murph.inbox-capture.v2",
        captureId,
        identityKey: "telegram:self:thread-hosted-media-refs:msg-hosted-media-refs",
        eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2WH",
        source: "telegram",
        accountId: null,
        externalId: "msg-hosted-media-refs",
        thread: {
          id: "thread-hosted-media-refs",
          isDirect: true,
          title: null,
        },
        actor: {
          id: null,
          displayName: null,
          isSelf: false,
        },
        occurredAt: "2026-06-01T00:00:00.000Z",
        recordedAt: "2026-06-01T00:00:00.000Z",
        receivedAt: null,
        text: "image and video",
        raw: {},
        sourceDirectory,
        rawRefs: [imagePath, videoPath],
        attachments: [
          {
            attachmentId: `att_${captureId}_01`,
            ordinal: 1,
            externalId: null,
            kind: "image",
            mime: "image/png",
            originalPath: null,
            fileName: "photo.png",
            byteSize: imageBytes.byteLength,
            storedPath: imagePath,
            sha256: imageSha256,
          },
          {
            attachmentId: `att_${captureId}_02`,
            ordinal: 2,
            externalId: null,
            kind: "video",
            mime: "video/mp4",
            originalPath: null,
            fileName: "clip.mp4",
            byteSize: videoBytes.byteLength,
            storedPath: videoPath,
            sha256: videoSha256,
          },
        ],
      }, "hosted media inbox capture record"),
    });

    const { mediaStore, getCalls, putCalls, storedBytesByMediaId } =
      createHostedRuntimeMediaStoreStub();
    const published = await publishHostedWorkspaceMediaReferencesForSnapshot({
      mediaStore,
      vaultRoot,
    });

    assert.equal(published.referenceCount, 2);
    assert.equal(published.uploadedMediaCount, 2);
    assert.deepEqual(published.excludedVaultPaths.sort(), [
      imagePath,
      videoPath,
    ].sort());
    assert.equal(putCalls.length, 2);
    assert.equal(storedBytesByMediaId.size, 2);

    const textPayloadBytes = Buffer.from("text receipt payload\n", "utf8");
    const textSha256 = createHash("sha256").update(textPayloadBytes).digest("hex");
    const externalizedReceipt = await externalizeHostedCanonicalWriteMediaPayloads({
      mediaStore,
      persistence: {
        payloads: [
          {
            byteLength: imageBytes.byteLength,
            bytes: imageBytes,
            sha256: imageSha256,
          },
          {
            byteLength: textPayloadBytes.byteLength,
            bytes: textPayloadBytes,
            sha256: textSha256,
          },
        ],
        receipt: {
          actions: [
            {
              byteLength: imageBytes.byteLength,
              contentRef: {
                byteSize: imageBytes.byteLength,
                sha256: imageSha256,
              },
              effect: "copy",
              kind: "raw_upsert",
              mediaType: "image/png",
              originalFileName: "photo.png",
              sha256: imageSha256,
              targetRelativePath: imagePath,
            },
            {
              byteLength: textPayloadBytes.byteLength,
              contentRef: {
                byteSize: textPayloadBytes.byteLength,
                sha256: textSha256,
              },
              effect: "create",
              kind: "text_upsert",
              sha256: textSha256,
              targetRelativePath: "notes/summary.md",
            },
          ],
          committedAt: "2026-06-01T00:00:00.000Z",
          createdAt: "2026-06-01T00:00:00.000Z",
          occurredAt: "2026-06-01T00:00:00.000Z",
          operationId: "op_hosted_media_receipt",
          operationType: "hosted_media_receipt",
          schema: "murph.hosted-canonical-write-receipt.v1",
          summary: "Persist hosted media receipt.",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
      } satisfies HostedCanonicalWritePersistenceInput,
      vaultRoot,
    });
    assert.equal(
      "contentRef" in externalizedReceipt.receipt.actions[0]!,
      false,
    );
    assert.deepEqual(
      externalizedReceipt.payloads.map((payload) => payload.sha256),
      [textSha256],
    );
    assert.ok("mediaRef" in externalizedReceipt.receipt.actions[0]!);
    assert.equal(putCalls.length, 2);

    await rm(path.join(vaultRoot, sourceDirectory), {
      force: true,
      recursive: true,
    });

    const { artifactStore } = createHostedRuntimeArtifactStoreStub();
    const materializedArtifactPaths = new Set<string>();
    const materialize = createHostedArtifactMaterializer({
      artifactResolver: createHostedArtifactResolver({ artifactStore }),
      bundles: [],
      materializedArtifactPaths,
      mediaStore,
      operatorHomeRoot,
      vaultRoot,
    });

    const result = await materialize([imagePath, videoPath]);
    assert.deepEqual([...result.missingArtifactPaths], []);
    assert.deepEqual([...result.materializedArtifactPaths].sort(), [
      `vault:${imagePath}`,
      `vault:${videoPath}`,
    ].sort());
    assert.deepEqual([...materializedArtifactPaths].sort(), [
      `vault:${imagePath}`,
      `vault:${videoPath}`,
    ].sort());
    assert.deepEqual(
      await readFile(path.join(vaultRoot, imagePath)),
      imageBytes,
    );
    assert.deepEqual(
      Buffer.from(await readFile(path.join(vaultRoot, videoPath))).toString("utf8"),
      "retained video bytes",
    );
    assert.deepEqual(getCalls.map((call) => call.purpose), [
      "workspace_media_materialization",
      "workspace_media_materialization",
    ]);
    clock.mockReturnValue(Date.parse("2026-06-30T23:59:59.999Z"));
    assert.equal((await materialize([imagePath, videoPath])).missingArtifactPaths.size, 0);
    clock.mockReturnValue(Date.parse("2026-07-01T00:00:00.000Z"));
    const videoExpired = await materialize([imagePath, videoPath]);
    assert.deepEqual([...videoExpired.missingArtifactPaths], [`vault:${videoPath}`]);
    assert.deepEqual(await readFile(path.join(vaultRoot, imagePath)), imageBytes);
    await assert.rejects(readFile(path.join(vaultRoot, videoPath)), { code: "ENOENT" });
    clock.mockReturnValue(Date.parse("2026-08-29T23:59:59.999Z"));
    assert.equal((await materialize([imagePath])).missingArtifactPaths.size, 0);
    clock.mockReturnValue(Date.parse("2026-08-30T00:00:00.000Z"));
    const expired = await materialize([imagePath, videoPath]);
    assert.equal(expired.missingArtifactPaths.size, 2);
    await assert.rejects(readFile(path.join(vaultRoot, imagePath)), { code: "ENOENT" });
    assert.equal(getCalls.length, 2);
  } finally {
    clock.mockRestore();
    await rm(vaultRoot, { force: true, recursive: true });
    await rm(operatorHomeRoot, { force: true, recursive: true });
  }
});

async function writeVaultBytes(
  vaultRoot: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
}

function createHostedRuntimeMediaStoreStub(): {
  deleteCalls: string[];
  getCalls: Array<{
    mediaId: string;
    purpose: string;
  }>;
  mediaStore: HostedRuntimeMediaStore;
  putCalls: Array<{
    byteSize: number;
    mediaId: string;
    mediaKind: "image" | "video";
    sha256: string;
  }>;
  storedBytesByMediaId: Map<string, Uint8Array>;
} {
  const storedBytesByMediaId = new Map<string, Uint8Array>();
  const getCalls: Array<{
    mediaId: string;
    purpose: string;
  }> = [];
  const putCalls: Array<{
    byteSize: number;
    mediaId: string;
    mediaKind: "image" | "video";
    sha256: string;
  }> = [];
  const deleteCalls: string[] = [];
  return {
    deleteCalls,
    getCalls,
    mediaStore: {
      async delete({ mediaId }) {
        deleteCalls.push(mediaId);
        storedBytesByMediaId.delete(mediaId);
      },
      async get(descriptor, context) {
        getCalls.push({
          mediaId: descriptor.mediaId,
          purpose: context.purpose,
        });
        return storedBytesByMediaId.get(descriptor.mediaId) ?? null;
      },
      async put(input) {
        const sha256 = createHash("sha256").update(input.bytes).digest("hex");
        assert.equal(sha256, input.sha256);
        assert.equal(input.bytes.byteLength, input.byteSize);
        putCalls.push({
          byteSize: input.byteSize,
          mediaId: input.mediaId,
          mediaKind: input.mediaKind,
          sha256: input.sha256,
        });
        const storedBytes = new Uint8Array(input.bytes.byteLength);
        storedBytes.set(input.bytes);
        storedBytesByMediaId.set(input.mediaId, storedBytes);
      },
    },
    putCalls,
    storedBytesByMediaId,
  };
}


test("ordinary canonical captures have no transient media deadline", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-durable-capture-"));
  try {
    await initializeVault({ vaultRoot });
    const sourcePath = path.join(vaultRoot, "saved.png");
    await writeFile(sourcePath, "durable image bytes");
    const capture = await addCapture({
      vaultRoot,
      draft: { occurredAt: "2025-01-01T00:00:00.000Z", recordedAt: "2025-01-01T00:00:00.000Z", source: "manual", title: "Saved reference", note: "Retained attachment." },
      attachments: [{ role: "photo", sourcePath }],
    });
    const { mediaStore, putCalls, getCalls } = createHostedRuntimeMediaStoreStub();
    await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore });
    assert.equal(putCalls.length, 1);
    assert.equal((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries[0]?.expiresAt, null);
    assert.ok(capture.event.rawRefs?.length);
    const entry = (await readHostedMediaReferenceCatalogue({ vaultRoot })).entries[0]!;
    assert.equal(entry.recordedAt, "2025-01-01T00:00:00.000Z");
    await rm(path.join(vaultRoot, entry.relativePath));
    const { artifactStore } = createHostedRuntimeArtifactStoreStub();
    const materialize = createHostedArtifactMaterializer({
      artifactResolver: createHostedArtifactResolver({ artifactStore }),
      bundles: [], materializedArtifactPaths: new Set(), mediaStore,
      operatorHomeRoot: vaultRoot, vaultRoot,
    });
    assert.equal((await materialize([entry.relativePath])).missingArtifactPaths.size, 0);
    assert.equal(await readFile(path.join(vaultRoot, entry.relativePath), "utf8"), "durable image bytes");
    assert.equal(getCalls.length, 1);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});


test("failed capture replacement preserves saved media until committed snapshot cleanup", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "murph-media-write-rollback-"));
  const vaultRoot = path.join(root, "live");
  const restoredRoot = path.join(root, "restored");
  const { artifactStore } = createHostedRuntimeArtifactStoreStub();
  const store = createHostedRuntimeMediaStoreStub();
  const now = new Date().toISOString();
  try {
    await initializeVault({ vaultRoot });
    const captures: Array<Awaited<ReturnType<typeof addCapture>>> = [];
    for (const name of ["first", "second"]) {
      const sourcePath = path.join(root, `${name}.png`);
      await writeFile(sourcePath, `${name} saved image bytes`);
      captures.push(await addCapture({
        vaultRoot,
        draft: { occurredAt: now, source: "manual", title: name, note: "Saved attachment." },
        attachments: [{ role: "photo", sourcePath }],
      }));
    }
    await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore: store.mediaStore });
    const catalogue = await readHostedMediaReferenceCatalogue({ vaultRoot });
    const original = catalogue.entries.find((entry) => entry.relativePath === captures[0]!.event.rawRefs![0])!;
    const replacement = catalogue.entries.find((entry) => entry.relativePath === captures[1]!.event.rawRefs![0])!;
    assert.ok(original);
    assert.ok(replacement);
    for (const entry of catalogue.entries) await rm(path.join(vaultRoot, entry.relativePath));
    const snapshot = await snapshotHostedBundleRoots({ kind: "vault", roots: [{ root: vaultRoot, rootKey: "vault" }] });
    assert.ok(snapshot);
    const snapshotHash = sha256HostedBundleHex(snapshot);
    await artifactStore.put({ bytes: snapshot, sha256: snapshotHash });

    const replace = (failUpload: boolean) => withHostedCanonicalWritePort({
      async persistCanonicalWrite(persistence) {
        assert.ok(persistence.receipt.actions.every((action) => action.kind === "jsonl_append"));
        const externalized = await externalizeHostedCanonicalWriteMediaPayloads({
          persistence, vaultRoot, mediaStore: store.mediaStore,
        });
        await appendHostedCanonicalWriteReceiptToArtifactLog({
          ...externalized, previousStatus: {},
          artifactStore: failUpload ? {
            ...artifactStore,
            async put() { throw new Error("Synthetic receipt upload failure"); },
          } : artifactStore,
        });
      },
    }, () => upsertEvent({ vaultRoot, payload: {
      id: captures[0]!.event.id, kind: "note", occurredAt: now, source: "manual",
      title: "Updated attachment", note: "Use the second attachment.", rawRefs: [replacement.relativePath],
    } }));

    await assert.rejects(replace(true), /Synthetic receipt upload failure/);
    assert.deepEqual((await readEvent({ vaultRoot, eventId: captures[0]!.event.id })).event.rawRefs, [original.relativePath]);
    assert.deepEqual(store.deleteCalls, []);
    assert.deepEqual((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries, catalogue.entries);
    assert.ok(store.storedBytesByMediaId.has(original.mediaId));
    const restored = await restoreHostedWorkspaceRuntimeJobWorkspace({
      vaultRoot: restoredRoot, platform: { artifactStore, logPort: null, mediaStore: store.mediaStore },
      workspace: createWorkspaceState({
        snapshotRef: { hash: snapshotHash, key: "synthetic/rollback-base.bundle", size: snapshot.byteLength, updatedAt: now },
      }),
    });
    assert.deepEqual(store.getCalls, []);
    await restored.materializeWorkspaceArtifacts([original.relativePath]);
    assert.equal(await readFile(path.join(restoredRoot, original.relativePath), "utf8"), "first saved image bytes");
    assert.equal(store.getCalls.length, 1);

    await replace(false);
    assert.deepEqual((await readEvent({ vaultRoot, eventId: captures[0]!.event.id })).event.rawRefs, [replacement.relativePath]);
    assert.deepEqual(store.deleteCalls, []);
    assert.ok((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries.some((entry) => entry.mediaId === original.mediaId));
    await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore: store.mediaStore });
    assert.deepEqual(store.deleteCalls, [original.mediaId]);
    assert.deepEqual((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries, [replacement]);
    assert.equal(store.storedBytesByMediaId.has(original.mediaId), false);
    assert.ok(store.storedBytesByMediaId.has(replacement.mediaId));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("acknowledged capture receipts recover media references without a newer snapshot", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "murph-media-receipt-recovery-"));
  const vaultRoot = path.join(root, "live");
  const restoredRoot = path.join(root, "restored");
  const { mediaStore, getCalls } = createHostedRuntimeMediaStoreStub();
  const persisted: HostedCanonicalWritePersistenceInput[] = [];
  try {
    // The older checkpoint has only the initialized vault, before this capture.
    await initializeVault({ vaultRoot, createdAt: "2026-01-01T00:00:00.000Z" });
    await initializeVault({ vaultRoot: restoredRoot, createdAt: "2026-01-01T00:00:00.000Z" });
    const bytes = Buffer.from("receipt recovery image bytes");
    const sourcePath = path.join(root, "receipt.png");
    await writeFile(sourcePath, bytes);
    const capture = await withHostedCanonicalWritePort({
      async persistCanonicalWrite(persistence) {
        persisted.push(await externalizeHostedCanonicalWriteMediaPayloads({ persistence, mediaStore, vaultRoot }));
      },
    }, () => addCapture({
      vaultRoot,
      draft: { occurredAt: "2026-01-01T00:00:00.000Z", source: "manual", title: "Saved image", note: "Durable reference." },
      attachments: [{ role: "photo", sourcePath }],
    }));
    const relativePath = capture.event.attachments?.[0]?.relativePath;
    assert.ok(relativePath);
    assert.ok(persisted.some(({ receipt }) => receipt.actions.some((action) => action.kind === "raw_upsert" && action.mediaRef)));
    assert.ok(persisted.every(({ payloads }) => payloads.every((payload) => !Buffer.from(payload.bytes).equals(bytes))));
    await rm(vaultRoot, { recursive: true, force: true });
    for (const persistence of persisted) {
      const receipt = parseHostedCanonicalWriteReceiptArtifact(JSON.stringify(persistence.receipt));
      assert.ok(receipt);
      const replay = () => applyHostedCanonicalWriteReceiptWithMedia({
        receipt, vaultRoot: restoredRoot,
        readPayload: async (ref) => persistence.payloads.find((payload) => payload.sha256 === ref.sha256)?.bytes ?? null,
      });
      await replay();
      await replay();
    }
    assert.deepEqual(getCalls, []);
    await assert.rejects(readFile(path.join(restoredRoot, relativePath)), { code: "ENOENT" });
    const { artifactStore } = createHostedRuntimeArtifactStoreStub();
    const materialize = createHostedArtifactMaterializer({
      artifactResolver: createHostedArtifactResolver({ artifactStore }), bundles: [],
      materializedArtifactPaths: new Set(), mediaStore, operatorHomeRoot: path.join(root, "home"), vaultRoot: restoredRoot,
    });
    assert.equal((await materialize([relativePath])).missingArtifactPaths.size, 0);
    assert.deepEqual(await readFile(path.join(restoredRoot, relativePath)), bytes);
    assert.equal(getCalls.length, 1);
    await materialize([relativePath]);
    assert.equal(getCalls.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.each([
  { videoMime: "application/octet-stream", withImage: true, external: true },
  { videoMime: null, withImage: true, external: true },
  { videoMime: "video/mp4", withImage: true, external: true },
  { videoMime: "application/octet-stream", withImage: false, external: true },
  { videoMime: "application/octet-stream", withImage: true, external: false },
])("real inbox media receipts recover after workspace loss: %j", async (scenario) => {
  const root = await mkdtemp(path.join(tmpdir(), "murph-inbox-media-replay-"));
  const vaultRoot = path.join(root, "live");
  const restoredRoot = path.join(root, "restored");
  const now = new Date().toISOString();
  const { artifactStore } = createHostedRuntimeArtifactStoreStub();
  const { mediaStore, getCalls } = createHostedRuntimeMediaStoreStub();
  let status: ReturnType<typeof hostedCanonicalWriteReceiptLogStatusFields> = {};
  const receipts: HostedCanonicalWritePersistenceInput[] = [];
  const videoBytes = Buffer.from("synthetic video receipt payload");
  const imageBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cGfoAAAAASUVORK5CYII=",
    "base64",
  );
  try {
    await initializeVault({ vaultRoot, createdAt: now });
    const snapshot = await snapshotHostedBundleRoots({
      kind: "vault", roots: [{ root: vaultRoot, rootKey: "vault" }],
    });
    assert.ok(snapshot);
    const snapshotHash = sha256HostedBundleHex(snapshot);
    await artifactStore.put({ bytes: snapshot, sha256: snapshotHash });
    const input = await normalizeParsedEmailMessage({
      message: {
        attachments: [
          ...(scenario.withImage ? [{ fileName: "photo.png", contentType: "image/png", data: imageBytes }] : []),
          { fileName: "clip.mp4", contentType: scenario.videoMime, data: videoBytes },
        ].map((attachment) => ({
          ...attachment, contentDisposition: "attachment", contentId: null,
          contentTransferEncoding: null,
        })),
        bcc: [], cc: [], from: "sender@example.test", to: ["assistant@example.test"],
        headers: {}, html: null, inReplyTo: null, messageId: "media-receipt@example.test",
        occurredAt: now, receivedAt: now, rawHash: "a".repeat(64), rawSize: 0,
        references: [], replyTo: [], subject: "Media references", text: "Keep these attachments.",
      },
    });
    assert.equal(input.attachments?.at(-1)?.kind, "video");
    const capture = await withHostedCanonicalWritePort({
      async persistCanonicalWrite(persistence) {
        const externalized = await externalizeHostedCanonicalWriteMediaPayloads({
          persistence, vaultRoot, mediaStore: scenario.external ? mediaStore : null,
        });
        if (!scenario.external) assert.equal(externalized, persistence);
        receipts.push(externalized);
        const update = await appendHostedCanonicalWriteReceiptToArtifactLog({
          ...externalized, artifactStore, previousStatus: status,
        });
        status = hostedCanonicalWriteReceiptLogStatusFields(update);
      },
    }, async () => {
      const persisted = await persistCanonicalInboxCapture({
        vaultRoot, input, storedAt: now, captureId: "cap_mixed_receipt",
        eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W3",
      });
      await applyCanonicalWriteBatch({
        vaultRoot, operationType: "receipt_followup", summary: "Persist a later note",
        audit: { action: "event_upsert", commandName: "test.mediaReceipt", summary: "Persist a later note" },
        textWrites: [{ relativePath: "bank/receipt-note.md", content: "Later durable note.\n" }],
      });
      return persisted;
    });
    const videoPath = capture.stored.attachments.at(-1)?.storedPath;
    assert.ok(videoPath);
    await rm(vaultRoot, { recursive: true, force: true });
    const restored = await restoreHostedWorkspaceRuntimeJobWorkspace({
      vaultRoot: restoredRoot,
      platform: { artifactStore, logPort: null, mediaStore: scenario.external ? mediaStore : null },
      workspace: createWorkspaceState({
        redactedStatus: status,
        snapshotRef: { hash: snapshotHash, key: "synthetic/media-base.bundle", size: snapshot.byteLength, updatedAt: now },
      }),
    });
    assert.equal(restored.canonicalWriteReceiptRecoveryFailed, false);
    assert.equal(restored.canonicalWriteReceiptCount, receipts.length);
    assert.deepEqual(getCalls, []);
    assert.equal(await readFile(path.join(restoredRoot, "bank/receipt-note.md"), "utf8"), "Later durable note.\n");
    const ledger = await readFile(path.join(restoredRoot, capture.capture.relativePath), "utf8");
    assert.ok(ledger.includes(videoPath));
    if (scenario.external) {
      await assert.rejects(readFile(path.join(restoredRoot, videoPath)), { code: "ENOENT" });
      const reference = (await readHostedMediaReferenceCatalogue({ vaultRoot: restoredRoot }))
        .entries.find((entry) => entry.relativePath === videoPath);
      assert.equal(reference?.mediaKind, "video");
      assert.ok(receipts.every(({ payloads }) => payloads.every((payload) => !Buffer.from(payload.bytes).equals(videoBytes))));
    }
    await restored.materializeWorkspaceArtifacts([videoPath]);
    assert.deepEqual(await readFile(path.join(restoredRoot, videoPath)), videoBytes);
    assert.equal(getCalls.length, scenario.external ? 1 : 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test.each([
  { kind: "image", retired: false },
  { kind: "video", retired: false },
  { kind: "image", retired: true },
  { kind: "video", retired: true },
] as const)("reference-only media saves survive expiry and receipt recovery: %j", async (scenario) => {
  const root = await mkdtemp(path.join(tmpdir(), "murph-media-reference-save-"));
  const vaultRoot = path.join(root, "live");
  const restoredRoot = path.join(root, "restored");
  const { artifactStore } = createHostedRuntimeArtifactStoreStub();
  const store = createHostedRuntimeMediaStoreStub();
  const deadlines = new Map<string, string | null>();
  const retiredIds = new Set<string>();
  const recordCalls: string[] = [];
  const mediaStore: HostedRuntimeMediaStore = {
    ...store.mediaStore,
    async put(descriptor) {
      await store.mediaStore.put(descriptor);
      deadlines.set(descriptor.mediaId, descriptor.expiresAt ?? null);
    },
    async record(descriptor) {
      recordCalls.push(descriptor.mediaId);
      if (retiredIds.has(descriptor.mediaId)) throw new Error("Media lifetime registration was rejected.");
      deadlines.set(descriptor.mediaId, descriptor.expiresAt ?? null);
    },
  };
  // The transport stub enforces the DO's tested retirement contract; the real
  // owner ordering and no-workspace-wake proof live in user-runner-alarm.test.ts.
  const cleanupExpired = (now: number) => {
    for (const [id, deadline] of deadlines) {
      if (deadline !== null && Date.parse(deadline) <= now) {
        retiredIds.add(id);
        store.storedBytesByMediaId.delete(id);
      }
    }
  };
  const now = new Date().toISOString();
  const lifetimeDays = scenario.kind === "image" ? 14 : 3;
  const capturedAt = new Date(Date.parse(now) - lifetimeDays * 86_400_000 + 60_000).toISOString();
  const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cGfoAAAAASUVORK5CYII=", "base64");
  let status: ReturnType<typeof hostedCanonicalWriteReceiptLogStatusFields> = {};
  const receipts: HostedCanonicalWritePersistenceInput[] = [];
  try {
    await initializeVault({ vaultRoot, createdAt: capturedAt });
    const input = await normalizeParsedEmailMessage({
      message: {
        attachments: [
          { fileName: "reference.png", contentType: "image/png", data: imageBytes },
          { fileName: "reference.mp4", contentType: "video/mp4", data: Buffer.from("reference video bytes") },
        ].map((attachment) => ({ ...attachment, contentDisposition: "attachment", contentId: null, contentTransferEncoding: null })),
        bcc: [], cc: [], from: "sender@example.test", to: ["assistant@example.test"],
        headers: {}, html: null, inReplyTo: null, messageId: "reference-save@example.test",
        occurredAt: capturedAt, receivedAt: capturedAt, rawHash: "b".repeat(64), rawSize: 0,
        references: [], replyTo: [], subject: "Reference material", text: "Attachments for later.",
      },
    });
    await persistCanonicalInboxCapture({ vaultRoot, input, storedAt: capturedAt, captureId: "cap_reference_save", eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W3" });
    await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore });
    await withHostedCanonicalWritePort({
      async persistCanonicalWrite(persistence) {
        // A non-media event must not access the workspace media publisher.
        assert.equal(await externalizeHostedCanonicalWriteMediaPayloads({
          persistence, mediaStore, vaultRoot: path.join(root, "absent-vault"),
        }), persistence);
        await assert.rejects(stat(path.join(root, "absent-vault")), { code: "ENOENT" });
      },
    }, () => upsertEvent({ vaultRoot, payload: {
      kind: "note", occurredAt: now, source: "manual", title: "Text-only note", note: "No attachment references.",
    } }));
    const catalogue = await readHostedMediaReferenceCatalogue({ vaultRoot });
    const selected = catalogue.entries.find((entry) => entry.mediaKind === scenario.kind)!;
    const unreferenced = catalogue.entries.find((entry) => entry.mediaKind !== scenario.kind)!;
    assert.ok(selected.expiresAt);
    const selectedBytes = Buffer.from(store.storedBytesByMediaId.get(selected.mediaId)!);
    for (const entry of catalogue.entries) await rm(path.join(vaultRoot, entry.relativePath));
    const snapshot = await snapshotHostedBundleRoots({ kind: "vault", roots: [{ root: vaultRoot, rootKey: "vault" }] });
    assert.ok(snapshot);
    const snapshotHash = sha256HostedBundleHex(snapshot);
    await artifactStore.put({ bytes: snapshot, sha256: snapshotHash });
    const afterExpiry = Date.parse(now) + 91 * 86_400_000;
    if (scenario.retired) cleanupExpired(afterExpiry);
    const save = () => withHostedCanonicalWritePort({
      async persistCanonicalWrite(persistence) {
        assert.ok(persistence.receipt.actions.every((action) => action.kind === "jsonl_append"));
        const externalized = await externalizeHostedCanonicalWriteMediaPayloads({ persistence, vaultRoot, mediaStore });
        receipts.push(externalized);
        status = hostedCanonicalWriteReceiptLogStatusFields(await appendHostedCanonicalWriteReceiptToArtifactLog({
          ...externalized, artifactStore, previousStatus: status,
        }));
      },
    }, () => upsertEvent({ vaultRoot, payload: {
      kind: "note", occurredAt: now, source: "manual", title: "Saved source evidence", note: "Durable source reference.", rawRefs: [selected.relativePath],
    } }));
    if (scenario.retired) {
      await assert.rejects(save(), /Media lifetime registration was rejected/);
      assert.equal(receipts.length, 0);
      assert.equal(store.storedBytesByMediaId.has(selected.mediaId), false);
      assert.ok((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries.find((entry) => entry.mediaId === selected.mediaId)?.expiresAt);
      return;
    }
    const saved = await save();
    assert.deepEqual(recordCalls, [selected.mediaId]);
    assert.equal(deadlines.get(selected.mediaId), null);
    cleanupExpired(afterExpiry);
    assert.equal(store.storedBytesByMediaId.has(selected.mediaId), true);
    assert.equal(store.storedBytesByMediaId.has(unreferenced.mediaId), false);
    assert.equal(store.putCalls.length, 2);
    assert.deepEqual(store.getCalls, []);
    await rm(vaultRoot, { recursive: true, force: true });
    const restored = await restoreHostedWorkspaceRuntimeJobWorkspace({
      vaultRoot: restoredRoot, platform: { artifactStore, logPort: null, mediaStore },
      workspace: createWorkspaceState({ redactedStatus: status,
        snapshotRef: { hash: snapshotHash, key: "synthetic/reference-base.bundle", size: snapshot.byteLength, updatedAt: now },
      }),
    });
    assert.equal(restored.canonicalWriteReceiptRecoveryFailed, false);
    assert.equal(restored.canonicalWriteReceiptCount, receipts.length);
    assert.deepEqual(store.getCalls, []);
    assert.ok((await readFile(path.join(restoredRoot, saved.ledgerFile), "utf8")).includes(saved.eventId));
    assert.equal((await readHostedMediaReferenceCatalogue({ vaultRoot: restoredRoot })).entries.find((entry) => entry.mediaId === selected.mediaId)?.expiresAt, null);
    await restored.materializeWorkspaceArtifacts([selected.relativePath]);
    assert.deepEqual(await readFile(path.join(restoredRoot, selected.relativePath)), selectedBytes);
    assert.equal(store.getCalls.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
