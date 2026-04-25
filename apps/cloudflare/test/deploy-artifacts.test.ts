import { access, chmod, mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
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
  buildHostedWorkerSecretsPayload,
  buildHostedWranglerDeployConfig,
  readHostedDeployAutomationEnvironment,
} from "../scripts/deploy-automation.js";
import {
  hostedRunnerRuntimePackageName,
  resolveHostedRunnerWorkspacePackageNames,
} from "../scripts/runner-bundle-contract.js";

const healthCommonsPackageName = "@murphai/health-commons";
const finnishDrySaunaProtocol = {
  body: "Finnish Dry Sauna fixture body.",
  entityType: "protocol_variant",
  key: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
  relativePath: "protocols/dry-sauna/murph-finnish-standard-3x-week.md",
  revision: {
    pageRevisionId: "sha256:test-page",
    recipeHash: "sha256:test-recipe",
    runSpecRevisionId: "sha256:test-run-spec",
  },
  schemaVersion: "murph.commons.page.v1",
  slug: "protocols/dry-sauna/murph-finnish-standard-3x-week",
  title: "Finnish Dry Sauna",
} as const;

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

  it("accepts a Health Commons dependency installed through pnpm's virtual store", async () => {
    const fixture = await createDeployArtifactFixture({
      virtualStorePackageName: healthCommonsPackageName,
    });

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

  it("rejects a runner bundle with a stale Health Commons catalog", async () => {
    const fixture = await createDeployArtifactFixture();

    await writeFile(
      path.join(
        fixture.runnerBundleDir,
        "node_modules",
        "@murphai",
        "health-commons",
        "generated",
        "catalog.json",
      ),
      `${JSON.stringify({
        artifactManifests: [],
        catalogHash: "sha256:stale",
        changes: [],
        entities: [],
        redirects: [],
        schemaVersion: "murph.commons.catalog.v1",
      }, null, 2)}\n`,
      "utf8",
    );
    await writeRunnerBundleManifest(fixture.runnerBundleDir);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Runner Health Commons generated catalog is stale or missing Finnish Dry Sauna",
    );
  });

  it("rejects a runner bundle missing the Health Commons generated catalog", async () => {
    const fixture = await createDeployArtifactFixture();

    await rm(
      path.join(
        fixture.runnerBundleDir,
        "node_modules",
        "@murphai",
        "health-commons",
        "generated",
        "catalog.json",
      ),
    );

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Missing Health Commons generated catalog.",
    );
  });

  it("rejects a runner bundle with a schema-invalid Health Commons catalog", async () => {
    const fixture = await createDeployArtifactFixture();

    await writeFile(
      path.join(
        fixture.runnerBundleDir,
        "node_modules",
        "@murphai",
        "health-commons",
        "generated",
        "catalog.json",
      ),
      `${JSON.stringify({
        catalogHash: "sha256:test",
        entities: [finnishDrySaunaProtocol],
      }, null, 2)}\n`,
      "utf8",
    );
    await writeRunnerBundleManifest(fixture.runnerBundleDir);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Runner Health Commons generated catalog is invalid",
    );
  });

  it("rejects a runner bundle missing the Health Commons runtime entrypoint", async () => {
    const fixture = await createDeployArtifactFixture();

    await rm(
      path.join(
        fixture.runnerBundleDir,
        "node_modules",
        "@murphai",
        "health-commons",
        "dist",
        "runtime.js",
      ),
    );

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Missing Health Commons runtime entrypoint.",
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

  it("rejects a runner bundle assembled without rebuilding workspace artifacts", async () => {
    const fixture = await createDeployArtifactFixture({
      buildSkipped: true,
    });

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Prepared runner bundle was assembled without rebuilding workspace artifacts",
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

  it("does not execute bundled Health Commons runtime code before bundle integrity passes", async () => {
    const fixture = await createDeployArtifactFixture();
    const markerPath = path.join(fixture.runnerBundleDir, "runtime-import-marker");

    await writeFile(
      path.join(
        fixture.runnerBundleDir,
        "node_modules",
        "@murphai",
        "health-commons",
        "dist",
        "runtime.js",
      ),
      `import { writeFileSync } from "node:fs";

writeFileSync(${JSON.stringify(markerPath)}, "executed");

export function loadGeneratedHealthCommonsCatalog() {
  return {};
}
`,
      "utf8",
    );

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Prepared runner bundle changed after assembly",
    );
    await expect(access(markerPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects Health Commons package symlink escapes before executing external runtime code", async () => {
    const fixture = await createDeployArtifactFixture();
    const externalRoot = await mkdtemp(path.join(os.tmpdir(), "health-commons-symlink-escape-"));
    const externalPackageDir = path.join(externalRoot, "health-commons");
    const markerPath = path.join(fixture.runnerBundleDir, "symlink-runtime-import-marker");
    const packageDir = path.join(
      fixture.runnerBundleDir,
      "node_modules",
      "@murphai",
      "health-commons",
    );

    await rm(packageDir, { force: true, recursive: true });
    await mkdir(path.join(externalPackageDir, "dist"), { recursive: true });
    await mkdir(path.join(externalPackageDir, "generated"), { recursive: true });
    await writeFile(
      path.join(externalPackageDir, "package.json"),
      `${JSON.stringify({
        name: healthCommonsPackageName,
        version: "1.0.0",
      }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(externalPackageDir, "dist", "runtime.js"),
      `import { writeFileSync } from "node:fs";

writeFileSync(${JSON.stringify(markerPath)}, "executed");

export function loadGeneratedHealthCommonsCatalog() {
  return {};
}
`,
      "utf8",
    );
    await writeFile(
      path.join(externalPackageDir, "generated", "catalog.json"),
      `${JSON.stringify({
        artifactManifests: [],
        catalogHash: "sha256:test",
        changes: [],
        entities: [finnishDrySaunaProtocol],
        redirects: [],
        schemaVersion: "murph.commons.catalog.v1",
      }, null, 2)}\n`,
      "utf8",
    );
    await symlink(externalPackageDir, packageDir, "dir");
    await writeRunnerBundleManifest(fixture.runnerBundleDir);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      `Runner dependency ${healthCommonsPackageName} resolves outside the runner bundle.`,
    );
    await expect(access(markerPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects Health Commons runtime file symlink escapes before executing external code", async () => {
    const fixture = await createDeployArtifactFixture();
    const externalRoot = await mkdtemp(path.join(os.tmpdir(), "health-commons-runtime-escape-"));
    const externalRuntimePath = path.join(externalRoot, "runtime.js");
    const markerPath = path.join(fixture.runnerBundleDir, "runtime-symlink-import-marker");
    const runtimePath = path.join(
      fixture.runnerBundleDir,
      "node_modules",
      "@murphai",
      "health-commons",
      "dist",
      "runtime.js",
    );

    await writeFile(
      externalRuntimePath,
      `import { writeFileSync } from "node:fs";

writeFileSync(${JSON.stringify(markerPath)}, "executed");

export function loadGeneratedHealthCommonsCatalog() {
  return {};
}
`,
      "utf8",
    );
    await rm(runtimePath);
    await symlink(externalRuntimePath, runtimePath);
    await writeRunnerBundleManifest(fixture.runnerBundleDir);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Health Commons runtime entrypoint must not be a symlink.",
    );
    await expect(access(markerPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects Health Commons catalog file symlink escapes", async () => {
    const fixture = await createDeployArtifactFixture();
    const externalRoot = await mkdtemp(path.join(os.tmpdir(), "health-commons-catalog-escape-"));
    const externalCatalogPath = path.join(externalRoot, "catalog.json");
    const catalogPath = path.join(
      fixture.runnerBundleDir,
      "node_modules",
      "@murphai",
      "health-commons",
      "generated",
      "catalog.json",
    );

    await writeFile(
      externalCatalogPath,
      `${JSON.stringify({
        artifactManifests: [],
        catalogHash: "sha256:test",
        changes: [],
        entities: [finnishDrySaunaProtocol],
        redirects: [],
        schemaVersion: "murph.commons.catalog.v1",
      }, null, 2)}\n`,
      "utf8",
    );
    await rm(catalogPath);
    await symlink(externalCatalogPath, catalogPath);
    await writeRunnerBundleManifest(fixture.runnerBundleDir);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Health Commons generated catalog must not be a symlink.",
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

  it("rejects a generated config that does not match the current deploy environment", async () => {
    const fixture = await createDeployArtifactFixture();
    const staleConfig = buildHostedWranglerDeployConfig(
      readHostedDeployAutomationEnvironment({
        ...fixture.source,
        CF_CONTAINER_MAX_INSTANCES: "99",
      }),
    );

    await writeFile(fixture.configPath, `${JSON.stringify(staleConfig, null, 2)}\n`, "utf8");

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Generated Wrangler config does not match the current deploy environment",
    );
  });

  it("rejects worker secrets that do not match the current deploy environment", async () => {
    const fixture = await createDeployArtifactFixture();
    const staleSecrets = buildHostedWorkerSecretsPayload({
      ...fixture.source,
      HOSTED_WAKE_ENCRYPTION_KEY: "stale-wake-key",
    });

    await writeFile(fixture.secretsFilePath, `${JSON.stringify(staleSecrets, null, 2)}\n`, "utf8");

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Worker secrets payload does not match the current deploy environment",
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
  buildSkipped?: boolean;
  config?: Record<string, unknown>;
  includeBundleOnlyDependencies?: boolean;
  virtualStorePackageName?: string;
} = {}): Promise<{
  configPath: string;
  includeSecrets: boolean;
  manifest: RunnerBundleManifest;
  runnerBundleDir: string;
  secretsFilePath: string;
  source: Record<string, string>;
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
  const source = createDeployArtifactFixtureSource();
  const defaultConfig = buildHostedWranglerDeployConfig(
    readHostedDeployAutomationEnvironment(source),
  );

  await mkdir(path.join(runnerBundleDir, "dist"), { recursive: true });
  await mkdir(path.join(runnerBundleDir, "node_modules", ".bin"), { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify(input.config ?? defaultConfig, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    secretsFilePath,
    `${JSON.stringify(buildHostedWorkerSecretsPayload(source), null, 2)}\n`,
    "utf8",
  );
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
    buildSkipped: input.buildSkipped === true,
    includeBundleOnlyDependencies: input.includeBundleOnlyDependencies ?? true,
  });

  return {
    configPath,
    includeSecrets: true,
    manifest,
    runnerBundleDir,
    secretsFilePath,
    source,
    workspacePackageNames,
  };
}

function createDeployArtifactFixtureSource(): Record<string, string> {
  return {
    CF_BUNDLES_BUCKET: "hosted-bundles",
    CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
    CF_WORKER_NAME: "hosted-worker",
    HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK: "{\"kty\":\"EC\"}",
    HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK: "{\"kty\":\"EC\"}",
    HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "platform-key",
    HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK: "{\"kty\":\"EC\"}",
    HOSTED_WAKE_ENCRYPTION_KEY: "wake-key",
    HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "{\"kty\":\"EC\"}",
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

  if (packageName === healthCommonsPackageName) {
    await mkdir(path.join(packageDir, "dist"), { recursive: true });
    await mkdir(path.join(packageDir, "generated"), { recursive: true });
    await writeFile(
      path.join(packageDir, "dist", "runtime.js"),
      `import { readFileSync } from "node:fs";

export function loadGeneratedHealthCommonsCatalog(options = {}) {
  const catalog = JSON.parse(readFileSync(options.catalogPath, "utf8"));

  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new Error("Invalid Health Commons catalog.");
  }

  if (
    catalog.schemaVersion !== "murph.commons.catalog.v1" ||
    typeof catalog.catalogHash !== "string" ||
    !catalog.catalogHash.startsWith("sha256:") ||
    !Array.isArray(catalog.entities) ||
    !Array.isArray(catalog.redirects) ||
    !Array.isArray(catalog.changes) ||
    !Array.isArray(catalog.artifactManifests)
  ) {
    throw new Error("Invalid Health Commons catalog.");
  }

  for (const entity of catalog.entities) {
    if (
      !entity ||
      typeof entity !== "object" ||
      typeof entity.body !== "string" ||
      typeof entity.relativePath !== "string" ||
      !entity.revision ||
      typeof entity.revision !== "object"
    ) {
      throw new Error("Invalid Health Commons catalog entity.");
    }
  }

  return catalog;
}
`,
      "utf8",
    );
    await writeFile(
      path.join(packageDir, "generated", "catalog.json"),
      `${JSON.stringify({
        artifactManifests: [],
        catalogHash: "sha256:test",
        changes: [],
        entities: [finnishDrySaunaProtocol],
        redirects: [],
        schemaVersion: "murph.commons.catalog.v1",
      }, null, 2)}\n`,
      "utf8",
    );
  }
}

function selectRunnerDependencyPackageName(packageNames: readonly string[]): string {
  const packageName = packageNames.find((entry) => entry !== hostedRunnerRuntimePackageName);

  if (!packageName) {
    throw new Error("Fixture must include at least one runner dependency package.");
  }

  return packageName;
}
