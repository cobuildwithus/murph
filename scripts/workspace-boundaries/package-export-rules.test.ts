import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { getWorkspacePackageExportFailure } = require("./package-export-rules.mjs");
const { repoRoot } = require("./scanner.mjs");

describe("workspace package export rules", () => {
  it("rejects assistant-engine implementation-shaped assistant/* exports", () => {
    const packageJsonPath = path.join(repoRoot, "packages/assistant-engine/package.json");
    const failure = getWorkspacePackageExportFailure({
      exportKey: "./assistant/diagnostics",
      packageJson: {
        name: "@murphai/assistant-engine",
      },
      packageJsonPath,
    });

    expect(failure).toContain('"./assistant/diagnostics"');
    expect(failure).toContain("assistant-engine assistant/* file-shaped exports");
    expect(failure).toContain("explicitly allowlisted");
  });

  it("allows semantic assistant-engine top-level entrypoints", () => {
    const packageJsonPath = path.join(repoRoot, "packages/assistant-engine/package.json");
    const failure = getWorkspacePackageExportFailure({
      exportKey: "./assistant-runtime",
      packageJson: {
        name: "@murphai/assistant-engine",
      },
      packageJsonPath,
    });

    expect(failure).toBeNull();
  });
});
