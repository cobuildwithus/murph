import assert from "node:assert/strict";

import { test } from "vitest";

import {
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
    /artifact fetch failed for sha_missing/u,
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
