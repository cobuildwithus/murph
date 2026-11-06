import { readVerifiedAssistantVaultImageBytes, resolveAssistantVaultFileResponseMedia, resolveAssistantVaultImageResponseMedia } from "@murphai/assistant-engine/assistant-outbox";
import { materializeVaultMedia, resolveGenerateImageReferences } from "@murphai/assistant-engine/assistant-codex";
import { HostedRuntimeMediaReadError } from "../src/hosted-runtime/platform.ts";
import { createMealMediaStore } from "./hosted-meal-media.harness.ts";
import { runHostedMealMediaMaintenance, createHostedMealMediaBudget } from "../src/hosted-runtime/meal-media-maintenance.ts";
import { HostedRuntimeMediaWriteError } from "../src/hosted-runtime/platform.ts";
async function uploadCommittedHostedMealMediaReferences(input: { vaultRoot: string; mediaStore: HostedRuntimeMediaStore }) {
  return runHostedMealMediaMaintenance({ ...input, budget: createHostedMealMediaBudget(), signal: new AbortController().signal, persistRetry: async () => {} });
}
import { showMealRecord, removeAutomaticMealPhotoRecord } from "@murphai/vault-usecases/records";
import * as pendingInputIndex from "../src/hosted-runtime/pending-input-index.ts";
import { parseHostedCanonicalWriteReceiptArtifact } from "../src/hosted-runtime/canonical-write-receipt.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test, vi } from "vitest";
import {
  addCapture,
  addMeal,
  deleteEvent,
  runMealPhotoMaintenance,
  addCaptureWithLookup,
  applyCanonicalWriteBatch,
  appendJsonlRecord,
  initializeVault,
  findCaptureByLookup,
  readEvent,
  runGeneratedImageCaptureRetention,
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
import { createPlatform, createSnapshotFixtureRef, createWorkspaceState } from "./hosted-runtime-workspace-entrypoint.harness.ts";

import {
  createHostedArtifactMaterializer,
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
  writeHostedMediaReferenceCatalogue,
} from "../src/hosted-runtime/media-references.ts";

test.each(["warm", "restored"])("retires an expired generated capture in a %s workspace", async (workspace) => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-expired-generated-capture-"));
  const recordedAt = "2030-01-01T00:00:00.000Z";
  const expiresAt = "2030-01-15T00:00:00.000Z";
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(recordedAt));
  try {
    await initializeVault({ vaultRoot, title: "Generated capture expiry", timezone: "UTC" });
    const sourcePath = path.join(vaultRoot, "source.png");
    await writeFile(sourcePath, "synthetic image payload");
    const capture = await addCaptureWithLookup({
      vaultRoot,
      lookupKey: "generated:hosted-expiry",
      lookupAttachmentRole: "media_1",
      attachments: [{ role: "media_1", sourcePath }],
      draft: {
        recordedAt,
        occurredAt: recordedAt,
        source: "derived",
        tags: ["assistant-generated-image", "generated-image"],
        title: "Synthetic generated capture",
        note: "Synthetic retention proof.",
      },
      rawImport: {
        importKind: "capture",
        importedAt: recordedAt,
        source: "murph.generate_image",
        provenance: { generatedImage: { schema: "murph.generated-image.v1" } },
      },
    });
    const attachmentRef = capture.event.attachments![0]!.relativePath;
    const { mediaStore, getCalls } = createHostedRuntimeMediaStoreStub();
    await publishHostedWorkspaceMediaReferencesForSnapshot({ mediaStore, vaultRoot });
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries)
      .toEqual([expect.objectContaining({ relativePath: attachmentRef, expiresAt })]);
    // Hosted snapshots omit externalized bytes; the warm path still has them.
    if (workspace === "restored") await rm(path.join(vaultRoot, attachmentRef));
    clock.mockReturnValue(Date.parse(expiresAt));
    const materialize = createHostedArtifactMaterializer({
      mediaStore,
      operatorHomeRoot: path.join(vaultRoot, ".operator-home"),
      vaultRoot,
    });
    const materializeCandidatePaths = async (paths: readonly string[]) => {
      const result = await materialize(paths);
      return { missingStoredPaths: [...result.missingArtifactPaths.keys()].map((key) => key.slice("vault:".length)) };
    };
    const input = { vaultRoot, now: new Date(expiresAt), materializeCandidatePaths };
    expect(await runGeneratedImageCaptureRetention(input)).toMatchObject({
      blockedCaptureCount: 0, retiredCaptureCount: 1, retiredByteCount: 0, nextEligibleAt: null,
    });
    expect(getCalls).toHaveLength(0);
    expect(await findCaptureByLookup({ vaultRoot, lookupKey: "generated:hosted-expiry" }))
      .toMatchObject({ status: "deleted" });
    expect(await runGeneratedImageCaptureRetention(input)).toMatchObject({
      blockedCaptureCount: 0, retiredCaptureCount: 0, nextEligibleAt: null,
    });
  } finally {
    clock.mockRestore();
    await rm(vaultRoot, { recursive: true, force: true });
  }
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

test("v2 materialization derives bounded local file availability without a cache index", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "murph-local-artifact-proof-"));
  const vaultRoot = path.join(root, "vault");
  const operatorHomeRoot = path.join(root, "home");
  try {
    await mkdir(vaultRoot);
    await mkdir(operatorHomeRoot);
    await mkdir(path.join(vaultRoot, "directory"));
    await writeFile(path.join(vaultRoot, "existing.txt"), "existing canonical bytes");
    await writeFile(path.join(operatorHomeRoot, "rollout.jsonl"), "{}\n");
    await writeFile(path.join(root, "outside.txt"), "outside");
    await symlink(root, path.join(vaultRoot, "linked"));
    await symlink(path.join(root, "outside.txt"), path.join(vaultRoot, "linked-file"));
    const materialize = createHostedArtifactMaterializer({ operatorHomeRoot, vaultRoot });
    const available = await materialize(["existing.txt", "operator-home:rollout.jsonl"]);
    assert.deepEqual([...available.materializedArtifactPaths].sort(), ["operator-home:rollout.jsonl", "vault:existing.txt"]);
    assert.equal(available.missingArtifactPaths.size, 0);
    const indexPath = path.join(vaultRoot, ".runtime/operations/assistant/hosted-materialized-artifacts.json");
    await assert.rejects(stat(indexPath), { code: "ENOENT" });
    await mkdir(path.dirname(indexPath), { recursive: true });
    await writeFile(indexPath, "obsolete index contents");
    const reconstructed = createHostedArtifactMaterializer({ operatorHomeRoot, vaultRoot });
    assert.equal((await reconstructed(["existing.txt"])).missingArtifactPaths.size, 0);
    assert.equal(await readFile(indexPath, "utf8"), "obsolete index contents");
    const rejected = ["missing.txt", "directory", "../outside.txt", "linked/outside.txt", "linked-file"];
    const missing = await materialize(rejected);
    assert.equal(missing.materializedArtifactPaths.size, 0);
    assert.deepEqual([...missing.missingArtifactPaths.keys()], rejected.map((p) => `vault:${p}`));
    const oversized = await materialize(["existing.txt"], { maxFileBytes: 4 });
    assert.deepEqual([...oversized.missingArtifactPaths.keys()], ["vault:existing.txt"]);
    await rm(path.join(vaultRoot, "existing.txt"));
    assert.deepEqual([...(await materialize(["existing.txt"])).missingArtifactPaths.keys()], ["vault:existing.txt"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test.each([false, true])("hosted artifact materializer restores retained inbox media without consulting pending protection (pending=%s)", async (pending) => {
  const pendingProtectionRead = vi.spyOn(pendingInputIndex, "collectHostedPendingAssistantInputMediaRetentionProtections").mockResolvedValue({
    protectedAttachmentIds: [],
    protectedCaptureIds: pending ? ["cap_hosted_media_refs"] : [],
    protectedStoredPaths: [],
  });
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

    expect(pendingProtectionRead).not.toHaveBeenCalled();
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries.map((entry) => ({
      kind: entry.mediaKind, expiresAt: entry.expiresAt,
    }))).toEqual(expect.arrayContaining([
      { kind: "image", expiresAt: "2026-08-30T00:00:00.000Z" },
      { kind: "video", expiresAt: "2026-07-01T00:00:00.000Z" },
    ]));
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
    expect(pendingProtectionRead).not.toHaveBeenCalled();
    assert.equal(putCalls.length, 2);

    await rm(path.join(vaultRoot, sourceDirectory), {
      force: true,
      recursive: true,
    });

    const materialize = createHostedArtifactMaterializer({
      mediaStore,
      operatorHomeRoot,
      vaultRoot,
    });

    const result = await materialize([imagePath, videoPath]);
    assert.deepEqual([...result.missingArtifactPaths.keys()], []);
    assert.deepEqual([...result.materializedArtifactPaths].sort(), [
      `vault:${imagePath}`,
      `vault:${videoPath}`,
    ].sort());
    const deniedLocalMedia = await materialize([imagePath], { maxFileBytes: 1 });
    assert.deepEqual([...deniedLocalMedia.missingArtifactPaths.keys()], [`vault:${imagePath}`]);
    assert.equal(deniedLocalMedia.materializedArtifactPaths.size, 0);
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
    assert.deepEqual([...videoExpired.missingArtifactPaths.keys()], [`vault:${videoPath}`]);
    assert.deepEqual(await readFile(path.join(vaultRoot, imagePath)), imageBytes);
    await assert.rejects(readFile(path.join(vaultRoot, videoPath)), { code: "ENOENT" });
    clock.mockReturnValue(Date.parse("2026-08-29T23:59:59.999Z"));
    assert.equal((await materialize([imagePath])).missingArtifactPaths.size, 0);
    clock.mockReturnValue(Date.parse("2026-08-30T00:00:00.000Z"));
    const expired = await materialize([imagePath, videoPath]);
    assert.equal(expired.missingArtifactPaths.size, 2);
    await assert.rejects(readFile(path.join(vaultRoot, imagePath)), { code: "ENOENT" });
    assert.equal(getCalls.length, 2);
    await assert.rejects(stat(path.join(vaultRoot, ".runtime/operations/assistant/hosted-materialized-artifacts.json")), { code: "ENOENT" });
  } finally {
    clock.mockRestore();
    pendingProtectionRead.mockRestore();
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
    mediaKind: "image" | "video" | "integration-ingest";
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
    mediaKind: "image" | "video" | "integration-ingest";
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
    const materialize = createHostedArtifactMaterializer({
      mediaStore,
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
      vaultRoot: restoredRoot, platform: { ...createPlatform({ artifactBytesByHash: new Map([[snapshotHash, snapshot]]), mailboxPort: null, workspacePort: null }), artifactStore, logPort: null, mediaStore: store.mediaStore },
      workspace: createWorkspaceState({
        snapshotRef: createSnapshotFixtureRef({ hash: snapshotHash, size: snapshot.byteLength }),
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
    const materialize = createHostedArtifactMaterializer({
      mediaStore, operatorHomeRoot: path.join(root, "home"), vaultRoot: restoredRoot,
    });
    assert.equal((await materialize([relativePath])).missingArtifactPaths.size, 0);
    assert.deepEqual(await readFile(path.join(restoredRoot, relativePath)), bytes);
    assert.equal(getCalls.length, 1);
    const indexPath = path.join(restoredRoot, ".runtime/operations/assistant/hosted-materialized-artifacts.json");
    await assert.rejects(stat(indexPath), { code: "ENOENT" });
    const reconstructed = createHostedArtifactMaterializer({
      mediaStore, operatorHomeRoot: path.join(root, "home"), vaultRoot: restoredRoot,
    });
    assert.equal((await reconstructed([relativePath])).missingArtifactPaths.size, 0);
    assert.equal(getCalls.length, 1);
    assert.deepEqual([...(await reconstructed([relativePath], { maxFileBytes: 1 })).missingArtifactPaths.keys()], [`vault:${relativePath}`]);
    assert.equal(getCalls.length, 1);
    await writeFile(path.join(restoredRoot, relativePath), Buffer.alloc(bytes.length));
    assert.equal((await reconstructed([relativePath])).missingArtifactPaths.size, 0);
    assert.deepEqual(await readFile(path.join(restoredRoot, relativePath)), bytes);
    assert.equal(getCalls.length, 2);
    await rm(path.join(restoredRoot, relativePath));
    vi.spyOn(mediaStore, "get").mockResolvedValueOnce(null);
    assert.deepEqual([...(await reconstructed([relativePath])).missingArtifactPaths.keys()], [`vault:${relativePath}`]);
    await assert.rejects(stat(indexPath), { code: "ENOENT" });
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
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==",
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
      platform: { ...createPlatform({ artifactBytesByHash: new Map([[snapshotHash, snapshot]]), mailboxPort: null, workspacePort: null }), artifactStore, logPort: null, mediaStore: scenario.external ? mediaStore : null },
      workspace: createWorkspaceState({
        redactedStatus: status,
        snapshotRef: createSnapshotFixtureRef({ hash: snapshotHash, size: snapshot.byteLength }),
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
      if (retiredIds.has(descriptor.mediaId)) throw new HostedRuntimeMediaWriteError({ cause: new Error("Media lifetime registration was rejected."), retryable: true });
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
  const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64");
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
      vaultRoot: restoredRoot, platform: { ...createPlatform({ artifactBytesByHash: new Map([[snapshotHash, snapshot]]), mailboxPort: null, workspacePort: null }), artifactStore, logPort: null, mediaStore },
      workspace: createWorkspaceState({ redactedStatus: status,
        snapshotRef: createSnapshotFixtureRef({ hash: snapshotHash, size: snapshot.byteLength }),
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

test.each(["warm", "restored"].flatMap(workspaceKind => ["receipt", "receipt_response", "put_response", "registration_response"].map(failureKind => ({ workspaceKind, failureKind }))))("meal retention recovers $failureKind failure in a $workspaceKind workspace", async ({ workspaceKind, failureKind }) => {
  const root = await mkdtemp(path.join(tmpdir(), "murph-meal-retention-retry-"));
  let vaultRoot = path.join(root, "live");
  const store = createHostedRuntimeMediaStoreStub();
  const retiredIds = new Set<string>();
  const lifetimes = new Map<string, string | null>();
  let losePutResponse = failureKind === "put_response";
  let loseRegistrationResponse = failureKind === "registration_response";
  let failDelete = false;
  const mediaStore: HostedRuntimeMediaStore = {
    ...store.mediaStore,
    async record(descriptor) {
      if (retiredIds.has(descriptor.mediaId)) throw new HostedRuntimeMediaWriteError({ cause: new Error("Media lifetime registration was rejected."), retryable: true });
      lifetimes.set(descriptor.mediaId, descriptor.expiresAt ?? null);
      if (loseRegistrationResponse) {
        loseRegistrationResponse = false;
        throw new HostedRuntimeMediaWriteError({ cause: new Error("Synthetic lost registration response"), retryable: true });
      }
    },
    async put(descriptor) {
      if (retiredIds.has(descriptor.mediaId)) throw new HostedRuntimeMediaWriteError({ cause: new Error("Runtime upload admission was rejected."), retryable: true });
      await store.mediaStore.put(descriptor);
      // Model the remote PUT's lifetime registration before its reply is lost.
      lifetimes.set(descriptor.mediaId, descriptor.expiresAt ?? null);
      if (losePutResponse) {
        losePutResponse = false;
        throw new HostedRuntimeMediaWriteError({ cause: new Error("Synthetic lost media PUT response"), retryable: true });
      }
    },
    async delete(descriptor) {
      if (failDelete) { failDelete = false; throw new HostedRuntimeMediaWriteError({ cause: new Error("Synthetic media deletion failure"), retryable: true }); }
      if (!lifetimes.has(descriptor.mediaId) && !retiredIds.has(descriptor.mediaId)) throw new HostedRuntimeMediaWriteError({ cause: new Error("HTTP 409: absent retirement"), retryable: true });
      retiredIds.add(descriptor.mediaId);
      lifetimes.delete(descriptor.mediaId);
      await store.mediaStore.delete?.(descriptor);
    },
  };
  const { artifactStore, storedBytesByHash } = createHostedRuntimeArtifactStoreStub();
  let rejectedReceipt = "";
  const capturedAt = "2030-01-01T12:00:00.000Z";
  const now = new Date("2030-04-01T12:00:00.000Z");
  const accepted: { snapshot?: { bytes: Uint8Array; hash: string } } = {};
  const checkpoint = async () => {
    await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore });
    const bytes = await snapshotHostedBundleRoots({ kind: "vault", roots: [{ root: vaultRoot, rootKey: "vault" }] });
    assert.ok(bytes);
    const hash = sha256HostedBundleHex(bytes);
    await artifactStore.put({ bytes, sha256: hash });
    accepted.snapshot = { bytes, hash };
    await uploadCommittedHostedMealMediaReferences({ vaultRoot, mediaStore });
  };
  try {
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const photoPath = path.join(root, "fixture.png");
    const photoBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64");
    await writeFile(photoPath, photoBytes);
    const first = await addMeal({ vaultRoot, photoPath, photoCapturedAt: capturedAt, occurredAt: capturedAt });
    const maintain = (failReceipt: boolean) => withHostedCanonicalWritePort({
      async persistCanonicalWrite(persistence) {
        const externalized = await externalizeHostedCanonicalWriteMediaPayloads({ persistence, mediaStore, vaultRoot });
        if (failReceipt) {
          rejectedReceipt = `${JSON.stringify(externalized.receipt, null, 2)}\n`;
          // Reproduce an old runner's acknowledged pre-receipt upload. New
          // runners must also recover its already-terminal media identity.
          const entry = (await readHostedMediaReferenceCatalogue({ vaultRoot })).entries[0]!;
          await mediaStore.put({ ...entry, bytes: new Uint8Array(await readFile(path.join(vaultRoot, entry.relativePath))) });
        }
        await appendHostedCanonicalWriteReceiptToArtifactLog({
          ...externalized, previousStatus: {},
          artifactStore: failReceipt ? {
            ...artifactStore,
            async put(input) {
              if (failureKind === "receipt_response") await artifactStore.put(input);
              throw new Error("Synthetic receipt upload failure");
            },
          } : artifactStore,
        });
      },
    }, () => runMealPhotoMaintenance({ vaultRoot, now }));

    const receiptFailure = failureKind.startsWith("receipt");
    if (receiptFailure) {
      await expect(maintain(true)).rejects.toThrow("Synthetic receipt upload failure");
      expect([...storedBytesByHash.values()].some(bytes => Buffer.from(bytes).toString("utf8") === rejectedReceipt)).toBe(failureKind === "receipt_response");
      expect((await readEvent({ vaultRoot, eventId: first.event.id })).event).not.toHaveProperty("photoThumbnail");
      expect(await readFile(path.join(vaultRoot, first.photo!.relativePath))).toEqual(photoBytes);
      expect(await uploadCommittedHostedMealMediaReferences({ vaultRoot, mediaStore })).toMatchObject({ retired: 1 });
      expect(retiredIds.has(store.putCalls[0]!.mediaId)).toBe(true);
      await checkpoint();
    } else {
      await maintain(false);
      expect(store.putCalls).toHaveLength(0);
      await checkpoint();
      // A failed delivery effect cannot roll back the accepted canonical meal.
      expect((await readEvent({ vaultRoot, eventId: first.event.id })).event).toHaveProperty("photoThumbnail");
      expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries[0]).toMatchObject({ pendingUpload: true, expiresAt: null });
      expect([...lifetimes.values()]).toEqual([null]);
    }
    const firstMediaId = [...retiredIds][0] ?? [...lifetimes.keys()][0]!;

    if (workspaceKind === "restored") {
      assert.ok(accepted.snapshot);
      const { bytes, hash } = accepted.snapshot;
      vaultRoot = path.join(root, "restored");
      await restoreHostedWorkspaceRuntimeJobWorkspace({ vaultRoot,
        platform: { ...createPlatform({ artifactBytesByHash: new Map([[hash, bytes]]), mailboxPort: null, workspacePort: null }), artifactStore, logPort: null, mediaStore },
        workspace: createWorkspaceState({ snapshotRef: createSnapshotFixtureRef({ hash, size: bytes.byteLength }) }),
      });
    }

    const second = await addMeal({ vaultRoot, photoPath, photoCapturedAt: capturedAt, occurredAt: capturedAt });
    await expect(maintain(false)).resolves.toMatchObject({ thumbnailCount: receiptFailure ? 2 : 1, retiredPhotoCount: receiptFailure ? 2 : 1, blockedMealCount: 0, hasMore: false, nextEligibleAt: null });
    await checkpoint();
    expect(store.storedBytesByMediaId.has(firstMediaId)).toBe(!receiptFailure);
    for (const meal of [first, second]) {
      expect(JSON.parse(await readFile(path.join(vaultRoot, meal.photo!.relativePath), "utf8"))).toMatchObject({ reason: "meal_photo_retention" });
      const current = (await readEvent({ vaultRoot, eventId: meal.event.id })).event;
      assert.equal(current.kind, "meal");
      assert.ok(current.photoThumbnail);
      expect([...await readFile(path.join(vaultRoot, current.photoThumbnail.relativePath))].slice(0, 2)).toEqual([255, 216]);
    }
    await expect(maintain(false)).resolves.toMatchObject({ thumbnailCount: 0, retiredPhotoCount: 0, blockedMealCount: 0, nextEligibleAt: null });
    expect(store.storedBytesByMediaId.size).toBe(2);
    for (const meal of [first, second]) await deleteEvent({ vaultRoot, eventId: meal.event.id });
    failDelete = true;
    await expect(publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore })).rejects.toThrow("Synthetic media deletion failure");
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries).toHaveLength(2);
    expect(await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore })).toMatchObject({ prunedMediaCount: 2 });
    await checkpoint();
    expect(store.storedBytesByMediaId.size).toBe(0);
    expect(lifetimes.size).toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.each(["before_registration", "partial_put", "old_catalogue"])("cold receipt recovery retains meal upload intent across orphan grace: %s", async (failureKind) => {
  const root = await mkdtemp(path.join(tmpdir(), "murph-meal-pending-recovery-"));
  let vaultRoot = path.join(root, "live");
  const store = createHostedRuntimeMediaStoreStub();
  const { artifactStore } = createHostedRuntimeArtifactStoreStub();
  const lifetimes = new Map<string, number | null>();
  const retired = new Set<string>();
  let failPut = failureKind === "partial_put";
  let clockMs = Date.parse("2030-04-01T12:00:00.000Z");
  const mediaStore: HostedRuntimeMediaStore = { ...store.mediaStore,
    async record(descriptor) {
      if (retired.has(descriptor.mediaId)) throw new HostedRuntimeMediaWriteError({ cause: new Error("Terminal media identity"), retryable: true });
      lifetimes.set(descriptor.mediaId, descriptor.expiresAt == null ? null : Date.parse(descriptor.expiresAt));
    },
    async put(descriptor) {
      if (retired.has(descriptor.mediaId)) throw new HostedRuntimeMediaWriteError({ cause: new Error("Terminal media identity"), retryable: true });
      // Admission creates provisional grace only when no registration exists.
      if (!lifetimes.has(descriptor.mediaId)) lifetimes.set(descriptor.mediaId, clockMs + 65 * 60_000);
      await store.mediaStore.put(descriptor);
      if (failPut) { failPut = false; throw new HostedRuntimeMediaWriteError({ cause: new Error("Synthetic interrupted PUT before remote registration"), retryable: true }); }
      lifetimes.set(descriptor.mediaId, null);
    },
    async delete(descriptor) {
      if (!lifetimes.has(descriptor.mediaId) && !retired.has(descriptor.mediaId)) throw new HostedRuntimeMediaWriteError({ cause: new Error("HTTP 409: absent retirement"), retryable: true });
      retired.add(descriptor.mediaId);
      lifetimes.delete(descriptor.mediaId);
      await store.mediaStore.delete?.(descriptor);
    },
  };
  try {
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const photoPath = path.join(root, "fixture.png");
    await writeFile(photoPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64"));
    const capturedAt = "2030-01-01T12:00:00.000Z";
    const meal = await addMeal({ vaultRoot, photoPath, photoCapturedAt: capturedAt, occurredAt: capturedAt });
    const baseline = await snapshotHostedBundleRoots({ kind: "vault", roots: [{ root: vaultRoot, rootKey: "vault" }] });
    assert.ok(baseline);
    const baselineHash = sha256HostedBundleHex(baseline);
    await artifactStore.put({ bytes: baseline, sha256: baselineHash });
    let status = {};
    await withHostedCanonicalWritePort({ async persistCanonicalWrite(persistence) {
      const externalized = await externalizeHostedCanonicalWriteMediaPayloads({ persistence, mediaStore, vaultRoot });
      status = hostedCanonicalWriteReceiptLogStatusFields(await appendHostedCanonicalWriteReceiptToArtifactLog({
        ...externalized, artifactStore, previousStatus: status,
      }));
    } }, () => runMealPhotoMaintenance({ vaultRoot, now: new Date(clockMs) }));
    expect(store.putCalls).toHaveLength(0);
    expect(lifetimes.size).toBe(0);

    // The receipt committed, but no delivery promotion or snapshot took place.
    // Restore more than one orphan-grace window later from the older snapshot.
    clockMs += 2 * 60 * 60_000;
    vaultRoot = path.join(root, "receipt-restored");
    const restored = await restoreHostedWorkspaceRuntimeJobWorkspace({ vaultRoot,
      platform: { ...createPlatform({ artifactBytesByHash: new Map([[baselineHash, baseline]]), mailboxPort: null, workspacePort: null }), artifactStore, logPort: null, mediaStore },
      workspace: createWorkspaceState({ snapshotRef: createSnapshotFixtureRef({ hash: baselineHash, size: baseline.byteLength }), redactedStatus: status }),
    });
    expect(restored.canonicalWriteReceiptCount).toBe(1);
    expect(restored).not.toHaveProperty("mealMediaUploadStateChanged");
    await uploadCommittedHostedMealMediaReferences({ vaultRoot, mediaStore });
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries[0]).toMatchObject({ pendingUpload: failureKind === "partial_put" });
    expect(store.putCalls).toHaveLength(1);
    clockMs += 2 * 60 * 60_000;
    for (const [mediaId, expiry] of lifetimes) {
      if (expiry !== null && expiry <= clockMs) await mediaStore.delete?.({ mediaId });
    }
    expect(retired.size).toBe(0);
    await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore });
    if (failureKind === "old_catalogue") {
      // An older runner ignores the field when writing its next catalogue.
      const catalogue = await readHostedMediaReferenceCatalogue({ vaultRoot });
      for (const entry of catalogue.entries) delete entry.pendingUpload;
      await writeHostedMediaReferenceCatalogue({ vaultRoot, catalogue });
    }
    const pending = await snapshotHostedBundleRoots({ kind: "vault", roots: [{ root: vaultRoot, rootKey: "vault" }] });
    assert.ok(pending);
    const pendingHash = sha256HostedBundleHex(pending);
    await artifactStore.put({ bytes: pending, sha256: pendingHash });
    vaultRoot = path.join(root, "snapshot-restored");
    await restoreHostedWorkspaceRuntimeJobWorkspace({ vaultRoot,
      platform: { ...createPlatform({ artifactBytesByHash: new Map([[pendingHash, pending]]), mailboxPort: null, workspacePort: null }), artifactStore, logPort: null, mediaStore },
      workspace: createWorkspaceState({ snapshotRef: createSnapshotFixtureRef({ hash: pendingHash, size: pending.byteLength }) }),
    });
    await uploadCommittedHostedMealMediaReferences({ vaultRoot, mediaStore });
    expect(store.storedBytesByMediaId.size).toBe(1);
    expect(new Set(store.putCalls.map(call => call.mediaId)).size).toBe(1);
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries[0]).toMatchObject({ pendingUpload: false });

    // The next checkpoint saves completion. Further cold starts do no PUTs.
    await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore });
    const settled = await snapshotHostedBundleRoots({ kind: "vault", roots: [{ root: vaultRoot, rootKey: "vault" }] });
    assert.ok(settled);
    const settledHash = sha256HostedBundleHex(settled);
    await artifactStore.put({ bytes: settled, sha256: settledHash });
    const putCount = store.putCalls.length;
    vaultRoot = path.join(root, "settled-restored");
    await restoreHostedWorkspaceRuntimeJobWorkspace({ vaultRoot,
      platform: { ...createPlatform({ artifactBytesByHash: new Map([[settledHash, settled]]), mailboxPort: null, workspacePort: null }), artifactStore, logPort: null, mediaStore },
      workspace: createWorkspaceState({ snapshotRef: createSnapshotFixtureRef({ hash: settledHash, size: settled.byteLength }) }),
    });
    expect(store.putCalls).toHaveLength(putCount);
    await deleteEvent({ vaultRoot, eventId: meal.event.id });
    await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore });
    expect(store.storedBytesByMediaId.size).toBe(0);
    expect(lifetimes.size).toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("meal thumbnail and full-photo deletion survives canonical receipt replay and prunes encrypted objects", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "murph-meal-media-replay-"));
  const vaultRoot = path.join(root, "live"), restoredRoot = path.join(root, "restored");
  const faithful = createMealMediaStore();
  const store = { mediaStore: faithful.mediaStore, storedBytesByMediaId: faithful.bytes, get putCalls() { return faithful.calls.filter(call => call.operation === "put"); } };
  const persisted: HostedCanonicalWritePersistenceInput[] = [];
  try {
    await initializeVault({ vaultRoot, timezone: "UTC" });
    await initializeVault({ vaultRoot: restoredRoot, timezone: "UTC" });
    const photoPath = path.join(root, "fixture.png");
    await writeFile(photoPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64"));
    const captureTime = "2030-01-01T12:00:00.000Z";
    await withHostedCanonicalWritePort({
      async persistCanonicalWrite(persistence) { persisted.push(await externalizeHostedCanonicalWriteMediaPayloads({ persistence, mediaStore: store.mediaStore, vaultRoot })); },
    }, async () => {
      const meal = await addMeal({ vaultRoot, photoPath, photoCapturedAt: captureTime, occurredAt: captureTime });
      expect(store.putCalls).toHaveLength(0);
      expect(await runMealPhotoMaintenance({ vaultRoot, now: new Date(captureTime) })).toMatchObject({ thumbnailCount: 1, blockedMealCount: 0 });
      const refs = (await readHostedMediaReferenceCatalogue({ vaultRoot })).entries;
      expect(refs).toHaveLength(1);
      expect(store.putCalls).toHaveLength(0);
      expect(refs[0]).toMatchObject({ pendingUpload: true, expiresAt: null });
      // An older runner may already have uploaded this receipt's delivery copy.
      const entry = refs[0]!;
      await store.mediaStore.put({ ...entry, bytes: new Uint8Array(await readFile(path.join(vaultRoot, entry.relativePath))) });
      await deleteEvent({ vaultRoot, eventId: meal.event.id });
    });
    expect(store.storedBytesByMediaId.size).toBe(1);
    for (const persistence of persisted) {
      const input = { receipt: persistence.receipt, vaultRoot: restoredRoot,
        readPayload: async (ref: { sha256: string }) => persistence.payloads.find(payload => payload.sha256 === ref.sha256)?.bytes ?? null };
      await applyHostedCanonicalWriteReceiptWithMedia(input);
      await applyHostedCanonicalWriteReceiptWithMedia(input);
    }
    // Exact and catalogue-wide reads must preserve canonical tombstones, both
    // immediately after deletion and after receipt-only recovery.
    for (const target of [vaultRoot, restoredRoot]) {
      const before = await readHostedMediaReferenceCatalogue({ vaultRoot: target });
      const entry = before.entries[0]!;
      const tombstone = await readFile(path.join(target, entry.relativePath));
      const directory = path.posix.dirname(entry.relativePath);
      const manifests = (await readdir(path.join(target, directory))).filter(name => name.startsWith("manifest"));
      const identities = await Promise.all(manifests.map(name => readFile(path.join(target, directory, name))));
      const get = vi.fn(store.mediaStore.get);
      const materialize = createHostedArtifactMaterializer({ vaultRoot: target, operatorHomeRoot: target, mediaStore: { ...store.mediaStore, get } });
      for (const paths of [[entry.relativePath], before.entries.map(ref => ref.relativePath)]) {
        const result = await materialize(paths);
        expect(result.missingArtifactPaths.get(`vault:${entry.relativePath}`)).toBe("obsolete");
        expect(await readFile(path.join(target, entry.relativePath))).toEqual(tombstone);
      }
      expect(await Promise.all(manifests.map(name => readFile(path.join(target, directory, name))))).toEqual(identities);
      expect(get).not.toHaveBeenCalled();
      expect(await readHostedMediaReferenceCatalogue({ vaultRoot: target })).toEqual(before);
    }
    // Replay retains pending cleanup pointers without publishing deleted media.
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot: restoredRoot })).entries[0]).toMatchObject({ pendingUpload: true });
    expect(store.storedBytesByMediaId.size).toBe(1);
    await uploadCommittedHostedMealMediaReferences({ vaultRoot: restoredRoot, mediaStore: store.mediaStore });
    expect(store.putCalls).toHaveLength(1);
    const cleaned = await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot: restoredRoot, mediaStore: store.mediaStore });
    expect(cleaned.prunedMediaCount).toBe(0);
    expect(store.storedBytesByMediaId.size).toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.each([false, true])("cold-restored meal reads retain inspectable bytes after expiry=%s", async (expired) => {
  const root = await mkdtemp(path.join(tmpdir(), "murph-meal-cold-read-"));
  const vaultRoot = path.join(root, "live"), restoredRoot = path.join(root, "restored");
  const store = createHostedRuntimeMediaStoreStub();
  const { artifactStore } = createHostedRuntimeArtifactStoreStub();
  const receipts: HostedCanonicalWritePersistenceInput[] = [];
  const captureTime = "2030-01-01T12:00:00.000Z";
  try {
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const photoPath = path.join(root, "fixture.png");
    await writeFile(photoPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64"));
    const meal = await withHostedCanonicalWritePort({
      async persistCanonicalWrite(persistence) { receipts.push(await externalizeHostedCanonicalWriteMediaPayloads({ persistence, mediaStore: store.mediaStore, vaultRoot })); },
    }, async () => {
      const meal = await addMeal({ vaultRoot, photoPath, photoCapturedAt: captureTime, occurredAt: captureTime, source: "device",
        externalRef: { system: "meal-photo-capture", resourceType: "photo", resourceId: "a".repeat(64) } });
      await runMealPhotoMaintenance({ vaultRoot, now: new Date(expired ? "2030-04-02T12:00:00Z" : captureTime) });
      return meal;
    });
    const published = await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore: store.mediaStore });
    expect(published.excludedVaultPaths).toEqual([]);
    const snapshot = await snapshotHostedBundleRoots({ kind: "vault", roots: [{ root: vaultRoot, rootKey: "vault" }] });
    assert.ok(snapshot);
    const hash = sha256HostedBundleHex(snapshot);
    await artifactStore.put({ bytes: snapshot, sha256: hash });
    await restoreHostedWorkspaceRuntimeJobWorkspace({ vaultRoot: restoredRoot,
      platform: { ...createPlatform({ artifactBytesByHash: new Map([[hash, snapshot]]), mailboxPort: null, workspacePort: null }), artifactStore, logPort: null, mediaStore: store.mediaStore },
      workspace: createWorkspaceState({ snapshotRef: createSnapshotFixtureRef({ hash, size: snapshot.byteLength }) }) });
    for (const target of [restoredRoot, path.join(root, "receipt-only")]) {
      if (target !== restoredRoot) {
        await initializeVault({ vaultRoot: target, timezone: "UTC" });
        for (const persistence of receipts) await applyHostedCanonicalWriteReceiptWithMedia({ receipt: persistence.receipt, vaultRoot: target,
          readPayload: async ref => persistence.payloads.find(payload => payload.sha256 === ref.sha256)?.bytes ?? null });
      }
      const shown = await showMealRecord(target, meal.mealId);
      const attachments = shown.entity.data.attachments;
      assert.ok(Array.isArray(attachments));
      const selected = attachments.find(attachment => attachment.role === (expired ? "photo_thumbnail" : "photo"));
      assert.ok(selected && typeof selected.relativePath === "string");
      const bytes = await readFile(path.join(target, selected.relativePath));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(selected.sha256);
      expect([...bytes.subarray(0, expired ? 2 : 4)]).toEqual(expired ? [255, 216] : [137, 80, 78, 71]);
      if (!expired) await expect(removeAutomaticMealPhotoRecord({ vault: target, lookup: meal.mealId })).resolves.toBeDefined();
    }
    expect(store.getCalls).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("real materialization rejects wrong local images and classifies mixed outcomes", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-materialization-outcomes-"));
  const good = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64");
  const names = ["good", "missing", "corrupt", "transport", "large", "expired"];
  try {
    const entries = names.map(name => ({ relativePath: `raw/inbox/synthetic/${name}.png`, mediaId: createHash("sha256").update(name).digest("hex"),
      byteSize: name === "large" ? 100 * 1024 * 1024 + 1 : good.length, sha256: createHash("sha256").update(good).digest("hex"),
      mediaKind: "image" as const, mimeType: "image/png", recordedAt: "2030-01-01T00:00:00Z",
      expiresAt: name === "expired" ? "2000-01-01T00:00:00Z" : null }));
    await writeHostedMediaReferenceCatalogue({ vaultRoot, catalogue: { schema: "murph.hosted-media-refs.v1", entries } });
    await mkdir(path.join(vaultRoot, "raw/inbox/synthetic"), { recursive: true });
    // Valid-looking PNG bytes, with a different exact identity.
    const wrong = Buffer.concat([good, Buffer.from("different")]);
    for (const name of ["missing", "corrupt", "expired"]) await writeFile(path.join(vaultRoot, `raw/inbox/synthetic/${name}.png`), wrong);
    const mediaStore: HostedRuntimeMediaStore = { put: async () => {}, get: async ({ mediaId }) => {
      if (mediaId === createHash("sha256").update("transport").digest("hex")) throw new HostedRuntimeMediaReadError({ cause: new Error("Synthetic transport failure"), retryable: true });
      return mediaId === createHash("sha256").update("missing").digest("hex") ? null : mediaId === createHash("sha256").update("corrupt").digest("hex") ? wrong : good;
    } };
    const materialize = createHostedArtifactMaterializer({ vaultRoot, operatorHomeRoot: vaultRoot, mediaStore });
    const result = await materialize(entries.map(entry => entry.relativePath), { maxFileBytes: 500 });
    expect([...result.materializedArtifactPaths]).toEqual(["vault:raw/inbox/synthetic/good.png"]);
    expect(Object.fromEntries(result.missingArtifactPaths)).toEqual({
      "vault:raw/inbox/synthetic/missing.png": "missing", "vault:raw/inbox/synthetic/corrupt.png": "integrity",
      "vault:raw/inbox/synthetic/transport.png": "transport", "vault:raw/inbox/synthetic/large.png": "size",
      "vault:raw/inbox/synthetic/expired.png": "expired",
    });
    const report = await materializeVaultMedia({ args: { all: true }, vaultRoot, materialize });
    expect(report).toEqual({ requested: 6, available: 1, removed: 1, unavailable: [
      { path: "raw/inbox/synthetic/missing.png", reason: "missing" },
      { path: "raw/inbox/synthetic/corrupt.png", reason: "integrity" },
      { path: "raw/inbox/synthetic/transport.png", reason: "transport" },
      { path: "raw/inbox/synthetic/large.png", reason: "size" },
    ] });
    for (const name of ["missing", "corrupt", "expired"]) {
      expect(await readFile(path.join(vaultRoot, `raw/inbox/synthetic/${name}.png`))).toEqual(wrong);
      await expect(resolveGenerateImageReferences({ vaultRoot, refs: [`raw/inbox/synthetic/${name}.png`], materializeWorkspaceArtifacts: materialize }))
        .rejects.toMatchObject({ code: "ASSISTANT_IMAGE_REFERENCE_UNAVAILABLE" });
    }
    expect(await resolveGenerateImageReferences({ vaultRoot, refs: [entries[0]!.relativePath], materializeWorkspaceArtifacts: materialize })).toHaveLength(1);
    const controller = new AbortController();
    const ownerLost = new Error("Synthetic owner lost");
    const cancelled = createHostedArtifactMaterializer({ vaultRoot, operatorHomeRoot: vaultRoot, mediaStore: {
      ...mediaStore, get: async (_ref, options) => { expect(options?.signal).toBe(controller.signal); controller.abort(ownerLost); return good; },
    } });
    await expect(cancelled([entries[1]!.relativePath], { signal: controller.signal })).rejects.toMatchObject({ cause: ownerLost });
    expect(await readFile(path.join(vaultRoot, entries[1]!.relativePath))).toEqual(wrong);
    const stale = createHostedArtifactMaterializer({ vaultRoot, operatorHomeRoot: vaultRoot, mediaStore: { ...mediaStore, get: async () => { throw ownerLost; } } });
    await expect(stale([entries[1]!.relativePath])).rejects.toMatchObject({ cause: ownerLost });
    await expect(materializeVaultMedia({ args: { all: true }, vaultRoot, materialize: stale })).rejects.toMatchObject({ cause: ownerLost });
    await expect(materializeVaultMedia({ args: { all: true }, vaultRoot, materialize, signal: controller.signal })).rejects.toBeDefined();
  } finally { await rm(vaultRoot, { recursive: true, force: true }); }
});

test.each(["expired", "retired-during-fetch"])("full-photo materialization preserves canonical identity when %s", async (scenario) => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-photo-authority-"));
  try {
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const photoPath = path.join(vaultRoot, "source.png");
    const bytes = Buffer.from("synthetic full photo");
    await writeFile(photoPath, bytes);
    const meal = await addMeal({ vaultRoot, photoPath, occurredAt: "2030-01-01T00:00:00Z" });
    const relativePath = meal.photo!.relativePath;
    const entry = { relativePath, mediaId: "f".repeat(64), mediaKind: "image" as const, mimeType: "image/png",
      byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), recordedAt: "2030-01-01T00:00:00.000Z",
      expiresAt: scenario === "expired" ? "2000-01-01T00:00:00.000Z" : null };
    await writeHostedMediaReferenceCatalogue({ vaultRoot, catalogue: { schema: "murph.hosted-media-refs.v1", entries: [entry] } });
    const get = vi.fn(async () => {
      await deleteEvent({ vaultRoot, eventId: meal.event.id });
      return bytes;
    });
    if (scenario === "expired") await deleteEvent({ vaultRoot, eventId: meal.event.id });
    else await rm(path.join(vaultRoot, relativePath));
    const materialize = createHostedArtifactMaterializer({ vaultRoot, operatorHomeRoot: vaultRoot, mediaStore: { get, put: async () => {} } });
    const result = await materialize([relativePath]);
    expect(result.missingArtifactPaths.get(`vault:${relativePath}`)).toBe("obsolete");
    expect(JSON.parse(await readFile(path.join(vaultRoot, relativePath), "utf8"))).toMatchObject({ reason: "meal_deleted" });
    expect(get).toHaveBeenCalledTimes(scenario === "expired" ? 0 : 1);
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries).toEqual([entry]);
  } finally { await rm(vaultRoot, { recursive: true, force: true }); }
});

test("canonical reads, maintenance and reconciliation agree on shard tie-breaks and retain historical inbox refs", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-media-revision-"));
  const store = createHostedRuntimeMediaStoreStub();
  store.mediaStore.record = async () => {};
  try {
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const photoPath = path.join(vaultRoot, "source.png");
    await writeFile(photoPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64"));
    const meal = await addMeal({ vaultRoot, photoPath, occurredAt: "2030-01-01T00:00:00Z", photoCapturedAt: "2030-01-01T00:00:00Z" });
    await runMealPhotoMaintenance({ vaultRoot, now: new Date("2030-01-01T01:00:00Z") });
    const current = (await readEvent({ vaultRoot, eventId: meal.event.id })).event;
    if (current.kind !== "meal") throw new Error("Expected meal");
    await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore: store.mediaStore });
    await uploadCommittedHostedMealMediaReferences({ vaultRoot, mediaStore: store.mediaStore });
    const thumbnail = (await readHostedMediaReferenceCatalogue({ vaultRoot })).entries[0]!;
    // Same revision and timestamps, later shard: canonical deletion wins.
    await appendJsonlRecord({ vaultRoot, relativePath: "ledger/events/2030/2030-02.jsonl", record: { ...current, lifecycle: { ...current.lifecycle, state: "deleted" }, attachments: [], rawRefs: [], photoThumbnail: undefined } });
    await expect(readEvent({ vaultRoot, eventId: meal.event.id })).rejects.toMatchObject({ code: "EVENT_MISSING" });
    const materializeCandidatePaths = vi.fn();
    expect(await runMealPhotoMaintenance({ vaultRoot, now: new Date("2030-04-02T00:00:00Z"), materializeCandidatePaths })).toMatchObject({ thumbnailCount: 0, retiredPhotoCount: 0 });
    expect(materializeCandidatePaths).not.toHaveBeenCalled();
    expect((await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore: store.mediaStore })).prunedMediaCount).toBe(1);
    expect(store.deleteCalls).toContain(thumbnail.mediaId);
    // A losing note revision still preserves durable inbox evidence.
    const inbox = await normalizeParsedEmailMessage({ message: {
      attachments: [{ fileName: "reference.png", contentType: "image/png", data: await readFile(photoPath), contentDisposition: "attachment", contentId: null, contentTransferEncoding: null }],
      bcc: [], cc: [], from: "sender@example.test", to: ["assistant@example.test"], headers: {}, html: null, inReplyTo: null,
      messageId: "history@example.test", occurredAt: "2030-01-01T00:00:00Z", receivedAt: "2030-01-01T00:00:00Z", rawHash: "b".repeat(64), rawSize: 0,
      references: [], replyTo: [], subject: "Synthetic reference", text: "Synthetic history",
    } });
    await persistCanonicalInboxCapture({ vaultRoot, input: inbox, storedAt: "2030-01-01T00:00:00Z", captureId: "cap_history", eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W3" });
    await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore: store.mediaStore });
    const historical = (await readHostedMediaReferenceCatalogue({ vaultRoot })).entries[0]!;
    const note = await upsertEvent({ vaultRoot, payload: { kind: "note", occurredAt: "2030-01-01T00:00:00Z", source: "manual", title: "Historical evidence", note: "Synthetic", rawRefs: [historical.relativePath] } });
    await appendJsonlRecord({ vaultRoot, relativePath: "ledger/events/2030/2030-02.jsonl", record: { ...note.event, rawRefs: [], lifecycle: { revision: 2, state: "deleted" } } });
    await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore: store.mediaStore });
    expect(store.deleteCalls).not.toContain(historical.mediaId);
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries).toEqual([expect.objectContaining({ relativePath: historical.relativePath, expiresAt: null })]);
  } finally { await rm(vaultRoot, { recursive: true, force: true }); }
});


test("image sends hydrate absent bytes for preparation and delivery, and refuse changed bytes", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-image-hydration-"));
  const ref = "raw/inbox/synthetic/photo.png";
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  try {
    await writeHostedMediaReferenceCatalogue({ vaultRoot, catalogue: { schema: "murph.hosted-media-refs.v1", entries: [{
      relativePath: ref, mediaId: "c".repeat(64), mediaKind: "image", mimeType: "image/png", byteSize: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), recordedAt: "2030-01-01T00:00:00.000Z", expiresAt: null,
    }] } });
    const get = vi.fn(async (): Promise<Uint8Array | null> => bytes);
    const materializeWorkspaceArtifacts = createHostedArtifactMaterializer({ vaultRoot, operatorHomeRoot: vaultRoot,
      mediaStore: { put: async () => {}, get } });
    const image = await resolveAssistantVaultImageResponseMedia({ ref, vaultRoot, materializeWorkspaceArtifacts });
    expect(image.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(get).toHaveBeenCalledTimes(1);
    // A cold restore between approval and delivery leaves only the descriptor.
    await rm(path.join(vaultRoot, ref));
    expect(Buffer.from(await readVerifiedAssistantVaultImageBytes({ image, vaultRoot, materializeWorkspaceArtifacts }))).toEqual(bytes);
    expect(get).toHaveBeenCalledTimes(2);
    await rm(path.join(vaultRoot, ref));
    get.mockResolvedValueOnce(null);
    await expect(readVerifiedAssistantVaultImageBytes({ image, vaultRoot, materializeWorkspaceArtifacts }))
      .rejects.toMatchObject({ code: "ASSISTANT_VAULT_FILE_UNAVAILABLE" });
  } finally { await rm(vaultRoot, { recursive: true, force: true }); }
});

test("secure-file hydration preserves exact vault paths with workspace-root names", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "murph-exact-vault-path-"));
  const vaultRoot = path.join(root, "vault"), operatorHomeRoot = path.join(root, "home");
  try {
    await mkdir(operatorHomeRoot, { recursive: true });
    await writeFile(path.join(operatorHomeRoot, "report.pdf"), "operator data");
    for (const ref of ["vault/report.pdf", "operator-home/report.pdf", "vault:report.pdf"]) {
      await mkdir(path.dirname(path.join(vaultRoot, ref)), { recursive: true });
      await writeFile(path.join(vaultRoot, ref), "vault data");
      const file = await resolveAssistantVaultFileResponseMedia({ ref, vaultRoot,
        materializeWorkspaceArtifacts: createHostedArtifactMaterializer({ vaultRoot, operatorHomeRoot }),
      });
      expect(file.sha256).toBe(createHash("sha256").update("vault data").digest("hex"));
      expect(file.ref).toBe(ref);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
