import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  createVitestWorkspaceRuntimeAliases,
  resolveHostedWebWorkspaceSourceEntries,
} from "../config/workspace-source-resolution.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("workspace source resolution", () => {
  it("maps public workspace package subpaths to explicit source entry files", () => {
    const aliases = createVitestWorkspaceRuntimeAliases(
      resolveHostedWebWorkspaceSourceEntries(path.join(repoRoot, "apps/web")),
    );

    expect(resolveAliasReplacement(aliases, "@murphai/hosted-execution")).toBe(
      path.join(repoRoot, "packages/hosted-execution/src/index.ts"),
    );
    expect(resolveAliasReplacement(aliases, "@murphai/hosted-execution/hosted-email")).toBe(
      path.join(repoRoot, "packages/hosted-execution/src/hosted-email.ts"),
    );
    expect(resolveAliasReplacement(aliases, "@murphai/runtime-state/node/assistant-usage")).toBe(
      path.join(repoRoot, "packages/runtime-state/src/node/assistant-usage.ts"),
    );
  });

  it("does not alias private workspace internals through wildcard subpath fallbacks", () => {
    const aliases = createVitestWorkspaceRuntimeAliases(
      resolveHostedWebWorkspaceSourceEntries(path.join(repoRoot, "apps/web")),
    );

    expect(resolveAliasReplacement(aliases, "@murphai/hosted-execution/parsers/assertions")).toBeNull();
    expect(
      aliases.some((alias) => alias.find.test("@murphai/hosted-execution/private-internal")),
    ).toBe(false);
  });
});

function resolveAliasReplacement(
  aliases: ReadonlyArray<{ find: RegExp, replacement: string }>,
  specifier: string,
): string | null {
  const alias = aliases.find((candidate) => candidate.find.test(specifier));
  return alias?.replacement ?? null;
}
