import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { test } from "vitest";

import * as rootExports from "../src/index.ts";
import {
  JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG,
  JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG,
} from "../src/fitbit-migration.ts";
import { createSecretCodec } from "../src/local-secret-codec.ts";

test("@murphai/device-syncd package manifest exposes narrow public subpaths", async () => {
  const packageManifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    exports?: Record<string, { default?: string; types?: string } | undefined>;
  };

  assert.deepEqual(Object.keys(packageManifest.exports ?? {}).sort(), [
    ".",
    "./callback-redirect",
    "./client",
    "./config",
    "./connect-config",
    "./errors",
    "./fitbit-migration",
    "./hosted-hints",
    "./hosted-runtime",
    "./http",
    "./junction-historical-backfill-progress",
    "./junction-inline-authority",
    "./junction-push-source-recovery",
    "./junction-resources",
    "./junction-source-reconnect",
    "./local-secret-codec",
    "./prepared-webhook",
    "./provider-configs",
    "./provider-credential-policy",
    "./provider-label",
    "./provider-match",
    "./providers/junction-client",
    "./providers/junction-config",
    "./providers/oura",
    "./providers/strava",
    "./providers/whoop",
    "./public-account",
    "./public-ingress",
    "./public-provider-descriptors",
    "./registry",
    "./runtime-config",
    "./service",
    "./source-staleness",
    "./types",
  ]);
  assert.equal(packageManifest.exports?.["./crypto"], undefined);
  assert.deepEqual(packageManifest.exports?.["./connect-config"], {
    default: "./dist/connect-config.js",
    types: "./dist/connect-config.d.ts",
  });
  assert.deepEqual(packageManifest.exports?.["./errors"], {
    default: "./dist/errors.js",
    types: "./dist/errors.d.ts",
  });
  assert.deepEqual(packageManifest.exports?.["./fitbit-migration"], {
    default: "./dist/fitbit-migration.js",
    types: "./dist/fitbit-migration.d.ts",
  });
  assert.deepEqual(packageManifest.exports?.["./local-secret-codec"], {
    default: "./dist/local-secret-codec.js",
    types: "./dist/local-secret-codec.d.ts",
  });
  assert.deepEqual(packageManifest.exports?.["./prepared-webhook"], {
    default: "./dist/prepared-webhook.js",
    types: "./dist/prepared-webhook.d.ts",
  });
  assert.deepEqual(packageManifest.exports?.["./junction-inline-authority"], {
    default: "./dist/junction-inline-authority.js",
    types: "./dist/junction-inline-authority.d.ts",
  });
  assert.deepEqual(packageManifest.exports?.["./junction-historical-backfill-progress"], {
    default: "./dist/junction-historical-backfill-progress.js",
    types: "./dist/junction-historical-backfill-progress.d.ts",
  });
  assert.deepEqual(packageManifest.exports?.["./junction-resources"], {
    default: "./dist/junction-resources.js",
    types: "./dist/junction-resources.d.ts",
  });
  assert.deepEqual(packageManifest.exports?.["./junction-source-reconnect"], {
    default: "./dist/junction-source-reconnect.js",
    types: "./dist/junction-source-reconnect.d.ts",
  });
  assert.deepEqual(packageManifest.exports?.["./provider-credential-policy"], {
    default: "./dist/provider-credential-policy.js",
    types: "./dist/provider-credential-policy.d.ts",
  });
  assert.deepEqual(packageManifest.exports?.["./provider-configs"], {
    default: "./dist/provider-configs.js",
    types: "./dist/provider-configs.d.ts",
  });
  assert.deepEqual(packageManifest.exports?.["./provider-match"], {
    default: "./dist/provider-match.js",
    types: "./dist/provider-match.d.ts",
  });
  assert.deepEqual(packageManifest.exports?.["./public-provider-descriptors"], {
    default: "./dist/public-provider-descriptors.js",
    types: "./dist/public-provider-descriptors.d.ts",
  });
  assert.deepEqual(packageManifest.exports?.["./public-account"], {
    default: "./dist/public-account.js",
    types: "./dist/public-account.d.ts",
  });
  assert.deepEqual(packageManifest.exports?.["./providers/junction-client"], {
    default: "./dist/providers/junction-client.js",
    types: "./dist/providers/junction-client.d.ts",
  });
  assert.deepEqual(packageManifest.exports?.["./providers/junction-config"], {
    default: "./dist/providers/junction-config.js",
    types: "./dist/providers/junction-config.d.ts",
  });
});

test("@murphai/device-syncd root barrel exposes the local secret codec API", () => {
  assert.equal(rootExports.createSecretCodec, createSecretCodec);
  assert.equal("buildDeviceSyncSecretAad" in rootExports, false);
  assert.equal("buildDeviceSyncTokenCipherOptions" in rootExports, false);
});

test("Fitbit migration public entrypoint and browser consumers stay browser-safe", async () => {
  const source = await readFile(
    new URL("../src/fitbit-migration.ts", import.meta.url),
    "utf8",
  );
  const browserSources = await Promise.all(
    [
      "apps/web/app/(dashboard)/connect/connect-page-helpers.ts",
      "apps/web/src/lib/device-sync/settings-surface.ts",
    ].map((path) => readFile(resolve(repoRoot, path), "utf8")),
  );

  assert.equal(JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG, "fitbit");
  assert.equal(JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG, "google_health");
  assert.doesNotMatch(source, /["']\.\/connect-config\.ts["']/u);
  for (const browserSource of browserSources) {
    assert.equal(
      readModuleSpecifiers(browserSource).includes(
        "@murphai/device-syncd/connect-config",
      ),
      false,
    );
  }
});

test("Junction provider imports SDK resource subpaths without the aggregate root", async () => {
  const source = await readFile(
    new URL("../src/providers/junction-client.ts", import.meta.url),
    "utf8",
  );
  const sdkSpecifiers = [
    ...source.matchAll(
      /\b(?:from\s+|import\s*(?:\(\s*)?)["'](@junction-api\/sdk(?:\/[^"']+)?)['"]/gu,
    ),
  ].map((match) => match[1]);

  assert.ok(
    sdkSpecifiers.some((specifier) => specifier?.startsWith("@junction-api/sdk/")),
  );
  assert.equal(sdkSpecifiers.includes("@junction-api/sdk"), false);
});

test("hosted web-safe device-sync graph stays out of provider runtime modules", async () => {
  const failures = await Promise.all(
    WEB_SAFE_DEVICE_SYNC_GRAPH_ROOTS.map(async (root) => {
      const path = await findDeniedDeviceSyncGraphPath(root);
      return path ? { root, path } : null;
    }),
  );
  const failingPaths = failures.filter((failure): failure is NonNullable<typeof failure> =>
    failure !== null
  );

  assert.deepEqual(
    failingPaths,
    [],
    failingPaths.map(({ root, path }) => `${root}\n${path.join("\n  -> ")}`).join("\n\n"),
  );
});

test("hosted runner runtime-config static graph stays out of per-turn provider modules", async () => {
  const root = "packages/device-syncd/src/runtime-config.ts";
  const path = await findDeniedHostedRunnerRuntimeConfigGraphPath(root);

  assert.equal(
    path,
    null,
    path ? `${root}\n${path.join("\n  -> ")}` : undefined,
  );
});

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const deviceSyncdSrcRoot = resolve(repoRoot, "packages/device-syncd/src");
const webRoot = resolve(repoRoot, "apps/web");

const WEB_SAFE_DEVICE_SYNC_GRAPH_ROOTS = [
  "apps/web/app/api/device-sync/route.ts",
  "apps/web/app/api/device-sync/agent/connections/[connectionId]/export-token-bundle/route.ts",
  "apps/web/app/api/device-sync/agent/connections/[connectionId]/local-heartbeat/route.ts",
  "apps/web/app/api/device-sync/agent/session/revoke/route.ts",
  "apps/web/app/api/device-sync/agents/pair/route.ts",
  "apps/web/app/api/device-sync/companion/admission/route.ts",
  "apps/web/app/api/device-sync/companion/status/route.ts",
  "apps/web/app/api/device-sync/messaging-return/route.ts",
  "apps/web/app/api/internal/device-sync/recovery-sweep/route.ts",
  "apps/web/app/api/internal/device-sync/runtime/apply/route.ts",
  "apps/web/app/api/internal/device-sync/runtime/dirty-ack/route.ts",
  "apps/web/app/api/internal/device-sync/runtime/dirty-pending/route.ts",
  "apps/web/app/api/internal/device-sync/runtime/snapshot/route.ts",
  "apps/web/app/api/settings/device-sync/connections/[connectionId]/status/route.ts",
  "apps/web/app/api/settings/device-sync/route.ts",
  "apps/web/app/api/settings/device-sync/sidebar-status/route.ts",
  "apps/web/src/lib/device-sync/control-plane.ts",
  "apps/web/src/lib/device-sync/sidebar-status-service.ts",
  "packages/device-syncd/src/connect-config.ts",
  "packages/device-syncd/src/config/provider-manifests.ts",
  "packages/device-syncd/src/errors.ts",
  "packages/device-syncd/src/hosted-hints.ts",
  "packages/device-syncd/src/junction-resources.ts",
  "packages/device-syncd/src/provider-configs.ts",
  "packages/device-syncd/src/provider-credential-policy.ts",
  "packages/device-syncd/src/provider-label.ts",
  "packages/device-syncd/src/provider-match.ts",
  "packages/device-syncd/src/public-account.ts",
  "packages/device-syncd/src/public-provider-descriptors.ts",
] as const;

const DENIED_WEB_SAFE_DEVICE_SYNC_MODULES = new Set([
  "packages/device-syncd/src/config.ts",
  "packages/device-syncd/src/config/provider-factory.ts",
  "packages/device-syncd/src/public-ingress.ts",
  "packages/device-syncd/src/registry.ts",
  "packages/device-syncd/src/service.ts",
  "packages/device-syncd/src/webhook-verification.ts",
]);

async function findDeniedDeviceSyncGraphPath(root: string): Promise<string[] | null> {
  const rootPath = resolve(repoRoot, root);
  const visited = new Set<string>();
  const stack: Array<{ file: string; path: string[] }> = [{
    file: rootPath,
    path: [toRepoPath(rootPath)],
  }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current.file)) {
      continue;
    }
    visited.add(current.file);

    if (isDeniedWebSafeDeviceSyncModule(current.file)) {
      return current.path;
    }

    const source = await readFile(current.file, "utf8");
    for (const specifier of readModuleSpecifiers(source)) {
      const resolvedModule = resolveLocalModule(current.file, specifier);
      if (!resolvedModule || visited.has(resolvedModule)) {
        continue;
      }
      stack.push({
        file: resolvedModule,
        path: [...current.path, toRepoPath(resolvedModule)],
      });
    }
  }

  return null;
}

async function findDeniedHostedRunnerRuntimeConfigGraphPath(
  root: string,
): Promise<string[] | null> {
  const rootPath = resolve(repoRoot, root);
  const visited = new Set<string>();
  const stack: Array<{ file: string; path: string[] }> = [{
    file: rootPath,
    path: [toRepoPath(rootPath)],
  }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current.file)) {
      continue;
    }
    visited.add(current.file);

    if (isDeniedHostedRunnerRuntimeConfigModule(current.file)) {
      return current.path;
    }

    const source = await readFile(current.file, "utf8");
    for (const specifier of readStaticModuleSpecifiers(source)) {
      if (isDeniedHostedRunnerRuntimeConfigSpecifier(specifier)) {
        return [...current.path, specifier];
      }

      const resolvedModule = resolveLocalModule(current.file, specifier);
      if (!resolvedModule || visited.has(resolvedModule)) {
        continue;
      }
      stack.push({
        file: resolvedModule,
        path: [...current.path, toRepoPath(resolvedModule)],
      });
    }
  }

  return null;
}

function readModuleSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /\bimport\s+(?!type\b)(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/gu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
    /\bexport\s+(?!type\b)[^'";]*?\s+from\s+["']([^"']+)["']/gu,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier) {
        specifiers.add(specifier);
      }
    }
  }

  return [...specifiers];
}

function readStaticModuleSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /\bimport\s+(?!type\b)(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/gu,
    /\bexport\s+(?!type\b)[^'";]*?\s+from\s+["']([^"']+)["']/gu,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier) {
        specifiers.add(specifier);
      }
    }
  }

  return [...specifiers];
}

function resolveLocalModule(importer: string, specifier: string): string | null {
  if (specifier.startsWith("@murphai/device-syncd")) {
    return resolveDeviceSyncdSubpath(specifier);
  }

  if (specifier.startsWith("@/")) {
    return resolveTsModule(resolve(webRoot, specifier.slice(2)));
  }

  if (specifier.startsWith(".")) {
    return resolveTsModule(resolve(dirname(importer), specifier));
  }

  return null;
}

function resolveDeviceSyncdSubpath(specifier: string): string | null {
  if (specifier === "@murphai/device-syncd") {
    return resolveTsModule(resolve(deviceSyncdSrcRoot, "index"));
  }

  const prefix = "@murphai/device-syncd/";
  if (!specifier.startsWith(prefix)) {
    return null;
  }

  return resolveTsModule(resolve(deviceSyncdSrcRoot, specifier.slice(prefix.length)));
}

function resolveTsModule(basePath: string): string | null {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    resolve(basePath, "index.ts"),
  ];

  return candidates.find(isFile) ?? null;
}

function isDeniedWebSafeDeviceSyncModule(file: string): boolean {
  const repoPath = toRepoPath(file);
  return DENIED_WEB_SAFE_DEVICE_SYNC_MODULES.has(repoPath)
    || repoPath.startsWith("packages/device-syncd/src/providers/");
}

function isDeniedHostedRunnerRuntimeConfigModule(file: string): boolean {
  const repoPath = toRepoPath(file);
  return DENIED_WEB_SAFE_DEVICE_SYNC_MODULES.has(repoPath)
    || repoPath.startsWith("packages/device-syncd/src/providers/");
}

function isDeniedHostedRunnerRuntimeConfigSpecifier(specifier: string): boolean {
  return specifier === "@murphai/importers"
    || specifier.startsWith("@murphai/importers/")
    || specifier === "@junction-api/sdk"
    || specifier.startsWith("@junction-api/sdk/");
}

function toRepoPath(file: string): string {
  return relative(repoRoot, file).replaceAll("\\", "/");
}

function isFile(file: string): boolean {
  return existsSync(file) && statSync(file).isFile();
}
