import { access, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import {
  buildHostedWranglerDeployConfig,
} from "../scripts/deploy-automation/wrangler-config.ts";
import {
  buildHostedRunnerRuntimeArtifactPackageJson,
  hostedRunnerBuildPackageNames,
  hostedRunnerBundleOnlyDependencyNames,
  hostedRunnerRuntimeDependencyNames,
  hostedRunnerWorkspacePackageNames,
  publishedMurphBundledWorkspacePackageNames,
  runnerBundleDirectoryName,
} from "../scripts/runner-bundle-contract.js";

function createDeployEnvironment() {
  return {
    allowedUserEnvKeys: null,
    bundlesBucketName: "bundles",
    bundlesPreviewBucketName: "bundles-preview",
    platformEnvelopeKeyId: "v1",
    compatibilityDate: "2026-03-27",
    containerInstanceType: "standard-1" as const,
    containerMaxInstances: 50,
    logHeadSamplingRate: 1,
    maxEventAttempts: "3",
    retryDelayMs: "30000",
    runnerCommitTimeoutMs: "30000",
    runnerTimeoutMs: "120000",
    traceHeadSamplingRate: 0.1,
    workerName: "murph-hosted",
    workerVars: {},
  }
}

describe("hosted runner container image contract", () => {
  it("keeps runner bundle assembly app-owned and materializes a runtime-only leaf artifact", async () => {
    const bundleAssemblyScript = await readFile(
      new URL("../scripts/assemble-runner-bundle.ts", import.meta.url),
      "utf8",
    );

    expect(bundleAssemblyScript).toContain("const runnerBundleDeployRoot = path.join(");
    expect(bundleAssemblyScript).toContain('const shouldSkipBuild = process.argv.includes("--skip-build");');
    expect(bundleAssemblyScript).toContain(
      'import { resolveCloudflareDeployPaths } from "./deploy-automation.js";',
    );
    expect(bundleAssemblyScript).toContain(
      '} from "./runner-bundle-contract.js";',
    );
    expect(bundleAssemblyScript).toContain("runnerBundleDirectoryName,");
    expect(bundleAssemblyScript).toContain("if (!shouldSkipBuild) {");
    expect(bundleAssemblyScript).toContain(
      "await buildHostedRunnerWorkspaceArtifacts(hostedRunnerBuildPackageNames);",
    );
    expect(bundleAssemblyScript).toContain(
      "await stageHostedRunnerRuntimeArtifact(stagingBundleDir);",
    );
    expect(bundleAssemblyScript).toContain(
      "await packWorkspacePackageArtifacts(",
    );
    expect(bundleAssemblyScript).toContain(
      "await installPackedRunnerDependencies(",
    );
    expect(bundleAssemblyScript).toContain(
      'const recursiveBuildArgs = [',
    );
    expect(bundleAssemblyScript).toContain('"recursive",');
    expect(bundleAssemblyScript).toContain('"--workspace-concurrency=1",');
    expect(bundleAssemblyScript).toContain(
      '...packageNames.flatMap((packageName) => ["--filter", packageName]),',
    );
    expect(bundleAssemblyScript).toContain("hostedRunnerBuildPackageNames");
    expect(bundleAssemblyScript).toContain("hostedRunnerWorkspacePackageNames,");
    expect(bundleAssemblyScript).toContain(
      "await materializeFinalRunnerBundle(",
    );
    expect(bundleAssemblyScript).toContain(
      "await mkdir(finalParentDir, { recursive: true });",
    );
    expect(bundleAssemblyScript).toContain(
      "await pruneRunnerBundle(stagingBundleDir);",
    );
    expect(bundleAssemblyScript).toContain(
      "await rewriteRuntimePackageManifest(stagingBundleDir);",
    );
    expect(bundleAssemblyScript).toContain(
      "await rewriteRuntimeBinWrappers(stagingBundleDir);",
    );
    expect(bundleAssemblyScript).toContain(
      'removeBundlePathIfPresent(path.join(bundleDir, "README.md"))',
    );
    expect(bundleAssemblyScript).toContain(
      'removeBundlePathIfPresent(path.join(bundleDir, "DEPLOY.md"))',
    );
    expect(bundleAssemblyScript).toContain(
      'removeBundlePathIfPresent(path.join(bundleDir, "LICENSE"))',
    );
    expect(bundleAssemblyScript).toContain(
      'entryName === ".pnpm-workspace-state-v1.json"',
    );
    expect(bundleAssemblyScript).toContain('entryName === ".modules.yaml"');
    expect(bundleAssemblyScript).toContain('entryName === "pnpm-lock.yaml"');
    expect(bundleAssemblyScript).toContain('entryPath.endsWith(".d.ts")');
    expect(bundleAssemblyScript).toContain('entryPath.endsWith(".map")');
    expect(bundleAssemblyScript).toContain('entryPath.endsWith(".tsbuildinfo")');
    expect(bundleAssemblyScript).not.toContain("loadWorkspacePackageIndex");
    expect(bundleAssemblyScript).not.toContain("collectWorkspaceRuntimeClosure");
    expect(bundleAssemblyScript).not.toContain("collectWorkspacePackageNamesFromRoots");
    expect(bundleAssemblyScript).not.toContain("workspaceRootDirs");
    expect(bundleAssemblyScript).not.toContain("extractTarball(");
    expect(bundleAssemblyScript).not.toContain("build:workspace:incremental");
    expect(bundleAssemblyScript).not.toContain("stageRunnerVaultCliArtifact(");
    expect(bundleAssemblyScript).not.toContain("buildRunnerVaultCliArtifactPackageJson(");
    expect(bundleAssemblyScript).not.toContain("runnerVaultCliArtifact");
    expect(bundleAssemblyScript).not.toContain('../src/deploy-automation.js');
    expect(bundleAssemblyScript).not.toContain('../src/runner-bundle-contract.js');
    expect(bundleAssemblyScript).not.toContain('"--legacy"');
    expect(bundleAssemblyScript).not.toContain('"deploy",');

    await expect(
      access(new URL("../src/deploy-automation.ts", import.meta.url)),
    ).rejects.toThrow();
    await expect(
      access(new URL("../src/deploy-preflight.ts", import.meta.url)),
    ).rejects.toThrow();
    await expect(
      access(new URL("../src/r2-lifecycle.ts", import.meta.url)),
    ).rejects.toThrow();
    await expect(
      access(new URL("../src/runner-bundle-contract.ts", import.meta.url)),
    ).rejects.toThrow();
  });

  it("keeps only the runtime leaf dependencies in the published package manifest", async () => {
    const packageJson = JSON.parse(await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    )) as {
      dependencies?: Record<string, string>;
    };

    for (const dependencyName of hostedRunnerRuntimeDependencyNames) {
      expect(packageJson.dependencies).toHaveProperty(dependencyName);
    }

    expect(Object.keys(packageJson.dependencies ?? {}).sort()).toEqual(
      [...hostedRunnerRuntimeDependencyNames].sort(),
    );
  });

  it("prunes pnpm workspace metadata recursively from the staged runner bundle", async () => {
    const bundleAssemblyScript = await readFile(
      new URL("../scripts/assemble-runner-bundle.ts", import.meta.url),
      "utf8",
    );

    expect(bundleAssemblyScript).toContain("await pruneNonRuntimeFiles(bundleDir);");
    expect(bundleAssemblyScript).toContain("await walkBundleFiles(rootDir, async (entryPath) => {");
    expect(bundleAssemblyScript).toContain(
      'entryName === ".pnpm-workspace-state-v1.json"',
    );
  });

  it("describes the runtime artifact and explicit build/runtime closures", () => {
    const hostedRunnerWorkspacePackageNameSet = new Set<string>(
      hostedRunnerWorkspacePackageNames,
    );
    const runtimeDependencies = Object.fromEntries(
      [...hostedRunnerRuntimeDependencyNames, ...hostedRunnerBundleOnlyDependencyNames].map((dependencyName) => [
        dependencyName,
        "1.2.3",
      ]),
    ) as Record<
      | (typeof hostedRunnerRuntimeDependencyNames)[number]
      | (typeof hostedRunnerBundleOnlyDependencyNames)[number],
      string
    >;
    const runtimePackageJson = buildHostedRunnerRuntimeArtifactPackageJson({
      dependencies: runtimeDependencies,
      engines: {
        node: ">=24.14.1",
      },
      exports: {
        ".": "./dist/index.js",
      },
      license: "Apache-2.0",
      main: "./dist/index.js",
      version: "0.0.0",
    });

    expect(runnerBundleDirectoryName).toBe("runner-bundle");
    expect(Object.keys(runtimeDependencies).sort()).toEqual(
      [...hostedRunnerRuntimeDependencyNames, ...hostedRunnerBundleOnlyDependencyNames].sort(),
    );
    expect(hostedRunnerWorkspacePackageNames).toEqual([
      "@murphai/assistant-engine",
      "@murphai/assistant-runtime",
      "@murphai/cloudflare-hosted-control",
      "@murphai/contracts",
      "@murphai/core",
      "@murphai/device-syncd",
      "@murphai/gateway-core",
      "@murphai/gateway-local",
      "@murphai/hosted-execution",
      "@murphai/importers",
      "@murphai/inbox-services",
      "@murphai/inboxd",
      "@murphai/messaging-ingress",
      "@murphai/murph",
      "@murphai/operator-config",
      "@murphai/parsers",
      "@murphai/query",
      "@murphai/runtime-state",
      "@murphai/vault-usecases",
    ]);
    expect(hostedRunnerBuildPackageNames).toEqual([
      ...hostedRunnerWorkspacePackageNames,
      ...publishedMurphBundledWorkspacePackageNames.filter(
        (packageName) => !hostedRunnerWorkspacePackageNameSet.has(packageName),
      ),
    ]);
    expect(new Set(hostedRunnerBuildPackageNames)).toEqual(
      new Set([
        ...hostedRunnerWorkspacePackageNames,
        ...publishedMurphBundledWorkspacePackageNames,
      ]),
    );
    expect(runtimePackageJson).toEqual({
      name: "@murphai/cloudflare-runner",
      private: true,
      type: "module",
      version: "0.0.0",
      license: "Apache-2.0",
      main: "./dist/index.js",
      exports: {
        ".": "./dist/index.js",
      },
      engines: {
        node: ">=24.14.1",
      },
      dependencies: runtimeDependencies,
    });
  });

  it("builds every bundled private workspace dependency that the published murph package packs", async () => {
    const murphPackageJson = JSON.parse(await readFile(
      new URL("../../../packages/cli/package.json", import.meta.url),
      "utf8",
    )) as {
      bundleDependencies?: string[];
    };

    expect(murphPackageJson.bundleDependencies).toEqual(
      publishedMurphBundledWorkspacePackageNames,
    );

    for (const dependencyName of publishedMurphBundledWorkspacePackageNames) {
      expect(hostedRunnerBuildPackageNames).toContain(dependencyName);
    }
  });

  it("pins whisper.cpp provisioning and default parser env in the image", async () => {
    const dockerfile = await readFile(
      new URL("../../../Dockerfile.cloudflare-hosted-runner", import.meta.url),
      "utf8",
    );

    expect(dockerfile).toContain("ARG WHISPER_CPP_VERSION=v1.8.1");
    expect(dockerfile).toContain("ARG WHISPER_MODEL_FILE=ggml-base.en.bin");
    expect(dockerfile).toContain("ARG NODE_VERSION=24.14.1");
    expect(dockerfile).toContain("FROM node:${NODE_VERSION}-bookworm-slim AS whisper-builder");
    expect(dockerfile).toContain("FROM node:${NODE_VERSION}-bookworm-slim\n\nARG NODE_VERSION");
    expect(dockerfile).toContain(
      "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${WHISPER_CPP_VERSION}.tar.gz",
    );
    expect(dockerfile).toContain("-DGGML_NATIVE=OFF");
    expect(dockerfile).not.toContain("GGML_CPU_ARM_ARCH");
    expect(dockerfile).toContain(
      "cmake --build build -j\"$(nproc)\" --config Release --target whisper-cli",
    );
    expect(dockerfile).toContain("COPY --from=whisper-builder /opt/whisper/bin/whisper-cli /usr/local/bin/whisper-cli");
    expect(dockerfile).toContain("COPY --from=whisper-builder /opt/whisper/lib/ /usr/local/lib/");
    expect(dockerfile).toContain(
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_MODEL_FILE}",
    );
    expect(dockerfile).toContain(
      "COPY --chown=runner:runner .deploy/runner-bundle/ /app/",
    );
    expect(dockerfile).not.toContain("wrangler.generated.jsonc");
    expect(dockerfile).not.toContain("worker-secrets.json");
    expect(dockerfile).not.toContain("runner-bundle-builder");
    expect(dockerfile).not.toContain("pnpm install --frozen-lockfile");
    expect(dockerfile).toContain("PATH=/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
    expect(dockerfile).toContain("PDFTOTEXT_COMMAND=/usr/bin/pdftotext");
    expect(dockerfile).toContain("WHISPER_COMMAND=/usr/local/bin/whisper-cli");
    expect(dockerfile).toContain(
      "WHISPER_MODEL_PATH=/home/runner/.murph/models/whisper/${WHISPER_MODEL_FILE}",
    );
    expect(dockerfile).toContain("RUN ldconfig");
    expect(dockerfile).toContain('CMD ["node", "dist/container-entrypoint.js"]');
  });

  it("pins the checked-in and rendered Wrangler config to an app-local build context", async () => {
    const wranglerConfig = await readFile(
      new URL("../wrangler.jsonc", import.meta.url),
      "utf8",
    );
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };
    const rendered = buildHostedWranglerDeployConfig(createDeployEnvironment());
    const [container] = rendered.containers as Array<Record<string, unknown>>;

    expect(wranglerConfig).toContain('"image": "../../Dockerfile.cloudflare-hosted-runner"');
    expect(wranglerConfig).toContain('"image_build_context": "."');
    expect(packageJson.scripts?.["runner:docker:build"]).toBe(
      "pnpm runner:bundle && docker build -f ../../Dockerfile.cloudflare-hosted-runner -t murph-cloudflare-runner .",
    );
    expect(packageJson.scripts?.["runner:bundle:assemble-only"]).toBe(
      "pnpm --dir ../.. exec tsx --tsconfig apps/cloudflare/tsconfig.scripts.json apps/cloudflare/scripts/assemble-runner-bundle.ts --skip-build",
    );
    expect(packageJson.scripts?.["runner:docker:smoke:prepare"]).toContain("pnpm --filter @murphai/cloudflare-runner... run build && pnpm runner:bundle:assemble-only &&");
    expect(container.image).toBe("../../../Dockerfile.cloudflare-hosted-runner");
    expect(container.image_build_context).toBe("..");
  });

  it("keeps only the prepared runner bundle from .deploy in the app-local Docker context", async () => {
    const dockerignore = await readFile(new URL("../.dockerignore", import.meta.url), "utf8");

    expect(dockerignore).toContain("**");
    expect(dockerignore).toContain("!.deploy/");
    expect(dockerignore).toContain("!.deploy/runner-bundle/");
    expect(dockerignore).toContain("!.deploy/runner-bundle/**");
    expect(dockerignore).not.toContain("!apps/cloudflare/.deploy/wrangler.generated.jsonc");
    expect(dockerignore).not.toContain("!apps/cloudflare/.deploy/worker-secrets.json");
  });
});
