import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";
import {
  appendJsonlRecord,
  initializeVault,
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

import {
  createHostedArtifactMaterializer,
  createHostedArtifactResolver,
  createHostedArtifactUploadSink,
} from "../src/hosted-runtime/artifacts.ts";
import {
  externalizeHostedCanonicalWriteMediaPayloads,
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
  } finally {
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
