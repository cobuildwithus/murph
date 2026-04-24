import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertPreparedDeployArtifacts,
  runnerBundleManifestFileName,
  writeRunnerBundleManifest,
  type RunnerBundleManifest,
} from "../scripts/deploy-artifacts.js";
import {
  hostedRunnerRuntimePackageName,
  resolveHostedRunnerWorkspacePackageNames,
} from "../scripts/runner-bundle-contract.js";

describe("deploy artifact validation", () => {
  it("accepts a complete freshly assembled deploy artifact set", async () => {
    const fixture = await createDeployArtifactFixture();

    await expect(assertPreparedDeployArtifacts(fixture)).resolves.toBeUndefined();
  });

  it("accepts runner dependencies installed through pnpm's virtual store", async () => {
    const workspacePackageNames = [
      ...resolveHostedRunnerWorkspacePackageNames({ includeBundleOnlyDependencies: true }),
    ];
    const virtualStorePackageName = selectRunnerDependencyPackageName(workspacePackageNames);
    const fixture = await createDeployArtifactFixture({ virtualStorePackageName });

    await expect(assertPreparedDeployArtifacts(fixture)).resolves.toBeUndefined();
  });

  it("rejects a missing runner workspace dependency", async () => {
    const fixture = await createDeployArtifactFixture();
    const missingPackageName = selectRunnerDependencyPackageName(fixture.workspacePackageNames);

    await rm(
      path.join(fixture.runnerBundleDir, "node_modules", ...missingPackageName.split("/")),
      { force: true, recursive: true },
    );

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      `Missing runner dependency ${missingPackageName}.`,
    );
  });

  it("rejects a runner bundle without the assembly manifest", async () => {
    const fixture = await createDeployArtifactFixture();

    await rm(path.join(fixture.runnerBundleDir, runnerBundleManifestFileName));

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow("Missing runner bundle manifest.");
  });

  it("rejects a hosted-local runner bundle before deploy", async () => {
    const fixture = await createDeployArtifactFixture({
      includeBundleOnlyDependencies: false,
    });

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Prepared runner bundle was assembled for hosted-local use",
    );
  });

  it("rejects a runner bundle changed after manifest assembly", async () => {
    const fixture = await createDeployArtifactFixture();

    await writeFile(
      path.join(fixture.runnerBundleDir, "dist", "hosted-runner-smoke.js"),
      "export {};\n",
      "utf8",
    );

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Prepared runner bundle changed after assembly",
    );
  });

  it("rejects a generated config rendered after the runner bundle", async () => {
    const fixture = await createDeployArtifactFixture();
    const future = new Date(Date.parse(fixture.manifest.generatedAt) + 10_000);

    await utimes(fixture.configPath, future, future);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "generated Wrangler config is newer than the runner bundle",
    );
  });

  it("rejects worker secrets rendered after the runner bundle", async () => {
    const fixture = await createDeployArtifactFixture();
    const future = new Date(Date.parse(fixture.manifest.generatedAt) + 10_000);

    await utimes(fixture.secretsFilePath, future, future);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "worker secrets payload is newer than the runner bundle",
    );
  });

  it("rejects the raw Wrangler scaffold container context", async () => {
    const fixture = await createDeployArtifactFixture({
      config: {
        containers: [
          {
            class_name: "RunnerContainer",
            image: "../../Dockerfile.cloudflare-hosted-runner",
            image_build_context: ".",
          },
        ],
      },
    });

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Generated Wrangler config must use the prepared runner-bundle image context.",
    );
  });

  it("rejects stale source fingerprints", async () => {
    const fixture = await createDeployArtifactFixture();

    await writeFile(
      path.join(fixture.runnerBundleDir, runnerBundleManifestFileName),
      `${JSON.stringify({
        ...fixture.manifest,
        sourceFingerprint: "stale",
      }, null, 2)}\n`,
      "utf8",
    );

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Prepared runner bundle source fingerprint is stale",
    );
  });
});

async function createDeployArtifactFixture(input: {
  config?: Record<string, unknown>;
  includeBundleOnlyDependencies?: boolean;
  virtualStorePackageName?: string;
} = {}): Promise<{
  configPath: string;
  includeSecrets: boolean;
  manifest: RunnerBundleManifest;
  runnerBundleDir: string;
  secretsFilePath: string;
  workspacePackageNames: readonly string[];
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cloudflare-deploy-artifacts-"));
  const deployDir = path.join(root, ".deploy");
  const runnerBundleDir = path.join(deployDir, "runner-bundle");
  const configPath = path.join(deployDir, "wrangler.generated.jsonc");
  const secretsFilePath = path.join(deployDir, "worker-secrets.json");
  const workspacePackageNames = [
    ...resolveHostedRunnerWorkspacePackageNames({
      includeBundleOnlyDependencies: input.includeBundleOnlyDependencies ?? true,
    }),
  ];

  await mkdir(path.join(runnerBundleDir, "dist"), { recursive: true });
  await mkdir(path.join(runnerBundleDir, "node_modules", ".bin"), { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify(input.config ?? {
      containers: [
        {
          class_name: "RunnerContainer",
          image: "../../../Dockerfile.cloudflare-hosted-runner",
          image_build_context: "..",
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(secretsFilePath, "{}\n", "utf8");
  await writeFile(
    path.join(runnerBundleDir, "package.json"),
    `${JSON.stringify({
      dependencies: Object.fromEntries(
        workspacePackageNames
          .filter((packageName) => packageName !== hostedRunnerRuntimePackageName)
          .map((packageName) => [packageName, "1.0.0"]),
      ),
      main: "dist/index.js",
      name: hostedRunnerRuntimePackageName,
      type: "module",
      version: "1.0.0",
    }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(runnerBundleDir, "dist", "container-entrypoint.js"), "export {};\n", "utf8");
  await writeFile(path.join(runnerBundleDir, "dist", "index.js"), "export {};\n", "utf8");

  for (const packageName of workspacePackageNames) {
    if (packageName === hostedRunnerRuntimePackageName) {
      continue;
    }

    const packageParts = packageName.split("/");
    const packageDir = packageName === input.virtualStorePackageName
      ? path.join(
        runnerBundleDir,
        "node_modules",
        ".pnpm",
        "virtual-store-entry",
        "node_modules",
        ...packageParts,
      )
      : path.join(runnerBundleDir, "node_modules", ...packageParts);

    await writeWorkspacePackageManifest(packageDir, packageName);
  }

  for (const binName of ["murph", "vault-cli"]) {
    const binPath = path.join(runnerBundleDir, "node_modules", ".bin", binName);
    await writeFile(binPath, "#!/usr/bin/env node\n", "utf8");
    await chmod(binPath, 0o755);
  }

  const manifest = await writeRunnerBundleManifest(runnerBundleDir, {
    includeBundleOnlyDependencies: input.includeBundleOnlyDependencies ?? true,
  });

  return {
    configPath,
    includeSecrets: true,
    manifest,
    runnerBundleDir,
    secretsFilePath,
    workspacePackageNames,
  };
}

async function writeWorkspacePackageManifest(packageDir: string, packageName: string): Promise<void> {
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    path.join(packageDir, "package.json"),
    `${JSON.stringify({
      name: packageName,
      version: "1.0.0",
    }, null, 2)}\n`,
    "utf8",
  );
}

function selectRunnerDependencyPackageName(packageNames: readonly string[]): string {
  const packageName = packageNames.find((entry) => entry !== hostedRunnerRuntimePackageName);

  if (!packageName) {
    throw new Error("Fixture must include at least one runner dependency package.");
  }

  return packageName;
}
