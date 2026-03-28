import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { test } from "vitest";

import {
  allowedDeclarationArtifacts,
  buildNextEnvDeclarationArtifact,
  getBlockedWorkingTreeArtifactPath,
  isAllowedDeclarationArtifactContents,
  isBlockedTrackedArtifactPath,
  isBlockedTrackedEnvArtifactPath,
} from "../../../scripts/check-no-js";
import { getGeneratedSourceSidecarSourcePath } from "../../../scripts/prune-generated-source-sidecars";

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

test("check-no-js allowlists the hosted dev Next.js declaration stub variant", () => {
  const hostedDevNextEnv = buildNextEnvDeclarationArtifact("./.next-dev/types/routes.d.ts");

  assert.equal(
    isAllowedDeclarationArtifactContents("apps/web/next-env.d.ts", hostedDevNextEnv),
    true,
  );
});

test("check-no-js also allowlists the hosted nested dev Next.js declaration stub variant", () => {
  const hostedNestedDevNextEnv = buildNextEnvDeclarationArtifact("./.next-dev/dev/types/routes.d.ts");

  assert.equal(
    isAllowedDeclarationArtifactContents("apps/web/next-env.d.ts", hostedNestedDevNextEnv),
    true,
  );
});

test("check-no-js also allowlists the hosted smoke Next.js declaration stub variants", () => {
  const hostedSmokeNextEnv = buildNextEnvDeclarationArtifact("./.next-smoke/types/routes.d.ts");
  const hostedNestedSmokeNextEnv = buildNextEnvDeclarationArtifact(
    "./.next-smoke/dev/types/routes.d.ts",
  );

  assert.equal(
    isAllowedDeclarationArtifactContents("apps/web/next-env.d.ts", hostedSmokeNextEnv),
    true,
  );
  assert.equal(
    isAllowedDeclarationArtifactContents("apps/web/next-env.d.ts", hostedNestedSmokeNextEnv),
    true,
  );
});

test("check-no-js rejects tracked local env files while allowlisting tracked examples", () => {
  assert.equal(isBlockedTrackedEnvArtifactPath(".env"), true);
  assert.equal(isBlockedTrackedEnvArtifactPath("apps/web/.env"), true);
  assert.equal(isBlockedTrackedEnvArtifactPath("packages/web/.env.local"), true);
  assert.equal(isBlockedTrackedEnvArtifactPath("apps/web/.env.example"), false);
  assert.equal(isBlockedTrackedEnvArtifactPath("packages/web/.env.local.example"), false);
  assert.equal(isBlockedTrackedEnvArtifactPath(".envrc"), false);
});

test("check-no-js flags tracked generated/private artifact paths", () => {
  assert.equal(isBlockedTrackedArtifactPath(".env"), true);
  assert.equal(isBlockedTrackedArtifactPath("apps/web/.env.example"), false);
  assert.equal(isBlockedTrackedArtifactPath("apps/web/.next"), true);
  assert.equal(isBlockedTrackedArtifactPath("apps/web/.next-dev/cache"), true);
  assert.equal(isBlockedTrackedArtifactPath("apps/web/.next-smoke/cache"), true);
  assert.equal(isBlockedTrackedArtifactPath("packages/web/.next/server/app.js"), true);
  assert.equal(isBlockedTrackedArtifactPath(".next/cache/tsconfig.tsbuildinfo"), true);
  assert.equal(isBlockedTrackedArtifactPath("packages/core/dist/index.js"), true);
  assert.equal(isBlockedTrackedArtifactPath("packages/core/.test-dist/index.js"), true);
  assert.equal(isBlockedTrackedArtifactPath("packages/web/next-env.d.ts"), false);
});

test("check-no-js flags bundle-only working-tree private/build artifacts", () => {
  assert.equal(getBlockedWorkingTreeArtifactPath("apps/web/.env", "file"), "apps/web/.env");
  assert.equal(
    getBlockedWorkingTreeArtifactPath("packages/web/app.tsbuildinfo", "file"),
    "packages/web/app.tsbuildinfo",
  );
  assert.equal(getBlockedWorkingTreeArtifactPath("apps/web/.env.example", "file"), null);
  assert.equal(getBlockedWorkingTreeArtifactPath("apps/web/.next", "directory"), "apps/web/.next/");
  assert.equal(
    getBlockedWorkingTreeArtifactPath("apps/web/.next-dev", "directory"),
    "apps/web/.next-dev/",
  );
  assert.equal(
    getBlockedWorkingTreeArtifactPath("apps/web/.next-smoke", "directory"),
    "apps/web/.next-smoke/",
  );
  assert.equal(
    getBlockedWorkingTreeArtifactPath("packages/core/.test-dist", "directory"),
    "packages/core/.test-dist/",
  );
  assert.equal(getBlockedWorkingTreeArtifactPath("apps/web/src", "directory"), null);
});

test("prune-generated-source-sidecars matches generated sidecars to tracked TypeScript sources", () => {
  const trackedSourceFiles = new Set([
    "packages/contracts/src/index.ts",
    "apps/web/src/lib/http.ts",
    "packages/web/src/example.tsx",
  ]);

  assert.equal(
    getGeneratedSourceSidecarSourcePath("packages/contracts/src/index.js", trackedSourceFiles),
    "packages/contracts/src/index.ts",
  );
  assert.equal(
    getGeneratedSourceSidecarSourcePath("packages/contracts/src/index.d.ts.map", trackedSourceFiles),
    "packages/contracts/src/index.ts",
  );
  assert.equal(
    getGeneratedSourceSidecarSourcePath("apps/web/src/lib/http.d.ts", trackedSourceFiles),
    "apps/web/src/lib/http.ts",
  );
  assert.equal(
    getGeneratedSourceSidecarSourcePath("packages/web/src/example.js.map", trackedSourceFiles),
    "packages/web/src/example.tsx",
  );
  assert.equal(
    getGeneratedSourceSidecarSourcePath("packages/contracts/src/missing.js", trackedSourceFiles),
    null,
  );
  assert.equal(
    getGeneratedSourceSidecarSourcePath("packages/contracts/dist/index.js", trackedSourceFiles),
    null,
  );
});

test("TypeScript configs keep the shared base non-emitting while build projects opt back into emit", async () => {
  const baseTsconfig = JSON.parse(await readFile("tsconfig.base.json", "utf8")) as {
    compilerOptions?: { noEmit?: boolean };
  };
  const emitConfigs = [
    "packages/contracts/tsconfig.build.json",
    "packages/contracts/tsconfig.scripts.json",
    "packages/runtime-state/tsconfig.json",
    "packages/importers/tsconfig.json",
    "packages/device-syncd/tsconfig.json",
    "packages/query/tsconfig.json",
    "packages/query/tsconfig.test.json",
    "packages/inboxd/tsconfig.json",
    "packages/parsers/tsconfig.json",
    "packages/cli/tsconfig.json",
  ];

  assert.equal(baseTsconfig.compilerOptions?.noEmit, true);

  for (const configPath of emitConfigs) {
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      compilerOptions?: { noEmit?: boolean };
    };

    assert.equal(config.compilerOptions?.noEmit, false, `${configPath} must opt back into emit.`);
  }
});
