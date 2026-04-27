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
    expect(resolveAliasReplacement(aliases, "@murphai/runtime-state/node/assistant-usage")).toBe(
      path.join(repoRoot, "packages/runtime-state/src/node/assistant-usage.ts"),
    );
    expect(resolveAliasReplacement(aliases, "@murphai/health-commons/generated/catalog.json")).toBe(
      path.join(repoRoot, "packages/health-commons/generated/catalog.json"),
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
});

function resolveAliasReplacement(
  aliases: ReadonlyArray<{ find: RegExp, replacement: string }>,
  specifier: string,
): string | null {
  const alias = aliases.find((candidate) => candidate.find.test(specifier));
  return alias ? specifier.replace(alias.find, alias.replacement) : null;
}
