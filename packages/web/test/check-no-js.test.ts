import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { test } from "vitest";

import {
  allowedDeclarationArtifacts,
  isAllowedDeclarationArtifactContents,
} from "../../../scripts/check-no-js";

test("check-no-js allowlists the current Next.js declaration stub exactly", async () => {
  const nextEnvContents = await readFile("packages/web/next-env.d.ts", "utf8");
  const allowedVariants = allowedDeclarationArtifacts.get("packages/web/next-env.d.ts");

  assert.equal(Array.isArray(allowedVariants), true);
  assert.equal(allowedVariants?.includes(nextEnvContents), true);
  assert.equal(
    isAllowedDeclarationArtifactContents("packages/web/next-env.d.ts", nextEnvContents),
    true,
  );
});

test("check-no-js rejects modified declaration stubs", () => {
  assert.equal(
    isAllowedDeclarationArtifactContents(
      "packages/web/next-env.d.ts",
      '/// <reference types="next" />\n',
    ),
    false,
  );
});
