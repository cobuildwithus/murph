import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";

import { murphVitestNoTimeouts } from "../../config/vitest-timeouts.js";

import { cloudflareVitestAliases } from "./vitest.shared.js";

const cloudflareDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

patchVitestSourceMapParsing();

function patchVitestSourceMapParsing(): void {
  try {
    const vitestPackageJsonPath = require.resolve("vitest/package.json");
    const convertSourceMapPath = require.resolve("convert-source-map", {
      paths: [path.dirname(vitestPackageJsonPath)],
    });
    const convertSourceMap = require(convertSourceMapPath) as {
      fromSource: (code: string) => unknown;
    };
    const originalFromSource = convertSourceMap.fromSource.bind(convertSourceMap);

    convertSourceMap.fromSource = ((code: string): unknown => {
      try {
        return originalFromSource(code);
      } catch (error) {
        if (shouldIgnoreVitestSourceMapParseError(code, error)) {
          return null;
        }

        throw error;
      }
    }) as typeof convertSourceMap.fromSource;
  } catch {
    // If Vitest changes its dependency layout, keep the suite runnable without the patch.
  }
}

function shouldIgnoreVitestSourceMapParseError(code: string, error: unknown): boolean {
  return error instanceof SyntaxError
    && code.includes("sourceMappingURL=data:application/json;base64,`")
    && code.includes('"inlineSourceMap"');
}

class HostedLocalE2eSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return files;
  }
}

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "cloudflare:workers",
        replacement: path.resolve(cloudflareDir, "test/stubs/cloudflare-workers.ts"),
      },
      ...cloudflareVitestAliases,
    ],
  },
  test: {
    ...murphVitestNoTimeouts,
    environment: "node",
    fileParallelism: false,
    hookTimeout: 600_000,
    include: [path.join(cloudflareDir, "test", "*e2e.test.ts")],
    maxWorkers: 1,
    name: "cloudflare-hosted-local-e2e",
    sequence: {
      sequencer: HostedLocalE2eSequencer,
    },
    testTimeout: 600_000,
  },
});
