import assert from "node:assert/strict";

import { test } from "vitest";

import { toHostedArtifactPathKey } from "../src/hosted-runtime/artifact-paths.ts";

test("hosted artifact path keys preserve colon-bearing filenames while still accepting root-qualified inputs", () => {
  assert.equal(
    toHostedArtifactPathKey({
      path: "raw/captures/report:v1.pdf",
    }),
    "vault:raw/captures/report:v1.pdf",
  );
  assert.equal(
    toHostedArtifactPathKey({
      path: "vault/raw/captures/report:v1.pdf",
    }),
    "vault:raw/captures/report:v1.pdf",
  );
  assert.equal(
    toHostedArtifactPathKey({
      path: "vault:raw/captures/report:v1.pdf",
    }),
    "vault:raw/captures/report:v1.pdf",
  );
});
