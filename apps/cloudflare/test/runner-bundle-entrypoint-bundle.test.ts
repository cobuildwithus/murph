import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Metafile } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertRunnerEntrypointBundleWithinBudgets,
  bundleRunnerContainerEntrypoint,
  collectLazyRunnerEntrypointOutputPaths,
  resolveRunnerEntrypointBundleBudgets,
  RUNNER_ENTRYPOINT_BUNDLE_DIRECTORY_NAME,
} from "../scripts/runner-bundle/bundle-entrypoint.js";

// A metafile with a single container-entrypoint.js output sized to `entryBytes`
// and no other chunks, so the total equals the entry size. Used to prove the
// production budgets gate the entry chunk at the ratchet boundary.
function entryOnlyMetafile(entryBytes: number): Metafile {
  return {
    inputs: { "dist/container-entrypoint.js": { bytes: 10, imports: [] } },
    outputs: {
      "dist-bundled/container-entrypoint.js": {
        bytes: entryBytes,
        entryPoint: "dist/container-entrypoint.js",
        exports: [],
        imports: [],
        inputs: {},
      },
    },
  };
}

function staticBootClosureBytesMetafile(staticClosureBytes: number): Metafile {
  const entryBytes = 1_000;
  const staticChunkBytes = staticClosureBytes - entryBytes;
  if (staticChunkBytes < 0) {
    throw new Error("static closure bytes must include the entry chunk");
  }

  return {
    inputs: {
      "dist/container-entrypoint.js": { bytes: 100, imports: [] },
      "dist/static-heavy.js": { bytes: staticChunkBytes, imports: [] },
    },
    outputs: {
      "dist-bundled/container-entrypoint.js": {
        bytes: entryBytes,
        entryPoint: "dist/container-entrypoint.js",
        exports: [],
        imports: [
          { kind: "import-statement", path: "dist-bundled/static-heavy.js" },
        ],
        inputs: {
          "dist/container-entrypoint.js": { bytesInOutput: 100 },
        },
      },
      "dist-bundled/static-heavy.js": {
        bytes: staticChunkBytes,
        entryPoint: undefined,
        exports: [],
        imports: [],
        inputs: {
          "dist/static-heavy.js": { bytesInOutput: staticChunkBytes },
        },
      },
    },
  };
}

function staticBootClosureMetafile(inputPath: string): Metafile {
  return {
    inputs: {
      "dist/container-entrypoint.js": { bytes: 600, imports: [] },
      [inputPath]: { bytes: 5_000, imports: [] },
    },
    outputs: {
      "dist-bundled/container-entrypoint.js": {
        bytes: 2_000,
        entryPoint: "dist/container-entrypoint.js",
        exports: [],
        imports: [{ kind: "import-statement", path: "./chunk-STATIC.js" }],
        inputs: {
          "dist/container-entrypoint.js": { bytesInOutput: 600 },
        },
      },
      "dist-bundled/chunk-STATIC.js": {
        bytes: 4_000,
        entryPoint: undefined,
        exports: [],
        imports: [],
        inputs: {
          [inputPath]: { bytesInOutput: 4_000 },
        },
      },
    },
  };
}

function dynamicOnlyChunkMetafile(dynamicChunkBytes: number): Metafile {
  return {
    inputs: {
      "dist/container-entrypoint.js": { bytes: 100, imports: [] },
      "dist/lazy-heavy.js": { bytes: dynamicChunkBytes, imports: [] },
    },
    outputs: {
      "dist-bundled/container-entrypoint.js": {
        bytes: 1_000,
        entryPoint: "dist/container-entrypoint.js",
        exports: [],
        imports: [{ kind: "dynamic-import", path: "./lazy-heavy.js" }],
        inputs: {
          "dist/container-entrypoint.js": { bytesInOutput: 100 },
        },
      },
      "dist-bundled/lazy-heavy.js": {
        bytes: dynamicChunkBytes,
        entryPoint: "dist/lazy-heavy.js",
        exports: [],
        imports: [],
        inputs: {
          "dist/lazy-heavy.js": { bytesInOutput: dynamicChunkBytes },
        },
      },
    },
  };
}

function dynamicImportMetafile(inputPath: string): Metafile {
  return {
    inputs: {
      "dist/container-entrypoint.js": { bytes: 600, imports: [] },
      [inputPath]: { bytes: 5_000, imports: [] },
    },
    outputs: {
      "dist-bundled/container-entrypoint.js": {
        bytes: 2_000,
        entryPoint: "dist/container-entrypoint.js",
        exports: [],
        imports: [{ kind: "dynamic-import", path: "./device-sync-LAZY.js" }],
        inputs: {
          "dist/container-entrypoint.js": { bytesInOutput: 600 },
        },
      },
      "dist-bundled/device-sync-LAZY.js": {
        bytes: 4_000,
        entryPoint: "dist/device-sync.js",
        exports: [],
        imports: [],
        inputs: {
          [inputPath]: { bytesInOutput: 4_000 },
        },
      },
    },
  };
}

const temporaryDirectories: string[] = [];
const ROOMY_TEST_BUDGETS = {
  entryBytes: 10_000,
  staticClosureBytes: 10_000,
  totalBytes: 10_000,
};
const RUNNER_TREE_SHAKE_REQUIRED_PACKAGE_MANIFESTS = [
  ["@murphai/contracts", "packages/contracts/package.json"],
  ["@murphai/query", "packages/query/package.json"],
] as const;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

// A miniature staged runner bundle that exercises the bundle hazards the real
// entrypoint has: a multi-module graph, a dynamic import (esbuild splitting),
// an external dependency that must resolve from the staged node_modules at
// boot, and createRequire interop from the banner.
async function createFakeRunnerBundle(): Promise<string> {
  const bundleDir = await mkdtemp(path.join(tmpdir(), "murph-entrypoint-bundle-"));
  temporaryDirectories.push(bundleDir);

  await mkdir(path.join(bundleDir, "dist"), { recursive: true });
  await mkdir(path.join(bundleDir, "node_modules", "sharp"), { recursive: true });
  await writeFile(
    path.join(bundleDir, "node_modules", "sharp", "package.json"),
    `${JSON.stringify({ main: "index.js", name: "sharp", type: "module", version: "1.0.0" })}\n`,
    "utf8",
  );
  await writeFile(
    path.join(bundleDir, "node_modules", "sharp", "index.js"),
    "export default function sharp() { return 'installed-sharp'; }\n",
    "utf8",
  );
  await writeFile(
    path.join(bundleDir, "dist", "helper.js"),
    "export const helperValue = 'helper';\n",
    "utf8",
  );
  await writeFile(
    path.join(bundleDir, "dist", "lazy.js"),
    "export const lazyValue = 'lazy';\n",
    "utf8",
  );
  await writeFile(
    path.join(bundleDir, "dist", "container-entrypoint.js"),
    [
      "import sharp from 'sharp';",
      "import { helperValue } from './helper.js';",
      "const lazyLoader = () => import('./lazy.js');",
      "export function startHostedContainerEntrypoint() {",
      "  return `${sharp()}:${helperValue}:${typeof lazyLoader}`;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  return bundleDir;
}

describe("runner bundle container-entrypoint esbuild step", () => {
  it.each(RUNNER_TREE_SHAKE_REQUIRED_PACKAGE_MANIFESTS)(
    "requires %s to declare side-effect-free modules for tree shaking",
    async (packageName, manifestPath) => {
      const manifest: unknown = JSON.parse(
        await readFile(
          path.resolve(import.meta.dirname, "../../..", manifestPath),
          "utf8",
        ),
      );
      if (typeof manifest !== "object" || manifest === null) {
        throw new Error(`${manifestPath} must contain a JSON object.`);
      }

      expect(
        "sideEffects" in manifest ? manifest.sideEffects : undefined,
        `${packageName} must declare \"sideEffects\": false so the runner bundle can remove unused exports.`,
      ).toBe(false);
    },
  );

  it("bundles the staged entrypoint, resolves externals at boot, and passes the boot probe", async () => {
    const bundleDir = await createFakeRunnerBundle();

    await bundleRunnerContainerEntrypoint(bundleDir);

    await expect(
      access(path.join(
        bundleDir,
        RUNNER_ENTRYPOINT_BUNDLE_DIRECTORY_NAME,
        "container-entrypoint.js",
      )),
    ).resolves.toBeUndefined();
  });

  it("fails fast when the staged entry is missing", async () => {
    const bundleDir = await mkdtemp(path.join(tmpdir(), "murph-entrypoint-missing-"));
    temporaryDirectories.push(bundleDir);

    await expect(bundleRunnerContainerEntrypoint(bundleDir)).rejects.toThrow();
  });

  it("fails the boot probe when the bundled entry cannot evaluate", async () => {
    const bundleDir = await createFakeRunnerBundle();
    // Remove the installed external so chunk evaluation fails at import time.
    await rm(path.join(bundleDir, "node_modules", "sharp"), {
      force: true,
      recursive: true,
    });

    await expect(bundleRunnerContainerEntrypoint(bundleDir)).rejects.toThrow(
      /boot probe failed/,
    );
  });

  it("fails the byte budgets with actual-vs-budget numbers and the largest inputs", () => {
    const metafile: Metafile = {
      inputs: {
        "dist/container-entrypoint.js": { bytes: 600, imports: [] },
        "node_modules/heavy/index.js": { bytes: 5_000, imports: [] },
      },
      outputs: {
        "dist-bundled/chunk-AAAA.js": {
          bytes: 4_000,
          entryPoint: undefined,
          exports: [],
          imports: [],
          inputs: {},
        },
        "dist-bundled/container-entrypoint.js": {
          bytes: 2_000,
          entryPoint: "dist/container-entrypoint.js",
          exports: [],
          imports: [],
          inputs: {},
        },
      },
    };

    expect(() =>
      assertRunnerEntrypointBundleWithinBudgets(metafile, {
        entryBytes: 1_000,
        staticClosureBytes: 10_000,
        totalBytes: 3_000,
      }),
    ).toThrow(
      /total output 6000B exceeds budget 3000B; entry chunk dist-bundled\/container-entrypoint\.js 2000B exceeds budget 1000B[\s\S]*5000B node_modules\/heavy\/index\.js/,
    );

    expect(
      assertRunnerEntrypointBundleWithinBudgets(metafile, ROOMY_TEST_BUDGETS),
    ).toEqual({
      entryBytes: 2_000,
      staticClosureBytes: 2_000,
      totalBytes: 6_000,
    });
  });

  it("rejects provider connector inputs from the static boot closure", () => {
    const metafile = staticBootClosureMetafile("node_modules/grammy/out/mod.js");

    expect(() =>
      assertRunnerEntrypointBundleWithinBudgets(metafile, ROOMY_TEST_BUDGETS),
    ).toThrow(/forbidden inputs in the static boot closure[\s\S]*node_modules\/grammy\/out\/mod\.js/);
  });

  it("rejects staged @murphai/inboxd connector inputs from the static boot closure", () => {
    const inputPath =
      ".deploy/runner-bundle/node_modules/@murphai/inboxd/dist/connectors/hosted-conversation.js";
    const metafile = staticBootClosureMetafile(inputPath);

    expect(() =>
      assertRunnerEntrypointBundleWithinBudgets(metafile, ROOMY_TEST_BUDGETS),
    ).toThrow(
      /forbidden inputs in the static boot closure[\s\S]*\.deploy\/runner-bundle\/node_modules\/@murphai\/inboxd\/dist\/connectors\/hosted-conversation\.js/,
    );
  });

  it("rejects workspace @murphai/inboxd connector inputs from the static boot closure", () => {
    const metafile = staticBootClosureMetafile(
      "packages/inboxd/dist/connectors/hosted-conversation.js",
    );

    expect(() =>
      assertRunnerEntrypointBundleWithinBudgets(metafile, ROOMY_TEST_BUDGETS),
    ).toThrow(
      /forbidden inputs in the static boot closure[\s\S]*packages\/inboxd\/dist\/connectors\/hosted-conversation\.js/,
    );
  });

  it.each([
    [
      "staged device-sync service",
      ".deploy/runner-bundle/node_modules/@murphai/device-syncd/dist/service.js",
      /node_modules\/@murphai\/device-syncd\/dist\/service\.js/,
    ],
    [
      "workspace device-sync service",
      "packages/device-syncd/dist/service.js",
      /packages\/device-syncd\/dist\/service\.js/,
    ],
    [
      "device-sync registry",
      ".deploy/runner-bundle/node_modules/@murphai/device-syncd/dist/registry.js",
      /node_modules\/@murphai\/device-syncd\/dist\/registry\.js/,
    ],
    [
      "device-sync provider graph",
      ".deploy/runner-bundle/node_modules/@murphai/device-syncd/dist/providers/oura.js",
      /node_modules\/@murphai\/device-syncd\/dist\/providers\/oura\.js/,
    ],
    [
      "importers",
      ".deploy/runner-bundle/node_modules/@murphai/importers/dist/index.js",
      /node_modules\/@murphai\/importers\/dist\/index\.js/,
    ],
    [
      "clinical-records",
      ".deploy/runner-bundle/node_modules/@murphai/clinical-records/dist/index.js",
      /node_modules\/@murphai\/clinical-records\/dist\/index\.js/,
    ],
    [
      "unapproved clinical-records leaves",
      ".deploy/runner-bundle/node_modules/@murphai/clinical-records/dist/unapproved.js",
      /node_modules\/@murphai\/clinical-records\/dist\/unapproved\.js/,
    ],
    [
      "Junction SDK",
      ".deploy/runner-bundle/node_modules/@junction-api/sdk/index.js",
      /node_modules\/@junction-api\/sdk\/index\.js/,
    ],
    [
      "staged Murph Age health-metrics calculator",
      ".deploy/runner-bundle/node_modules/@murphai/health-metrics/dist/murph-age.js",
      /node_modules\/@murphai\/health-metrics\/dist\/murph-age\.js/,
    ],
    [
      "staged Murph Age health-metrics source routes",
      ".deploy/runner-bundle/node_modules/@murphai/health-metrics/dist/murph-age-source-routes.js",
      /node_modules\/@murphai\/health-metrics\/dist\/murph-age-source-routes\.js/,
    ],
    [
      "staged contract examples",
      ".deploy/runner-bundle/node_modules/@murphai/contracts/dist/examples.js",
      /node_modules\/@murphai\/contracts\/dist\/examples\.js/,
    ],
    [
      "workspace Murph Age query runtime",
      "packages/query/dist/murph-age.js",
      /packages\/query\/dist\/murph-age\.js/,
    ],
    [
      "workspace Murph Age browser replica",
      "packages/query/dist/browser-replica/murph-age.js",
      /packages\/query\/dist\/browser-replica\/murph-age\.js/,
    ],
    [
      "dynamic-tool execution runtime",
      ".deploy/runner-bundle/node_modules/@murphai/assistant-engine/dist/assistant-codex/dynamic-tools.js",
      /assistant-engine\/dist\/assistant-codex\/dynamic-tools\.js/,
    ],
    [
      "staged assistant-notification wake handler",
      ".deploy/runner-bundle/node_modules/@murphai/assistant-runtime/dist/hosted-runtime/events/assistant-notification.js",
      /node_modules\/@murphai\/assistant-runtime\/dist\/hosted-runtime\/events\/assistant-notification\.js/,
    ],
    [
      "workspace assistant-ask-completion wake handler",
      "packages/assistant-runtime/dist/hosted-runtime/events/assistant-ask-completion.js",
      /packages\/assistant-runtime\/dist\/hosted-runtime\/events\/assistant-ask-completion\.js/,
    ],
    [
      "staged Environment voice wake handler",
      ".deploy/runner-bundle/node_modules/@murphai/assistant-runtime/dist/hosted-runtime/events/environment-voice.js",
      /node_modules\/@murphai\/assistant-runtime\/dist\/hosted-runtime\/events\/environment-voice\.js/,
    ],
    [
      "workspace Codex auth wake handler",
      "packages/assistant-runtime/dist/hosted-runtime/events/codex-auth.js",
      /packages\/assistant-runtime\/dist\/hosted-runtime\/events\/codex-auth\.js/,
    ],
    [
      "Zod locale catalog",
      "node_modules/zod/v4/locales/index.js",
      /node_modules\/zod\/v4\/locales\/index\.js/,
    ],
    [
      "non-English Zod locale",
      "node_modules/zod/v4/locales/fr.js",
      /node_modules\/zod\/v4\/locales\/fr\.js/,
    ],
  ])("rejects %s inputs from the static boot closure", (_label, inputPath, expected) => {
    const metafile = staticBootClosureMetafile(inputPath);

    expect(() =>
      assertRunnerEntrypointBundleWithinBudgets(metafile, ROOMY_TEST_BUDGETS),
    ).toThrow(expected);
  });

  it("allows the narrow clinical-records retrieval-limits leaf in the static boot closure", () => {
    const metafile = staticBootClosureMetafile(
      ".deploy/runner-bundle/node_modules/@murphai/clinical-records/dist/retrieval-limits.js",
    );

    expect(() =>
      assertRunnerEntrypointBundleWithinBudgets(metafile, ROOMY_TEST_BUDGETS)
    ).not.toThrow();
  });

  it("allows Zod's default English locale in the static boot closure", () => {
    const metafile = staticBootClosureMetafile(
      "node_modules/zod/v4/locales/en.js",
    );

    expect(() =>
      assertRunnerEntrypointBundleWithinBudgets(metafile, ROOMY_TEST_BUDGETS)
    ).not.toThrow();
  });

  it("allows provider connector inputs behind dynamic imports", () => {
    const metafile: Metafile = {
      inputs: {
        "dist/container-entrypoint.js": { bytes: 600, imports: [] },
        "node_modules/grammy/out/mod.js": { bytes: 5_000, imports: [] },
      },
      outputs: {
        "dist-bundled/container-entrypoint.js": {
          bytes: 2_000,
          entryPoint: "dist/container-entrypoint.js",
          exports: [],
          imports: [{ kind: "dynamic-import", path: "./conversation-LAZY.js" }],
          inputs: {
            "dist/container-entrypoint.js": { bytesInOutput: 600 },
          },
        },
        "dist-bundled/conversation-LAZY.js": {
          bytes: 4_000,
          entryPoint: "dist/conversation.js",
          exports: [],
          imports: [],
          inputs: {
            "node_modules/grammy/out/mod.js": { bytesInOutput: 4_000 },
          },
        },
      },
    };

    expect(
      assertRunnerEntrypointBundleWithinBudgets(metafile, ROOMY_TEST_BUDGETS),
    ).toEqual({
      entryBytes: 2_000,
      staticClosureBytes: 2_000,
      totalBytes: 6_000,
    });
  });

  it.each([
    ".deploy/runner-bundle/node_modules/@murphai/device-syncd/dist/service.js",
    ".deploy/runner-bundle/node_modules/@murphai/importers/dist/index.js",
    ".deploy/runner-bundle/node_modules/@junction-api/sdk/index.js",
  ])("allows %s behind dynamic imports", (inputPath) => {
    expect(
      assertRunnerEntrypointBundleWithinBudgets(
        dynamicImportMetafile(inputPath),
        ROOMY_TEST_BUDGETS,
      ),
    ).toEqual({
      entryBytes: 2_000,
      staticClosureBytes: 2_000,
      totalBytes: 6_000,
    });
  });

  it("collects output chunks reachable only through dynamic imports", () => {
    const metafile: Metafile = {
      inputs: {
        "dist/container-entrypoint.js": { bytes: 10, imports: [] },
        "dist/static.js": { bytes: 10, imports: [] },
        "dist/lazy.js": { bytes: 10, imports: [] },
      },
      outputs: {
        "dist-bundled/container-entrypoint.js": {
          bytes: 100,
          entryPoint: "dist/container-entrypoint.js",
          exports: [],
          imports: [
            { kind: "import-statement", path: "./static-STATIC.js" },
            { kind: "dynamic-import", path: "./lazy-LAZY.js" },
          ],
          inputs: {
            "dist/container-entrypoint.js": { bytesInOutput: 10 },
          },
        },
        "dist-bundled/static-STATIC.js": {
          bytes: 100,
          entryPoint: undefined,
          exports: [],
          imports: [
            { kind: "import-statement", path: "./static-shared-STATIC.js" },
          ],
          inputs: {
            "dist/static.js": { bytesInOutput: 10 },
          },
        },
        "dist-bundled/static-shared-STATIC.js": {
          bytes: 100,
          entryPoint: undefined,
          exports: [],
          imports: [],
          inputs: {},
        },
        "dist-bundled/lazy-LAZY.js": {
          bytes: 100,
          entryPoint: "dist/lazy.js",
          exports: [],
          imports: [
            { kind: "import-statement", path: "./lazy-shared-LAZY.js" },
          ],
          inputs: {
            "dist/lazy.js": { bytesInOutput: 10 },
          },
        },
        "dist-bundled/lazy-shared-LAZY.js": {
          bytes: 100,
          entryPoint: undefined,
          exports: [],
          imports: [],
          inputs: {},
        },
      },
    };

    expect([...collectLazyRunnerEntrypointOutputPaths(
      metafile,
      "dist-bundled/container-entrypoint.js",
    )].sort()).toEqual([
      "dist-bundled/lazy-LAZY.js",
      "dist-bundled/lazy-shared-LAZY.js",
    ]);
  });

  it("resolves the production budgets from measured baselines and jitter tolerances", () => {
    const budgets = resolveRunnerEntrypointBundleBudgets();

    // Mirror the production baselines plus their variance allowances so
    // budget-policy changes remain explicit and reviewed.
    expect(budgets).toEqual({
      entryBytes: 1_619_381 + 48_000,
      staticClosureBytes: 7_815_801 + 96_000,
      totalBytes: 9_920_711 + 32_768,
    });
  });

  it("gates the entry chunk at the production ratchet boundary", () => {
    const { entryBytes } = resolveRunnerEntrypointBundleBudgets();

    // At the boundary the default (production) budgets accept the bundle.
    expect(
      assertRunnerEntrypointBundleWithinBudgets(entryOnlyMetafile(entryBytes)),
    ).toEqual({
      entryBytes,
      staticClosureBytes: entryBytes,
      totalBytes: entryBytes,
    });

    // One byte over the configured budget trips the assembly.
    expect(() =>
      assertRunnerEntrypointBundleWithinBudgets(
        entryOnlyMetafile(entryBytes + 1),
      ),
    ).toThrow(/entry chunk .* exceeds budget/);
  });

  it("gates the static boot closure at the production ratchet boundary", () => {
    const { staticClosureBytes } = resolveRunnerEntrypointBundleBudgets();

    expect(
      assertRunnerEntrypointBundleWithinBudgets(
        staticBootClosureBytesMetafile(staticClosureBytes),
      ),
    ).toEqual({
      entryBytes: 1_000,
      staticClosureBytes,
      totalBytes: staticClosureBytes,
    });

    expect(() =>
      assertRunnerEntrypointBundleWithinBudgets(
        staticBootClosureBytesMetafile(staticClosureBytes + 1),
      ),
    ).toThrow(/static boot closure .* exceeds budget/);
  });

  it("gates total output at the production ratchet boundary", () => {
    const { totalBytes } = resolveRunnerEntrypointBundleBudgets();
    const dynamicChunkBytesAtBudget = totalBytes - 1_000;

    expect(
      assertRunnerEntrypointBundleWithinBudgets(
        dynamicOnlyChunkMetafile(dynamicChunkBytesAtBudget),
      ),
    ).toEqual({
      entryBytes: 1_000,
      staticClosureBytes: 1_000,
      totalBytes,
    });

    expect(() =>
      assertRunnerEntrypointBundleWithinBudgets(
        dynamicOnlyChunkMetafile(dynamicChunkBytesAtBudget + 1),
      ),
    ).toThrow(/total output .* exceeds budget/);
  });

  it("does not count dynamic-only chunks toward the static boot closure budget", () => {
    const { staticClosureBytes, totalBytes } = resolveRunnerEntrypointBundleBudgets();
    const dynamicChunkBytes = staticClosureBytes + 500_000;
    expect(dynamicChunkBytes + 1_000).toBeLessThan(totalBytes);

    expect(
      assertRunnerEntrypointBundleWithinBudgets(
        dynamicOnlyChunkMetafile(dynamicChunkBytes),
      ),
    ).toEqual({
      entryBytes: 1_000,
      staticClosureBytes: 1_000,
      totalBytes: dynamicChunkBytes + 1_000,
    });
  });

  it("rejects metafiles without a container-entrypoint.js entry output", () => {
    const metafile: Metafile = {
      inputs: {},
      outputs: {
        "dist-bundled/chunk-AAAA.js": {
          bytes: 10,
          entryPoint: undefined,
          exports: [],
          imports: [],
          inputs: {},
        },
      },
    };

    expect(() => assertRunnerEntrypointBundleWithinBudgets(metafile)).toThrow(
      /no container-entrypoint\.js entry-point output/,
    );
  });
});
