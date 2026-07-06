import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

const temporaryDirectories: string[] = [];

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
        totalBytes: 3_000,
      }),
    ).toThrow(
      /total output 6000B exceeds budget 3000B; entry chunk dist-bundled\/container-entrypoint\.js 2000B exceeds budget 1000B[\s\S]*5000B node_modules\/heavy\/index\.js/,
    );

    expect(
      assertRunnerEntrypointBundleWithinBudgets(metafile, {
        entryBytes: 10_000,
        totalBytes: 10_000,
      }),
    ).toEqual({ entryBytes: 2_000, totalBytes: 6_000 });
  });

  it("rejects provider connector inputs from the static boot closure", () => {
    const metafile = staticBootClosureMetafile("node_modules/grammy/out/mod.js");

    expect(() =>
      assertRunnerEntrypointBundleWithinBudgets(metafile, {
        entryBytes: 10_000,
        totalBytes: 10_000,
      }),
    ).toThrow(/provider connector inputs in the static boot closure[\s\S]*node_modules\/grammy\/out\/mod\.js/);
  });

  it("rejects staged @murphai/inboxd connector inputs from the static boot closure", () => {
    const inputPath =
      ".deploy/runner-bundle/node_modules/@murphai/inboxd/dist/connectors/hosted-conversation.js";
    const metafile = staticBootClosureMetafile(inputPath);

    expect(() =>
      assertRunnerEntrypointBundleWithinBudgets(metafile, {
        entryBytes: 10_000,
        totalBytes: 10_000,
      }),
    ).toThrow(
      /provider connector inputs in the static boot closure[\s\S]*\.deploy\/runner-bundle\/node_modules\/@murphai\/inboxd\/dist\/connectors\/hosted-conversation\.js/,
    );
  });

  it("rejects workspace @murphai/inboxd connector inputs from the static boot closure", () => {
    const metafile = staticBootClosureMetafile(
      "packages/inboxd/dist/connectors/hosted-conversation.js",
    );

    expect(() =>
      assertRunnerEntrypointBundleWithinBudgets(metafile, {
        entryBytes: 10_000,
        totalBytes: 10_000,
      }),
    ).toThrow(
      /provider connector inputs in the static boot closure[\s\S]*packages\/inboxd\/dist\/connectors\/hosted-conversation\.js/,
    );
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
      assertRunnerEntrypointBundleWithinBudgets(metafile, {
        entryBytes: 10_000,
        totalBytes: 10_000,
      }),
    ).toEqual({ entryBytes: 2_000, totalBytes: 6_000 });
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

  it("resolves the production budgets as the ratcheted entry baseline plus tolerance", () => {
    const budgets = resolveRunnerEntrypointBundleBudgets();

    // Entry = measured baseline (2,288,516B on 2026-07-06) + 48,000B noise
    // band. Locking the exact value makes any silent change to the ratchet a
    // failing, reviewed diff.
    expect(budgets).toEqual({
      entryBytes: 2_288_516 + 48_000,
      totalBytes: 9_300_000,
    });
    // The ratchet is meaningfully tighter than the prior loose 2.9MB ceiling
    // it replaced, so real boot-path creep can no longer hide in headroom.
    expect(budgets.entryBytes).toBeLessThan(2_900_000);
  });

  it("gates the entry chunk at the production ratchet boundary", () => {
    const { entryBytes } = resolveRunnerEntrypointBundleBudgets();

    // At the boundary the default (production) budgets accept the bundle.
    expect(
      assertRunnerEntrypointBundleWithinBudgets(entryOnlyMetafile(entryBytes)),
    ).toEqual({ entryBytes, totalBytes: entryBytes });

    // One byte over the baseline + tolerance trips the assembly.
    expect(() =>
      assertRunnerEntrypointBundleWithinBudgets(
        entryOnlyMetafile(entryBytes + 1),
      ),
    ).toThrow(/entry chunk .* exceeds budget/);
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
