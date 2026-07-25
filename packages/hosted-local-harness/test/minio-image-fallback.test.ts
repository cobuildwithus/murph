import assert from "node:assert/strict";

import { test } from "vitest";

import {
  HOSTED_LOCAL_MINIO_MIRROR_IMAGE,
  HOSTED_LOCAL_MINIO_UPSTREAM_IMAGE,
} from "../src/dev-hosted-local/minio-image-contract.ts";
import {
  resolveHostedLocalMinioImage,
  resolveHostedLocalMinioRunnableImage,
} from "../src/dev-hosted-local/minio.ts";

function recordingPull(failFor: readonly string[]) {
  const attempted: string[] = [];

  return {
    attempted,
    pull: async (image: string) => {
      attempted.push(image);
      return !failFor.includes(image);
    },
  };
}

test("MinIO runs from the GHCR mirror when it pulls", async () => {
  const puller = recordingPull([]);

  assert.equal(
    await resolveHostedLocalMinioRunnableImage({}, puller.pull),
    HOSTED_LOCAL_MINIO_MIRROR_IMAGE,
  );
  assert.deepEqual(puller.attempted, [HOSTED_LOCAL_MINIO_MIRROR_IMAGE]);
});

test("MinIO falls back to upstream when the mirror cannot be pulled", async () => {
  const puller = recordingPull([HOSTED_LOCAL_MINIO_MIRROR_IMAGE]);

  // A transient registry outage is unrelated to the change under test, so one
  // unreachable registry must not fail the run.
  assert.equal(
    await resolveHostedLocalMinioRunnableImage({}, puller.pull),
    HOSTED_LOCAL_MINIO_UPSTREAM_IMAGE,
  );
});

test("an explicit image override is honored and never silently replaced", async () => {
  const pinned = "minio/minio:RELEASE.2024-01-01T00-00-00Z";
  assert.equal(resolveHostedLocalMinioImage({ MURPH_DEV_MINIO_IMAGE: pinned }), pinned);

  const puller = recordingPull([pinned]);
  // Running a different build than the one someone pinned would be worse than
  // failing, so the fallback must not apply to an override.
  assert.equal(
    await resolveHostedLocalMinioRunnableImage({ MURPH_DEV_MINIO_IMAGE: pinned }, puller.pull),
    pinned,
  );
  assert.deepEqual(puller.attempted, [], "an override must not be pull-probed for fallback");
});
