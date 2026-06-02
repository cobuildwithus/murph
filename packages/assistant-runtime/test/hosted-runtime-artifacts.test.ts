import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";
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
  createHostedRuntimeArtifactStoreStub,
  createHostedWorkspaceArtifactPersistInput,
} from "./hosted-runtime-test-helpers.ts";

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
    const { artifactStore } = createHostedRuntimeArtifactStoreStub(
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
