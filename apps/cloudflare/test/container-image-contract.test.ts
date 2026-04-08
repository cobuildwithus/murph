import { access, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import {
  buildHostedRunnerRuntimeArtifactPackageJson,
  buildRunnerVaultCliArtifactPackageJson,
  hostedRunnerBuildPackageNames,
  hostedRunnerWorkspacePackageNames,
  hostedRunnerWorkerDependencyNames,
  runnerBundleDirectoryName,
  runnerVaultCliArtifactDependencyNames,
  runnerVaultCliArtifactPackageName,
  runnerVaultCliArtifactWorkspacePackageNames,
} from "../scripts/runner-bundle-contract.js";

describe("hosted runner container image contract", () => {
  it("keeps runner bundle assembly app-owned and materializes a runtime-only leaf artifact", async () => {
    const bundleAssemblyScript = await readFile(
      new URL("../scripts/assemble-runner-bundle.ts", import.meta.url),
      "utf8",
    );

    expect(bundleAssemblyScript).toContain("const runnerBundleDeployRoot = path.join(");
    expect(bundleAssemblyScript).toContain(
      'import { resolveCloudflareDeployPaths } from "./deploy-automation.js";',
    );
    expect(bundleAssemblyScript).toContain(
      '} from "./runner-bundle-contract.js";',
    );
    expect(bundleAssemblyScript).toContain("runnerBundleDirectoryName,");
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
      "await stageRunnerVaultCliArtifact(",
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
      "runnerVaultCliArtifactWorkspacePackageNames,",
    );
    expect(bundleAssemblyScript).toContain(
      "await materializeFinalRunnerBundle(",
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

  it("keeps apps/cloudflare free of a direct @murphai/murph dependency and limits root deps to the worker runtime closure", async () => {
    const packageJson = JSON.parse(await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    )) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies).not.toHaveProperty("@murphai/murph");
    expect(packageJson.dependencies).not.toHaveProperty(
      runnerVaultCliArtifactPackageName,
    );

    for (const dependencyName of hostedRunnerWorkerDependencyNames) {
      expect(packageJson.dependencies).toHaveProperty(dependencyName);
    }

    expect(Object.keys(packageJson.dependencies ?? {}).sort()).toEqual(
      [...hostedRunnerWorkerDependencyNames].sort(),
    );
  });

  it("describes the runtime artifact and explicit build/runtime closures", () => {
    const runtimeDependencies = Object.fromEntries(
      hostedRunnerWorkerDependencyNames.map((dependencyName) => [
        dependencyName,
        "1.2.3",
      ]),
    ) as Record<(typeof hostedRunnerWorkerDependencyNames)[number], string>;
    const runtimePackageJson = buildHostedRunnerRuntimeArtifactPackageJson({
      dependencies: runtimeDependencies,
      engines: {
        node: ">=22.16.0",
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
      [...hostedRunnerWorkerDependencyNames].sort(),
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
      "@murphai/operator-config",
      "@murphai/parsers",
      "@murphai/query",
      "@murphai/runtime-state",
      "@murphai/vault-usecases",
    ]);
    expect(hostedRunnerBuildPackageNames).toEqual([
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
        node: ">=22.16.0",
      },
      dependencies: runtimeDependencies,
    });
  });

  it("stages a self-described vault-cli artifact with its own runtime closure", () => {
    const artifactDependencies = Object.fromEntries(
      runnerVaultCliArtifactDependencyNames.map((dependencyName) => [
        dependencyName,
        "1.2.3",
      ]),
    ) as Record<(typeof runnerVaultCliArtifactDependencyNames)[number], string>;
    const artifactPackageJson = buildRunnerVaultCliArtifactPackageJson({
      dependencies: artifactDependencies,
      license: "Apache-2.0",
      version: "0.0.0",
    });

    expect(Object.keys(artifactDependencies).sort()).toEqual(
      [...runnerVaultCliArtifactDependencyNames].sort(),
    );
    expect(runnerVaultCliArtifactWorkspacePackageNames).toEqual([
      "@murphai/assistant-engine",
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
      "@murphai/operator-config",
      "@murphai/parsers",
      "@murphai/query",
      "@murphai/runtime-state",
      "@murphai/vault-usecases",
    ]);
    expect(artifactPackageJson.name).toBe(runnerVaultCliArtifactPackageName);
    expect(artifactPackageJson.exports).toEqual({
      ".": "./dist/runner-vault-cli.js",
      "./package.json": "./package.json",
    });
    expect(artifactPackageJson.bin).toEqual({
      "vault-cli": "./dist/runner-vault-cli-bin.js",
    });
    expect(artifactPackageJson.dependencies).toEqual(artifactDependencies);
  });

  it("pins whisper.cpp provisioning and default parser env in the image", async () => {
    const dockerfile = await readFile(
      new URL("../../../Dockerfile.cloudflare-hosted-runner", import.meta.url),
      "utf8",
    );

    expect(dockerfile).toContain("ARG WHISPER_CPP_VERSION=v1.8.1");
    expect(dockerfile).toContain("ARG WHISPER_MODEL_FILE=ggml-base.en.bin");
    expect(dockerfile).toContain("FROM node:22-bookworm-slim AS whisper-builder");
    expect(dockerfile).toContain(
      "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${WHISPER_CPP_VERSION}.tar.gz",
    );
    expect(dockerfile).toContain(
      "cmake --build build -j\"$(nproc)\" --config Release --target whisper-cli",
    );
    expect(dockerfile).toContain("COPY --from=whisper-builder /opt/whisper/whisper-cli /usr/local/bin/whisper-cli");
    expect(dockerfile).toContain(
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_MODEL_FILE}",
    );
    expect(dockerfile).toContain(
      "COPY --chown=runner:runner apps/cloudflare/.deploy/runner-bundle/ /app/",
    );
    expect(dockerfile).not.toContain("wrangler.generated.jsonc");
    expect(dockerfile).not.toContain("worker-secrets.json");
    expect(dockerfile).not.toContain("runner-bundle-builder");
    expect(dockerfile).not.toContain("pnpm install --frozen-lockfile");
    expect(dockerfile).toContain("PATH=/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
    expect(dockerfile).toContain("PDFTOTEXT_COMMAND=/usr/bin/pdftotext");
    expect(dockerfile).toContain("WHISPER_COMMAND=/usr/local/bin/whisper-cli");
    expect(dockerfile).toContain(
      "WHISPER_MODEL_PATH=/home/runner/.murph/models/whisper/ggml-base.en.bin",
    );
    expect(dockerfile).toContain('CMD ["node", "dist/container-entrypoint.js"]');
  });

  it("keeps only the prepared runner bundle from .deploy in Docker context", async () => {
    const dockerignore = await readFile(
      new URL("../../../.dockerignore", import.meta.url),
      "utf8",
    );

    expect(dockerignore).toContain("apps/cloudflare/.deploy");
    expect(dockerignore).toContain("!apps/cloudflare/.deploy/");
    expect(dockerignore).toContain("apps/cloudflare/.deploy/*");
    expect(dockerignore).toContain("!apps/cloudflare/.deploy/runner-bundle/");
    expect(dockerignore).toContain("!apps/cloudflare/.deploy/runner-bundle/**");
    expect(dockerignore).not.toContain("!apps/cloudflare/.deploy/wrangler.generated.jsonc");
    expect(dockerignore).not.toContain("!apps/cloudflare/.deploy/worker-secrets.json");
  });
});
