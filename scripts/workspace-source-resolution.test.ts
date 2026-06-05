import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  createVitestWorkspaceRuntimeAliases,
  resolveHostedWebWorkspaceSourceEntries,
} from "../config/workspace-source-resolution.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("workspace source resolution", () => {
  it("keeps configured package source anchors on files that exist", () => {
    const entries = resolveHostedWebWorkspaceSourceEntries(path.join(repoRoot, "apps/web"));

    for (const [specifier, replacement] of Object.entries(entries)) {
      expect(fs.existsSync(replacement), `${specifier} -> ${replacement}`).toBe(true);
    }
  });

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
    expect(resolveAliasReplacement(aliases, "@murphai/hosted-execution/browser-vault")).toBe(
      path.join(repoRoot, "packages/hosted-execution/src/browser-vault.ts"),
    );
    expect(resolveAliasReplacement(aliases, "@murphai/runtime-state/node/assistant-state-fs")).toBe(
      path.join(repoRoot, "packages/runtime-state/src/node/assistant-state-fs.ts"),
    );
    expect(resolveAliasReplacement(aliases, "@murphai/health-commons/generated/protocol-index.json")).toBe(
      path.join(repoRoot, "packages/health-commons/generated/protocol-index.json"),
    );
  });

  it("does not alias the root specifier for subpath-only workspace packages", () => {
    const aliases = createVitestWorkspaceRuntimeAliases(
      resolveHostedWebWorkspaceSourceEntries(path.join(repoRoot, "apps/web")),
    );

    expect(resolveAliasReplacement(aliases, "@murphai/cloudflare-hosted-control")).toBeNull();
    expect(resolveAliasReplacement(aliases, "@murphai/messaging-ingress")).toBeNull();
    expect(resolveAliasReplacement(aliases, "@murphai/cloudflare-hosted-control/client")).toBe(
      path.join(repoRoot, "packages/cloudflare-hosted-control/src/client.ts"),
    );
    expect(resolveAliasReplacement(aliases, "@murphai/cloudflare-hosted-control/routes")).toBe(
      path.join(repoRoot, "packages/cloudflare-hosted-control/src/routes.ts"),
    );
    expect(resolveAliasReplacement(aliases, "@murphai/messaging-ingress/linq-webhook")).toBe(
      path.join(repoRoot, "packages/messaging-ingress/src/linq-webhook.ts"),
    );
    expect(resolveAliasReplacement(aliases, "@murphai/messaging-ingress/telegram-webhook")).toBe(
      path.join(repoRoot, "packages/messaging-ingress/src/telegram-webhook.ts"),
    );
    expect(
      resolveAliasReplacement(aliases, "@murphai/messaging-ingress/telegram-webhook-payload"),
    ).toBe(path.join(repoRoot, "packages/messaging-ingress/src/telegram-webhook-payload.ts"));
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

  it("keeps hosted web tsconfig off broad sibling package source wildcards", () => {
    const tsconfig = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "apps/web/tsconfig.json"), "utf8"),
    ) as {
      compilerOptions?: {
        paths?: Record<string, readonly string[]>;
      };
    };

    const broadSourceAliases = Object.entries(tsconfig.compilerOptions?.paths ?? {})
      .flatMap(([specifier, targets]) =>
        targets
          .filter((target) =>
            specifier.startsWith("@murphai/")
            && specifier.includes("*")
            && /^packages\/[^/]+\/src\/.*\*/u.test(target),
          )
          .map((target) => `${specifier} -> ${target}`),
      );

    expect(broadSourceAliases).toEqual([]);
  });

  it("keeps shared public package aliases on explicit exported subpaths", () => {
    const tsconfig = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "tsconfig.base.json"), "utf8"),
    ) as {
      compilerOptions?: {
        paths?: Record<string, readonly string[]>;
      };
    };

    expect(tsconfig.compilerOptions?.paths?.["@murphai/contracts/*"]).toBeUndefined();
    expect(tsconfig.compilerOptions?.paths?.["@murphai/runtime-state/*"]).toBeUndefined();
    expect(tsconfig.compilerOptions?.paths?.["@murphai/contracts/schemas"]).toEqual([
      "packages/contracts/src/schemas.ts",
    ]);
    expect(tsconfig.compilerOptions?.paths?.["@murphai/runtime-state/node/hosted-bundle-codec"])
      .toEqual(["packages/runtime-state/src/node/hosted-bundle-codec.ts"]);
  });
});

function resolveAliasReplacement(
  aliases: ReadonlyArray<{ find: RegExp, replacement: string }>,
  specifier: string,
): string | null {
  const alias = aliases.find((candidate) => candidate.find.test(specifier));
  return alias ? specifier.replace(alias.find, alias.replacement) : null;
}
