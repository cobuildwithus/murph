import { access, chmod, mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertPreparedDeployArtifacts,
  assertPreparedRunnerBundle,
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
  resolveHostedRunnerBuildPackageNames,
  resolveHostedRunnerWorkspacePackageNames,
} from "../scripts/runner-bundle-contract.js";

const healthCommonsPackageName = "@murphai/health-commons";
const finnishDrySaunaProtocol = {
  attribution: {
    ownerType: "murph",
  },
  body: "Finnish Dry Sauna fixture body.",
  entityType: "protocol_variant",
  key: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
  lineage: {
    relationship: "root",
  },
  protocol: {
    doseSignature: "3 sessions weekly",
  },
  relativePath: "protocols/dry-sauna/murph-finnish-standard-3x-week.md",
  revision: {
    pageRevisionId: "sha256:test-page",
    recipeHash: "sha256:test-recipe",
    runSpecRevisionId: "sha256:test-run-spec",
  },
  schemaVersion: "murph.commons.page.v1",
  safety: {
    cautionLevel: "moderate",
  },
  slug: "protocols/dry-sauna/murph-finnish-standard-3x-week",
  testPlans: [
    {
      baselineDays: 7,
      durationDays: 28,
      interventionDays: 21,
      planId: "dry-sauna-fixture",
      primaryBiomarkerKey: "biomarker:resting_pulse",
    },
  ],
  title: "Finnish Dry Sauna",
} as const;
const drySaunaFamily = {
  aliases: ["sauna"],
  categories: ["recovery", "passive-heat"],
  entityType: "experiment_family",
  key: "experiment_family:dry-sauna",
  relativePath: "families/dry-sauna.md",
  revision: {
    pageRevisionId: "sha256:test-family-page",
    recipeHash: null,
    runSpecRevisionId: null,
  },
  routeId: "dry-sauna",
  routeIds: ["dry-sauna", "families/dry-sauna"],
  slug: "families/dry-sauna",
  status: "field-testing",
  summary: "Dry sauna family.",
  title: "Dry Sauna",
} as const;
const finnishDrySaunaProtocolSummary = {
  aliases: ["finnish sauna"],
  categories: ["recovery", "passive-heat", "murph-canonical"],
  entityType: "protocol_variant",
  key: finnishDrySaunaProtocol.key,
  relativePath: finnishDrySaunaProtocol.relativePath,
  revision: finnishDrySaunaProtocol.revision,
  routeId: "finnish-sauna",
  routeIds: [
    "finnish-sauna",
    finnishDrySaunaProtocol.slug,
    "dry-sauna/murph-finnish-standard-3x-week",
  ],
  searchText: "Finnish Dry Sauna RPE heat exposure",
  slug: finnishDrySaunaProtocol.slug,
  status: "field-testing",
  summary: "Finnish Dry Sauna summary.",
  title: finnishDrySaunaProtocol.title,
  traits: {
    cautionLevel: finnishDrySaunaProtocol.safety.cautionLevel,
    externalProtocol: false,
    highCaution: false,
    murphCanonical: true,
    sourceAttributed: false,
  },
} as const;
const extraProtocolSummary = {
  ...finnishDrySaunaProtocolSummary,
  key: "protocol_variant:extra/extra-protocol",
  relativePath: "protocols/extra/extra-protocol.md",
  routeId: "extra-protocol",
  routeIds: ["extra-protocol", "protocols/extra/extra-protocol"],
  slug: "protocols/extra/extra-protocol",
  title: "Extra Protocol",
} as const;
const requiredHostedCryptoWorkerVars = {
  HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION:
    "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1",
  HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
    "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",
  HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cloudflare-automation:v1",
  HOSTED_CRYPTO_ENV: "production",
  HOSTED_R2_PRESIGN_ACCOUNT_ID: "r2-account-test",
  HOSTED_R2_PRESIGN_BUCKET_NAME: "hosted-bundles",
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

  it("ignores generated dist bin entries when checking source fingerprints", async () => {
    const distBinPackageName = "@murphai/device-syncd";
    const sourceFixture = await createDeployArtifactSourceFixture({
      distBinPackageName,
    });
    const fixture = await createDeployArtifactFixture(sourceFixture);
    const distBinPackageDir = sourceFixture.packageDirs.get(distBinPackageName);

    if (!distBinPackageDir) {
      throw new Error(`Missing source fixture package ${distBinPackageName}.`);
    }

    const distBinPath = path.join(distBinPackageDir, "dist", "bin.js");

    await mkdir(path.dirname(distBinPath), { recursive: true });
    await writeFile(distBinPath, "console.log('generated');\n", "utf8");

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

  it("rejects a runner bundle with a stale Health Commons protocol index", async () => {
    const fixture = await createDeployArtifactFixture();
    const generatedDir = path.join(
      fixture.runnerBundleDir,
      "node_modules",
      "@murphai",
      "health-commons",
      "generated",
    );

    await writeHealthCommonsRuntimeArtifacts(generatedDir, {
      familyGraph: {
        catalogHash: "sha256:test",
        edges: [],
        families: [],
        protocols: [extraProtocolSummary],
        schemaVersion: "murph.commons.protocol-family-graph.v1",
      },
      protocolIndex: {
        catalogHash: "sha256:test",
        protocols: [extraProtocolSummary],
        schemaVersion: "murph.commons.protocol-index.v1",
      },
      protocolRunSpecs: {
        catalogHash: "sha256:test",
        protocols: [
          {
            ...extraProtocolSummary,
            expectedSignalDescriptions: [],
            experimentOnboarding: null,
            protocol: finnishDrySaunaProtocol.protocol,
            safety: finnishDrySaunaProtocol.safety,
            testPlans: finnishDrySaunaProtocol.testPlans,
            whyItWorks: [],
          },
        ],
        schemaVersion: "murph.commons.protocol-run-specs.v1",
      },
    });
    await rewriteRunnerBundleManifest(fixture);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Runner Health Commons protocol index is stale or missing Finnish Dry Sauna",
    );
  });

  it("rejects a runner bundle with stale Health Commons protocol run specs", async () => {
    const fixture = await createDeployArtifactFixture();

    await writeFile(
      path.join(
        fixture.runnerBundleDir,
        "node_modules",
        "@murphai",
        "health-commons",
        "generated",
        "protocol-run-specs.json",
      ),
      `${JSON.stringify({
        catalogHash: "sha256:test",
        protocols: [
          {
            ...finnishDrySaunaProtocolSummary,
            expectedSignalDescriptions: [],
            experimentOnboarding: null,
            protocol: null,
            safety: finnishDrySaunaProtocol.safety,
            testPlans: finnishDrySaunaProtocol.testPlans,
            whyItWorks: [],
          },
        ],
        schemaVersion: "murph.commons.protocol-run-specs.v1",
      }, null, 2)}\n`,
      "utf8",
    );
    await rewriteRunnerBundleManifest(fixture);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Runner Health Commons protocol run specs are stale or missing Finnish Dry Sauna",
    );
  });

  it("rejects a runner bundle missing a Health Commons runtime generated artifact", async () => {
    const fixture = await createDeployArtifactFixture();

    await rm(
      path.join(
        fixture.runnerBundleDir,
        "node_modules",
        "@murphai",
        "health-commons",
        "generated",
        "protocol-run-specs.json",
      ),
    );

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Missing Health Commons protocol run specs.",
    );
  });

  it("rejects a runner bundle missing the Health Commons knowledge index", async () => {
    const fixture = await createDeployArtifactFixture();

    await rm(
      path.join(
        fixture.runnerBundleDir,
        "node_modules",
        "@murphai",
        "health-commons",
        "generated",
        "knowledge.sqlite",
      ),
    );

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Missing Health Commons knowledge index.",
    );
  });

  it("rejects a runner bundle with a stale Health Commons protocol family graph", async () => {
    const fixture = await createDeployArtifactFixture();

    await writeFile(
      path.join(
        fixture.runnerBundleDir,
        "node_modules",
        "@murphai",
        "health-commons",
        "generated",
        "protocol-family-graph.json",
      ),
      `${JSON.stringify({
        catalogHash: "sha256:test",
        edges: [],
        families: [drySaunaFamily],
        protocols: [finnishDrySaunaProtocolSummary],
        schemaVersion: "murph.commons.protocol-family-graph.v1",
      }, null, 2)}\n`,
      "utf8",
    );
    await rewriteRunnerBundleManifest(fixture);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Runner Health Commons protocol family graph is stale or missing Finnish Dry Sauna",
    );
  });

  it("rejects a runner bundle with an invalid Health Commons compact artifact schema", async () => {
    const fixture = await createDeployArtifactFixture();

    await writeFile(
      path.join(
        fixture.runnerBundleDir,
        "node_modules",
        "@murphai",
        "health-commons",
        "generated",
        "protocol-index.json",
      ),
      `${JSON.stringify({
        ...createHealthCommonsRuntimeArtifacts().protocolIndex,
        schemaVersion: "murph.commons.protocol-index.v0",
      }, null, 2)}\n`,
      "utf8",
    );
    await rewriteRunnerBundleManifest(fixture);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Runner Health Commons protocol index is invalid.",
    );
  });

  it("rejects a runner bundle with invalid Health Commons biomarker desired directions", async () => {
    const fixture = await createDeployArtifactFixture();

    await writeFile(
      path.join(
        fixture.runnerBundleDir,
        "node_modules",
        "@murphai",
        "health-commons",
        "generated",
        "biomarker-desired-directions.json",
      ),
      `${JSON.stringify({
        ...createHealthCommonsRuntimeArtifacts().biomarkerDesiredDirections,
        biomarkers: [{
          desiredDirection: "sideways",
          key: "biomarker:resting-heart-rate",
        }],
      }, null, 2)}\n`,
      "utf8",
    );
    await rewriteRunnerBundleManifest(fixture);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Runner Health Commons biomarker desired directions are invalid.",
    );
  });

  it("rejects a runner bundle with mismatched Health Commons compact artifact hashes", async () => {
    const fixture = await createDeployArtifactFixture();

    await writeFile(
      path.join(
        fixture.runnerBundleDir,
        "node_modules",
        "@murphai",
        "health-commons",
        "generated",
        "protocol-run-specs.json",
      ),
      `${JSON.stringify({
        ...createHealthCommonsRuntimeArtifacts().protocolRunSpecs,
        catalogHash: "sha256:other",
      }, null, 2)}\n`,
      "utf8",
    );
    await rewriteRunnerBundleManifest(fixture);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Runner Health Commons runtime artifacts have mismatched catalog hashes",
    );
  });

  it("rejects a runner bundle with a mismatched Health Commons biomarker direction catalog hash", async () => {
    const fixture = await createDeployArtifactFixture();

    await writeFile(
      path.join(
        fixture.runnerBundleDir,
        "node_modules",
        "@murphai",
        "health-commons",
        "generated",
        "biomarker-desired-directions.json",
      ),
      `${JSON.stringify({
        ...createHealthCommonsRuntimeArtifacts().biomarkerDesiredDirections,
        catalogHash: "sha256:other",
      }, null, 2)}\n`,
      "utf8",
    );
    await rewriteRunnerBundleManifest(fixture);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Runner Health Commons runtime artifacts have mismatched catalog hashes",
    );
  });

  it("rejects a runner bundle with inconsistent Health Commons compact protocol keys", async () => {
    const fixture = await createDeployArtifactFixture();

    await writeFile(
      path.join(
        fixture.runnerBundleDir,
        "node_modules",
        "@murphai",
        "health-commons",
        "generated",
        "protocol-index.json",
      ),
      `${JSON.stringify({
        ...createHealthCommonsRuntimeArtifacts().protocolIndex,
        protocols: [finnishDrySaunaProtocolSummary, extraProtocolSummary],
      }, null, 2)}\n`,
      "utf8",
    );
    await rewriteRunnerBundleManifest(fixture);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Runner Health Commons compact protocol artifacts disagree on protocol keys",
    );
  });

  it("rejects a runner bundle with mismatched Health Commons compact protocol summaries", async () => {
    const fixture = await createDeployArtifactFixture();

    await writeFile(
      path.join(
        fixture.runnerBundleDir,
        "node_modules",
        "@murphai",
        "health-commons",
        "generated",
        "protocol-run-specs.json",
      ),
      `${JSON.stringify({
        ...createHealthCommonsRuntimeArtifacts().protocolRunSpecs,
        protocols: [
          {
            ...finnishDrySaunaProtocolSummary,
            expectedSignalDescriptions: [],
            experimentOnboarding: null,
            protocol: finnishDrySaunaProtocol.protocol,
            routeId: "stale-finnish-sauna",
            routeIds: ["stale-finnish-sauna"],
            safety: finnishDrySaunaProtocol.safety,
            testPlans: finnishDrySaunaProtocol.testPlans,
            whyItWorks: [],
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );
    await rewriteRunnerBundleManifest(fixture);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Runner Health Commons compact protocol artifacts disagree on shared protocol summaries",
    );
  });

  it("rejects a runner bundle with missing Health Commons protocol index search text", async () => {
    const fixture = await createDeployArtifactFixture();
    const protocolWithoutSearchText: Record<string, unknown> = {
      ...finnishDrySaunaProtocolSummary,
    };
    delete protocolWithoutSearchText.searchText;

    await writeFile(
      path.join(
        fixture.runnerBundleDir,
        "node_modules",
        "@murphai",
        "health-commons",
        "generated",
        "protocol-index.json",
      ),
      `${JSON.stringify({
        ...createHealthCommonsRuntimeArtifacts().protocolIndex,
        protocols: [protocolWithoutSearchText],
      }, null, 2)}\n`,
      "utf8",
    );
    await rewriteRunnerBundleManifest(fixture);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Runner Health Commons protocol index entry is invalid.",
    );
  });

  it("rejects a runner bundle with unusable Health Commons route ids", async () => {
    const fixture = await createDeployArtifactFixture();

    await writeFile(
      path.join(
        fixture.runnerBundleDir,
        "node_modules",
        "@murphai",
        "health-commons",
        "generated",
        "protocol-index.json",
      ),
      `${JSON.stringify({
        ...createHealthCommonsRuntimeArtifacts().protocolIndex,
        protocols: [
          {
            ...finnishDrySaunaProtocolSummary,
            routeIds: [],
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );
    await rewriteRunnerBundleManifest(fixture);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Runner Health Commons protocol index entry is invalid.",
    );
  });

  it("rejects a runner bundle with duplicate Health Commons compact protocol keys", async () => {
    const fixture = await createDeployArtifactFixture();

    await writeFile(
      path.join(
        fixture.runnerBundleDir,
        "node_modules",
        "@murphai",
        "health-commons",
        "generated",
        "protocol-index.json",
      ),
      `${JSON.stringify({
        ...createHealthCommonsRuntimeArtifacts().protocolIndex,
        protocols: [
          finnishDrySaunaProtocolSummary,
          finnishDrySaunaProtocolSummary,
        ],
      }, null, 2)}\n`,
      "utf8",
    );
    await rewriteRunnerBundleManifest(fixture);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Runner Health Commons protocol index protocols include duplicate key",
    );
  });

  it("rejects a runner bundle with dangling Health Commons protocol family graph edges", async () => {
    const fixture = await createDeployArtifactFixture();

    await writeFile(
      path.join(
        fixture.runnerBundleDir,
        "node_modules",
        "@murphai",
        "health-commons",
        "generated",
        "protocol-family-graph.json",
      ),
      `${JSON.stringify({
        ...createHealthCommonsRuntimeArtifacts().familyGraph,
        edges: [
          {
            sourceKey: finnishDrySaunaProtocol.key,
            targetKey: "experiment_family:missing-family",
            type: "parent_family",
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );
    await rewriteRunnerBundleManifest(fixture);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Runner Health Commons protocol family graph is invalid.",
    );
  });

  it("rejects a runner bundle with invalid Health Commons protocol family graph edge direction", async () => {
    const fixture = await createDeployArtifactFixture();

    await writeFile(
      path.join(
        fixture.runnerBundleDir,
        "node_modules",
        "@murphai",
        "health-commons",
        "generated",
        "protocol-family-graph.json",
      ),
      `${JSON.stringify({
        ...createHealthCommonsRuntimeArtifacts().familyGraph,
        edges: [
          {
            sourceKey: drySaunaFamily.key,
            targetKey: finnishDrySaunaProtocol.key,
            type: "parent_family",
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );
    await rewriteRunnerBundleManifest(fixture);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Runner Health Commons protocol family graph is invalid.",
    );
  });

  it("rejects a runner bundle that still ships the obsolete Health Commons runtime catalog", async () => {
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
      `${JSON.stringify({ schemaVersion: "murph.commons.catalog.v1" }, null, 2)}\n`,
      "utf8",
    );
    await rewriteRunnerBundleManifest(fixture);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Runner dependency @murphai/health-commons must not ship obsolete Health Commons runtime catalog.",
    );
  });

  it.each([
    ["entities.ndjson", "Health Commons runtime entities index", "stale entities\n"],
    ["web", "Health Commons generated web artifacts", null],
  ] as const)(
    "rejects a runner bundle that still ships obsolete Health Commons %s",
    async (artifactName, label, contents) => {
      const fixture = await createDeployArtifactFixture();
      const artifactPath = path.join(
        fixture.runnerBundleDir,
        "node_modules",
        "@murphai",
        "health-commons",
        "generated",
        artifactName,
      );

      if (contents === null) {
        await mkdir(artifactPath, { recursive: true });
      } else {
        await writeFile(artifactPath, contents, "utf8");
      }
      await rewriteRunnerBundleManifest(fixture);

      await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
        `Runner dependency @murphai/health-commons must not ship obsolete ${label}.`,
      );
    },
  );

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

export function getGeneratedHealthCommonsProtocolIndexReader() {
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

  it("validates Health Commons compact protocol artifacts without executing bundled runtime code", async () => {
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

export function getGeneratedHealthCommonsProtocolIndexReader() {
  return {};
}
`,
      "utf8",
    );
    const refreshedManifest = await rewriteRunnerBundleManifest(fixture);
    await writeFile(
      fixture.configPath,
      `${JSON.stringify(buildHostedWranglerDeployConfig(
        readHostedDeployAutomationEnvironment(fixture.source),
        { runnerBundleManifest: refreshedManifest },
      ), null, 2)}\n`,
      "utf8",
    );

    await expect(assertPreparedDeployArtifacts(fixture)).resolves.toBeUndefined();
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

export function getGeneratedHealthCommonsProtocolIndexReader() {
  return {};
}
`,
      "utf8",
    );
    await writeHealthCommonsRuntimeArtifacts(path.join(externalPackageDir, "generated"));
    await symlink(externalPackageDir, packageDir, "dir");
    await rewriteRunnerBundleManifest(fixture);

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

export function getGeneratedHealthCommonsProtocolIndexReader() {
  return {};
}
`,
      "utf8",
    );
    await rm(runtimePath);
    await symlink(externalRuntimePath, runtimePath);
    await rewriteRunnerBundleManifest(fixture);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Health Commons runtime entrypoint must not be a symlink.",
    );
    await expect(access(markerPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects Health Commons compact artifact file symlink escapes", async () => {
    const fixture = await createDeployArtifactFixture();
    const externalRoot = await mkdtemp(path.join(os.tmpdir(), "health-commons-protocol-index-escape-"));
    const externalArtifactPath = path.join(externalRoot, "protocol-index.json");
    const artifactPath = path.join(
      fixture.runnerBundleDir,
      "node_modules",
      "@murphai",
      "health-commons",
      "generated",
      "protocol-index.json",
    );

    await writeFile(
      externalArtifactPath,
      `${JSON.stringify(createHealthCommonsRuntimeArtifacts().protocolIndex, null, 2)}\n`,
      "utf8",
    );
    await rm(artifactPath);
    await symlink(externalArtifactPath, artifactPath);
    await rewriteRunnerBundleManifest(fixture);

    await expect(assertPreparedDeployArtifacts(fixture)).rejects.toThrow(
      "Health Commons protocol index must not be a symlink.",
    );
  });

  it("accepts a generated config rendered after the runner bundle", async () => {
    const fixture = await createDeployArtifactFixture();
    const future = new Date(Date.parse(fixture.manifest.generatedAt) + 10_000);

    await utimes(fixture.configPath, future, future);

    await expect(assertPreparedDeployArtifacts(fixture)).resolves.toBeUndefined();
  });

  it("accepts a downloaded runner bundle after refreshing its manifest", async () => {
    const fixture = await createDeployArtifactFixture();
    const future = new Date(Date.parse(fixture.manifest.generatedAt) + 10_000);
    const manifestInput: Parameters<typeof writeRunnerBundleManifest>[1] = {
      now: () => new Date(future.getTime() + 1_000),
    };

    if (fixture.appDir) {
      manifestInput.appDir = fixture.appDir;
    }

    if (fixture.repoRoot) {
      manifestInput.repoRoot = fixture.repoRoot;
    }

    await utimes(fixture.configPath, future, future);
    await writeRunnerBundleManifest(fixture.runnerBundleDir, manifestInput);

    await expect(assertPreparedDeployArtifacts(fixture)).resolves.toBeUndefined();
  });

  it("rejects a downloaded runner bundle with a stale source fingerprint before manifest refresh", async () => {
    const fixture = await createDeployArtifactFixture();

    await writeFile(
      path.join(fixture.runnerBundleDir, runnerBundleManifestFileName),
      `${JSON.stringify({
        ...fixture.manifest,
        sourceFingerprint: "stale",
      }, null, 2)}\n`,
      "utf8",
    );

    await expect(assertPreparedRunnerBundle(fixture)).rejects.toThrow(
      "Prepared runner bundle source fingerprint is stale",
    );
  });

  it("ignores generated package outputs when checking the source fingerprint", async () => {
    const sourceFixture = await createDeployArtifactSourceFixture({
      generatedFilesPackageName: healthCommonsPackageName,
    });
    const fixture = await createDeployArtifactFixture({
      appDir: sourceFixture.appDir,
      repoRoot: sourceFixture.repoRoot,
    });
    const packageDir = sourceFixture.packageDirs.get(healthCommonsPackageName);

    if (!packageDir) {
      throw new Error("Missing Health Commons source fixture.");
    }

    await mkdir(path.join(packageDir, "generated"), { recursive: true });
    await writeFile(
      path.join(packageDir, "generated", "protocol-index.json"),
      "{\"generated\":true}\n",
      "utf8",
    );

    await expect(assertPreparedRunnerBundle(fixture)).resolves.toMatchObject({
      sourceFingerprint: fixture.manifest.sourceFingerprint,
    });
  });

  it("accepts worker secrets rendered after the runner bundle", async () => {
    const fixture = await createDeployArtifactFixture();
    const future = new Date(Date.parse(fixture.manifest.generatedAt) + 10_000);

    await utimes(fixture.secretsFilePath, future, future);

    await expect(assertPreparedDeployArtifacts(fixture)).resolves.toBeUndefined();
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
          {
            class_name: "DeploySmokeRunnerContainer",
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
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "stale-automation-key",
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
  appDir?: string;
  buildSkipped?: boolean;
  config?: Record<string, unknown>;
  includeBundleOnlyDependencies?: boolean;
  repoRoot?: string;
  virtualStorePackageName?: string;
} = {}): Promise<{
  appDir?: string;
  configPath: string;
  includeSecrets: boolean;
  manifest: RunnerBundleManifest;
  repoRoot?: string;
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
  const sourceFixture = input.appDir && input.repoRoot
    ? null
    : await createDeployArtifactSourceFixture();
  const appDir = input.appDir ?? sourceFixture?.appDir;
  const repoRoot = input.repoRoot ?? sourceFixture?.repoRoot;
  const workspacePackageNames = [
    ...resolveHostedRunnerWorkspacePackageNames({
      includeBundleOnlyDependencies: input.includeBundleOnlyDependencies ?? true,
    }),
  ];
  const source = createDeployArtifactFixtureSource();
  await mkdir(path.join(runnerBundleDir, "dist"), { recursive: true });
  await mkdir(path.join(runnerBundleDir, "node_modules", ".bin"), { recursive: true });
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
  await mkdir(path.join(runnerBundleDir, "dist-bundled"), { recursive: true });
  await writeFile(path.join(runnerBundleDir, "dist-bundled", "container-entrypoint.js"), "export {};\n", "utf8");
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

  // Dockerfile ENV pin targets asserted by the bundle shape check.
  const assistantEngineDir = path.join(
    runnerBundleDir,
    "node_modules",
    "@murphai",
    "assistant-engine",
  );
  await mkdir(path.join(assistantEngineDir, "skills"), { recursive: true });
  await mkdir(path.join(assistantEngineDir, "dist", "assistant"), { recursive: true });
  await writeFile(
    path.join(assistantEngineDir, "dist", "assistant", "cli-surface-contract.generated.json"),
    "{}\n",
    "utf8",
  );

  const manifestInput: Parameters<typeof writeRunnerBundleManifest>[1] = {
    buildSkipped: input.buildSkipped === true,
    includeBundleOnlyDependencies: input.includeBundleOnlyDependencies ?? true,
  };

  if (input.appDir) {
    manifestInput.appDir = input.appDir;
  }

  if (input.repoRoot) {
    manifestInput.repoRoot = input.repoRoot;
  }

  if (!input.appDir && appDir) {
    manifestInput.appDir = appDir;
  }

  if (!input.repoRoot && repoRoot) {
    manifestInput.repoRoot = repoRoot;
  }

  const manifest = await writeRunnerBundleManifest(runnerBundleDir, manifestInput);
  const defaultConfig = buildHostedWranglerDeployConfig(
    readHostedDeployAutomationEnvironment(source),
    { runnerBundleManifest: manifest },
  );
  await writeFile(
    configPath,
    `${JSON.stringify(input.config ?? defaultConfig, null, 2)}\n`,
    "utf8",
  );

  return {
    ...(appDir ? { appDir } : {}),
    configPath,
    includeSecrets: true,
    manifest,
    ...(repoRoot ? { repoRoot } : {}),
    runnerBundleDir,
    secretsFilePath,
    source,
    workspacePackageNames,
  };
}

async function rewriteRunnerBundleManifest(fixture: {
  appDir?: string;
  repoRoot?: string;
  runnerBundleDir: string;
}): Promise<RunnerBundleManifest> {
  const input: Parameters<typeof writeRunnerBundleManifest>[1] = {};

  if (fixture.appDir) {
    input.appDir = fixture.appDir;
  }

  if (fixture.repoRoot) {
    input.repoRoot = fixture.repoRoot;
  }

  return await writeRunnerBundleManifest(fixture.runnerBundleDir, input);
}

async function createDeployArtifactSourceFixture(input: {
  distBinPackageName?: string;
  generatedFilesPackageName?: string;
} = {}): Promise<{
  appDir: string;
  packageDirs: Map<string, string>;
  repoRoot: string;
}> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cloudflare-deploy-source-"));
  const appDir = path.join(repoRoot, "apps", "cloudflare");
  const packageDirs = new Map<string, string>();
  const packageNames = new Set([
    hostedRunnerRuntimePackageName,
    ...resolveHostedRunnerBuildPackageNames({ includeBundleOnlyDependencies: true }),
  ]);

  await mkdir(path.join(appDir, "scripts"), { recursive: true });
  await mkdir(path.join(repoRoot, "packages"), { recursive: true });
  await writeFile(path.join(repoRoot, "package.json"), "{}\n", "utf8");
  await writeFile(path.join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
  await writeFile(path.join(repoRoot, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
  await writeFile(path.join(repoRoot, "tsconfig.json"), "{}\n", "utf8");
  await writeFile(path.join(repoRoot, "tsconfig.base.json"), "{}\n", "utf8");
  await writeFile(path.join(repoRoot, "Dockerfile.cloudflare-hosted-runner"), "\n", "utf8");
  await writeFile(path.join(repoRoot, "Dockerfile.cloudflare-hosted-runner-base"), "\n", "utf8");
  await writeFile(path.join(appDir, ".dockerignore"), "\n", "utf8");
  await writeFile(path.join(appDir, "scripts", "placeholder.ts"), "export {};\n", "utf8");

  for (const packageName of packageNames) {
    const packageDir = packageName === hostedRunnerRuntimePackageName
      ? appDir
      : path.join(repoRoot, "packages", packageName.split("/").at(-1) ?? packageName);
    const packageJson = {
      name: packageName,
      version: "1.0.0",
      ...(packageName === input.generatedFilesPackageName
        ? { files: ["src", "generated"] }
        : {}),
      ...(packageName === input.distBinPackageName
        ? { bin: { "dist-bin-fixture": "./dist/bin.js" } }
        : {}),
    };

    await mkdir(path.join(packageDir, "src"), { recursive: true });
    await writeFile(
      path.join(packageDir, "package.json"),
      `${JSON.stringify(packageJson, null, 2)}\n`,
      "utf8",
    );
    await writeFile(path.join(packageDir, "src", "index.ts"), "export {};\n", "utf8");
    packageDirs.set(packageName, packageDir);
  }

  return {
    appDir,
    packageDirs,
    repoRoot,
  };
}

function createDeployArtifactFixtureSource(): Record<string, string> {
  return {
    CF_BUNDLES_BUCKET: "hosted-bundles",
    CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
    CF_PUBLIC_BASE_URL: "https://hosted-worker.example.test",
    CF_WORKER_NAME: "hosted-worker",
    HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET: "images-signing-fixture",
    ...requiredHostedCryptoWorkerVars,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "{\"kty\":\"EC\"}",
    HOSTED_LOG_FINGERPRINT_SECRET: "log-fingerprint-secret",
    HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
      "provider-egress-signing-secret",
    HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "r2-access-fixture",
    HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "r2-signing-fixture",
    HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "{\"kty\":\"EC\"}",
    MURPH_DATA_API_KEY: "data-api-key",
    OPENAI_API_KEY: "openai-key",
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
      "export {};\n",
      "utf8",
    );
    await writeHealthCommonsRuntimeArtifacts(path.join(packageDir, "generated"));
  }
}

async function writeHealthCommonsRuntimeArtifacts(
  generatedDir: string,
  input: {
    biomarkerDesiredDirections?: Record<string, unknown>;
    familyGraph?: Record<string, unknown>;
    protocolIndex?: Record<string, unknown>;
    protocolRunSpecs?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const artifacts = createHealthCommonsRuntimeArtifacts(input);

  await mkdir(generatedDir, { recursive: true });
  await writeFile(
    path.join(generatedDir, "knowledge.sqlite"),
    Buffer.from("SQLite format 3\0fixture"),
  );
  await writeFile(
    path.join(generatedDir, "biomarker-desired-directions.json"),
    `${JSON.stringify(artifacts.biomarkerDesiredDirections, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(generatedDir, "protocol-index.json"),
    `${JSON.stringify(artifacts.protocolIndex, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(generatedDir, "protocol-run-specs.json"),
    `${JSON.stringify(artifacts.protocolRunSpecs, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(generatedDir, "protocol-family-graph.json"),
    `${JSON.stringify(artifacts.familyGraph, null, 2)}\n`,
    "utf8",
  );
}

function createHealthCommonsRuntimeArtifacts(input: {
  biomarkerDesiredDirections?: Record<string, unknown>;
  familyGraph?: Record<string, unknown>;
  protocolIndex?: Record<string, unknown>;
  protocolRunSpecs?: Record<string, unknown>;
} = {}) {
  const biomarkerDesiredDirections = input.biomarkerDesiredDirections ?? {
    biomarkers: [{
      desiredDirection: "lower_or_stable",
      key: "biomarker:resting-heart-rate",
    }],
    catalogHash: "sha256:test",
    schemaVersion: "murph.commons.biomarker-desired-directions.v1",
  };
  const protocolIndex = input.protocolIndex ?? {
    catalogHash: "sha256:test",
    protocols: [finnishDrySaunaProtocolSummary],
    schemaVersion: "murph.commons.protocol-index.v1",
  };
  const protocolRunSpecs = input.protocolRunSpecs ?? {
    catalogHash: "sha256:test",
    protocols: [
      {
        ...finnishDrySaunaProtocolSummary,
        expectedSignalDescriptions: [],
        experimentOnboarding: null,
        protocol: finnishDrySaunaProtocol.protocol,
        safety: finnishDrySaunaProtocol.safety,
        testPlans: finnishDrySaunaProtocol.testPlans,
        whyItWorks: [],
      },
    ],
    schemaVersion: "murph.commons.protocol-run-specs.v1",
  };
  const familyGraph = input.familyGraph ?? {
    catalogHash: "sha256:test",
    edges: [
      {
        sourceKey: finnishDrySaunaProtocol.key,
        targetKey: drySaunaFamily.key,
        type: "parent_family",
      },
    ],
    families: [drySaunaFamily],
    protocols: [finnishDrySaunaProtocolSummary],
    schemaVersion: "murph.commons.protocol-family-graph.v1",
  };

  return {
    biomarkerDesiredDirections,
    familyGraph,
    protocolIndex,
    protocolRunSpecs,
  };
}

function selectRunnerDependencyPackageName(packageNames: readonly string[]): string {
  const packageName = packageNames.find((entry) => entry !== hostedRunnerRuntimePackageName);

  if (!packageName) {
    throw new Error("Fixture must include at least one runner dependency package.");
  }

  return packageName;
}
