import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { verifyWorkspaceImportPolicy } = require("./import-policy-rules.mjs");
const { repoRoot } = require("./scanner.mjs");

describe("workspace import policy rules", () => {
  it("rejects empty imports from workspace packages", () => {
    const filePath = path.join(repoRoot, "packages/hosted-execution/src/parsers.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: `
import {
} from "@murphai/device-syncd/hosted-runtime";
      `,
      sourceMember: "packages/hosted-execution",
      specifier: "@murphai/device-syncd/hosted-runtime",
    });

    expect(failure).toContain("uses empty import");
    expect(failure).toContain('"@murphai/device-syncd/hosted-runtime"');
  });

  it("rejects comment-interleaved empty imports from workspace packages", () => {
    const filePath = path.join(repoRoot, "packages/hosted-execution/src/parsers.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: `
import /* keep */ {
  /* keep */
} /* keep */ from "@murphai/device-syncd/hosted-runtime";
      `,
      sourceMember: "packages/hosted-execution",
      specifier: "@murphai/device-syncd/hosted-runtime",
    });

    expect(failure).toContain("uses empty import");
    expect(failure).toContain('"@murphai/device-syncd/hosted-runtime"');
  });

  it("allows empty imports from non-workspace packages", () => {
    const filePath = path.join(repoRoot, "packages/hosted-execution/src/parsers.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: 'import {} from "dotenv/config";',
      sourceMember: "packages/hosted-execution",
      specifier: "dotenv/config",
    });

    expect(failure).toBeNull();
  });

  it("allows normal workspace imports with explicit bindings", () => {
    const filePath = path.join(repoRoot, "packages/hosted-execution/src/parsers.ts");
    const failure = verifyWorkspaceImportPolicy({
      filePath,
      source: 'import { parseHostedExecutionBundleRef } from "@murphai/runtime-state";',
      sourceMember: "packages/hosted-execution",
      specifier: "@murphai/runtime-state",
    });

    expect(failure).toBeNull();
  });
});
