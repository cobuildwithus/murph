import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { test } from "vitest";

import {
  HOSTED_LOCAL_MINIO_MIRROR_IMAGE,
  HOSTED_LOCAL_MINIO_UPSTREAM_IMAGE,
} from "../src/dev-hosted-local/minio-image-contract.ts";

test("the MinIO mirror workflow cannot drift from the image contract", () => {
  const workflow = readFileSync(
    new URL("../../../.github/workflows/hosted-local-minio-image.yml", import.meta.url),
    "utf8",
  );

  // The workflow greps these exact patterns out of the contract module, so a
  // rename or retag there must not silently publish the wrong image.
  assert.match(workflow, /grep -oE '"minio\/minio:\[\^"\]\+"'/u);
  assert.match(workflow, /grep -oE '"ghcr\\\.io\/\[\^"\]\+"'/u);

  assert.match(HOSTED_LOCAL_MINIO_UPSTREAM_IMAGE, /^minio\/minio:RELEASE\.[\w-]+$/u);
  assert.match(
    HOSTED_LOCAL_MINIO_MIRROR_IMAGE,
    /^ghcr\.io\/cobuildwithus\/murph-hosted-local-minio:RELEASE\.[\w-]+$/u,
  );

  // The mirror must be built from the same release it claims to mirror.
  const upstreamTag = HOSTED_LOCAL_MINIO_UPSTREAM_IMAGE.split(":")[1];
  const mirrorTag = HOSTED_LOCAL_MINIO_MIRROR_IMAGE.split(":")[1];
  assert.equal(mirrorTag, upstreamTag);
});
