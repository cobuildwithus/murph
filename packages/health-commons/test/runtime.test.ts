import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { resolveMetricDefinition } from "@murphai/health-metrics";

import {
  buildHealthCommonsBiomarkerDesiredDirectionsArtifact,
  createHealthCommonsCatalogReader,
  createHealthCommonsRouteBundleReader,
  getGeneratedHealthCommonsBiomarkerDesiredDirections,
  getGeneratedHealthCommonsWebBiomarkerIndex,
  getGeneratedHealthCommonsWebRouteIndex,
  HEALTH_COMMONS_BIOMARKER_DESIRED_DIRECTIONS_SCHEMA_VERSION,
  loadGeneratedHealthCommonsBiomarkerDesiredDirections,
  loadGeneratedHealthCommonsWebBiomarkerIndex,
  loadGeneratedHealthCommonsWebRouteBundle,
  loadGeneratedHealthCommonsWebRouteIndex,
  MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV,
  resolveGeneratedHealthCommonsBiomarkerDesiredDirection,
} from "@murphai/health-commons";
import { healthCommonsCatalogSchema } from "@murphai/contracts";

const TEST_CATALOG_HASH = `sha256:${"0".repeat(64)}`;
const TEST_PAGE_REVISION_ID = `sha256:${"1".repeat(64)}`;

function createMeasurementMethodCatalogReader() {
  return createHealthCommonsCatalogReader(
    healthCommonsCatalogSchema.parse({
      schemaVersion: "murph.commons.catalog.v1",
      catalogHash: TEST_CATALOG_HASH,
      entities: [
        {
          schemaVersion: "murph.commons.page.v1",
          entityType: "biomarker",
          key: "biomarker:skin-tolerability-symptoms",
          slug: "biomarkers/skin-tolerability-symptoms",
          title: "Skin Tolerability Symptoms",
          summary: "A simple skin tolerability check.",
          body: "Track irritation, redness, and other tolerability notes.",
          relativePath: "biomarkers/skin-tolerability-symptoms.md",
          revision: {
            pageRevisionId: TEST_PAGE_REVISION_ID,
          },
        },
        {
          schemaVersion: "murph.commons.page.v1",
          entityType: "measurement_method",
          key: "measurement_method:standardized-skin-photo-score",
          slug: "measurement-methods/standardized-skin-photo-score",
          title: "Standardized Skin Photo Score",
          summary: "Same-camera, same-lighting photo scoring for skin experiments.",
          status: "reviewed",
          aliases: ["skin photo method"],
          categories: ["skin", "photography"],
          measurementMethod: {
            shortName: "Skin photo score",
            tier: "optional_home",
            modalities: ["standardized_photo"],
            measuredBiomarkerKeys: ["biomarker:skin-tolerability-symptoms"],
            outputs: [
              {
                outputId: "skin_photo_score",
                label: "Skin photo score",
                valueType: "score",
                mapsToBiomarkerKey: "biomarker:skin-tolerability-symptoms",
                direction: "higher_is_better",
                notes: ["Lighting control matters for repeated skin photos."],
              },
            ],
            procedure: {
              summary: "Use the same camera, distance, room lighting, and region of interest.",
              materials: ["Phone camera"],
              steps: ["Take each photo with the same camera setup."],
              schedule: ["Baseline and weekly during the run"],
            },
            fidelity: {
              minimumRequirements: ["Same camera setup and target region."],
              repeatabilityRisks: ["lighting-control", "camera distance"],
            },
            privacy: {
              containsIdentifiableImages: true,
              localOnlyRecommended: true,
              notes: ["Keep identifiable face regions cropped when possible."],
            },
            burden: {
              userBurden: "moderate",
              costTier: "free",
            },
            confounders: ["lighting-control"],
            interpretation: {
              principle: "Compare the same region under the same setup.",
              caveat: "Lighting and camera processing can dominate small apparent changes.",
            },
          },
          source: {
            kind: "web_page",
            title: "Standardized skin photo score reference",
            authors: "Test Author",
            year: 2026,
            journal: "Test Journal",
            citation: "Test Author. Standardized skin photo score reference. Test Journal. 2026.",
            url: "https://example.com/standardized-skin-photo-score",
          },
          body: "Use a pre-declared scoring rubric instead of changing the target after the run.",
          relativePath: "measurement-methods/standardized-skin-photo-score.md",
          revision: {
            pageRevisionId: TEST_PAGE_REVISION_ID,
          },
        },
        {
          schemaVersion: "murph.commons.page.v1",
          entityType: "measurement_method",
          key: "measurement_method:skin-erythema-score",
          slug: "measurement-methods/skin-erythema-score",
          title: "Skin Erythema Score",
          summary: "Same-camera skin score for redness checks.",
          status: "reviewed",
          categories: ["skin", "photography"],
          source: {
            kind: "journal_article",
            title: "Same-camera skin erythema scoring",
            authors: "Test Author",
            year: 2024,
            journal: "Skin Methods Journal",
            citation:
              "Test Author. Same-camera skin erythema scoring. Skin Methods Journal. 2024.",
          },
          measurementMethod: {
            shortName: "Erythema score",
            tier: "optional_home",
            modalities: ["standardized_photo"],
            measuredBiomarkerKeys: ["biomarker:skin-tolerability-symptoms"],
            outputs: [
              {
                outputId: "erythema_score",
                label: "Erythema score",
                valueType: "score",
                mapsToBiomarkerKey: "biomarker:skin-tolerability-symptoms",
                direction: "lower_is_better",
              },
            ],
            procedure: {
              summary: "Use the same camera and lighting to score redness over time.",
              materials: ["Phone camera"],
              steps: ["Take the same camera shot again."],
              schedule: ["Baseline and weekly during the run"],
            },
            privacy: {
              containsIdentifiableImages: true,
              localOnlyRecommended: true,
              notes: ["Keep identifiable redness photos private."],
            },
            burden: {
              userBurden: "low",
              costTier: "free",
            },
            interpretation: {
              principle: "Lower redness is better.",
              caveat: "Lighting and camera processing still matter.",
            },
          },
          body: "Second method body.",
          relativePath: "measurement-methods/skin-erythema-score.md",
          revision: {
            pageRevisionId: TEST_PAGE_REVISION_ID,
          },
        },
        {
          schemaVersion: "murph.commons.page.v1",
          entityType: "protocol_variant",
          key: "protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging",
          slug: "protocols/skin-photobiomodulation/red-near-infrared-skin-texture-photoaging",
          title: "Red/Near-Infrared Skin Texture Photoaging",
          summary: "A skin photobiomodulation protocol.",
          lineage: {
            relationship: "root",
            rationale: "Test protocol.",
          },
          attribution: {
            ownerType: "murph",
          },
          protocol: {
            doseSignature: "3x/week red/NIR skin exposure",
            steps: ["Protect eyes", "Expose the target area", "Log tolerability"],
          },
          testPlans: [
            {
              planId: "skin-photo-42d",
              durationDays: 42,
              baselineDays: 7,
              interventionDays: 35,
              primaryBiomarkerKey: "biomarker:skin-tolerability-symptoms",
            },
          ],
          safety: {
            cautionLevel: "moderate",
            stopIf: ["Eye discomfort", "Skin irritation"],
          },
          measurementPlan: {
            schemaVersion: "murph.commons.measurement-plan.v1",
            defaultPathId: "home-photo-score",
            paths: [
              {
                pathId: "home-photo-score",
                label: "Home photo score",
                tier: "default_home",
                required: true,
                methodKeys: ["measurement_method:standardized-skin-photo-score"],
                outcomeKeys: ["biomarker:skin-tolerability-symptoms"],
                notes: ["Use the same camera setup when comparing skin photos."],
              },
            ],
          },
          body: "Protocol body.",
          relativePath:
            "protocols/skin-photobiomodulation/red-near-infrared-skin-texture-photoaging.md",
          revision: {
            pageRevisionId: TEST_PAGE_REVISION_ID,
          },
        },
      ],
      redirects: [],
      changes: [],
      artifactManifests: [],
      evidenceAppraisals: [],
    }),
  );
}

describe("@murphai/health-commons runtime catalog reader", () => {
  it("builds a sorted compact biomarker desired-direction projection", () => {
    expect(
      buildHealthCommonsBiomarkerDesiredDirectionsArtifact({
        biomarkers: [
          {
            desiredDirection: "lower_or_stable",
            key: "biomarker:zeta",
          },
          {
            desiredDirection: null,
            key: "biomarker:without-direction",
          },
          {
            desiredDirection: "higher",
            key: "biomarker:alpha",
          },
        ],
        catalogHash: TEST_CATALOG_HASH,
      }),
    ).toEqual({
      biomarkers: [
        {
          desiredDirection: "higher",
          key: "biomarker:alpha",
        },
        {
          desiredDirection: "lower_or_stable",
          key: "biomarker:zeta",
        },
      ],
      catalogHash: TEST_CATALOG_HASH,
      schemaVersion:
        HEALTH_COMMONS_BIOMARKER_DESIRED_DIRECTIONS_SCHEMA_VERSION,
    });
  });

  it("resolves desired directions through canonical biomarker aliases", () => {
    expect(getGeneratedHealthCommonsBiomarkerDesiredDirections()).toMatchObject({
      schemaVersion:
        HEALTH_COMMONS_BIOMARKER_DESIRED_DIRECTIONS_SCHEMA_VERSION,
    });
    expect(
      resolveGeneratedHealthCommonsBiomarkerDesiredDirection("biomarker:hrv"),
    ).toBe("higher_or_stable");
    expect(
      resolveGeneratedHealthCommonsBiomarkerDesiredDirection("biomarker:hrv-rmssd"),
    ).toBe("higher_or_stable");
    expect(
      resolveGeneratedHealthCommonsBiomarkerDesiredDirection("biomarker:resting_hr"),
    ).toBe("lower_or_stable");
    expect(
      resolveGeneratedHealthCommonsBiomarkerDesiredDirection("biomarker:not-in-catalog"),
    ).toBeNull();
  });

  it("loads the compact generated biomarker browse index", () => {
    const biomarkerIndex = getGeneratedHealthCommonsWebBiomarkerIndex();

    expect(biomarkerIndex.schemaVersion).toBe("murph.commons.web.biomarker-index.v4");
    expect(
      biomarkerIndex.biomarkers.find((entry) => entry.routeId === "estimated-vo2max"),
    ).toEqual(expect.objectContaining({
      bundlePath: "bundles/biomarker/estimated-vo2max.json",
      key: "biomarker:estimated-vo2max",
    }));
    expect(
      biomarkerIndex.biomarkers.find((entry) => entry.routeId === "chloride")?.fallbackRanges,
    ).toEqual([expect.objectContaining({
      eligibleSpecimenKinds: ["serum"],
      lowerBound: { inclusive: true, value: 98 },
      unit: "mmol/L",
      upperBound: { inclusive: true, value: 107 },
    })]);
  });

  it("keeps published biomarker private metric bindings aligned with the metric catalog", () => {
    const biomarkerIndex = getGeneratedHealthCommonsWebBiomarkerIndex();
    const publishedBiomarkers = biomarkerIndex.biomarkers
      .filter((entry) => entry.published && entry.hidden !== true);

    for (const entry of publishedBiomarkers) {
      const bundle = loadGeneratedHealthCommonsWebRouteBundle({
        entityType: "biomarker",
        routeId: entry.routeId,
      });
      expect(bundle, `Expected biomarker route bundle for ${entry.routeId}`).not.toBeNull();
      if (!bundle) {
        continue;
      }

      const reader = createHealthCommonsRouteBundleReader(bundle);
      const entity = reader.findByKey(entry.key);
      expect(entity?.entityType).toBe("biomarker");
      if (!entity || entity.entityType !== "biomarker") {
        continue;
      }

      for (const binding of entity.biomarker?.privateMetricBindings ?? []) {
        const definition = resolveMetricDefinition(binding.metricKey);
        expect(definition, `${entry.key} private metric ${binding.metricKey}`).not.toBeNull();
        if (binding.role === "primary") {
          expect(definition?.biomarkerKey).toBe(entry.key);
        }
      }
    }
  });

  it("falls back to package-relative generated artifacts when the package root env is unset", () => {
    const previousPackageRoot =
      process.env[MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV];
    delete process.env[MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV];
    try {
      const biomarkerIndex = loadGeneratedHealthCommonsWebBiomarkerIndex();
      const routeIndex = loadGeneratedHealthCommonsWebRouteIndex();

      expect(
        biomarkerIndex.biomarkers.some((biomarker) => biomarker.routeId === "resting-heart-rate"),
      ).toBe(true);
      expect(
        routeIndex.routes.some((route) => route.routeId === "resting-heart-rate"),
      ).toBe(true);
    } finally {
      if (previousPackageRoot === undefined) {
        delete process.env[MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV];
      } else {
        process.env[MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV] = previousPackageRoot;
      }
    }
  });

  it("uses the env-pinned package root for generated runtime artifacts when present", async () => {
    const packageRoot = await mkdtemp(
      path.join(os.tmpdir(), "murph-health-commons-package-root-"),
    );
    const generatedRoot = path.join(packageRoot, "generated");
    await mkdir(path.join(generatedRoot, "web", "routes"), { recursive: true });

    const catalogHash = `sha256:${"2".repeat(64)}`;
    await writeFile(
      path.join(generatedRoot, "biomarker-desired-directions.json"),
      `${JSON.stringify({
        biomarkers: [{
          desiredDirection: "lower_or_stable",
          key: "biomarker:resting-heart-rate",
        }],
        catalogHash,
        schemaVersion:
          HEALTH_COMMONS_BIOMARKER_DESIRED_DIRECTIONS_SCHEMA_VERSION,
      })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(generatedRoot, "web", "routes", "index.json"),
      `${JSON.stringify({
        catalogHash,
        routes: [],
        schemaVersion: "murph.commons.web.route-index.v1",
      })}\n`,
      "utf8",
    );

    const previousPackageRoot =
      process.env[MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV];
    process.env[MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV] = packageRoot;
    try {
      expect(
        loadGeneratedHealthCommonsBiomarkerDesiredDirections().catalogHash,
      ).toBe(catalogHash);
      expect(
        resolveGeneratedHealthCommonsBiomarkerDesiredDirection(
          "biomarker:resting_hr",
          {
            biomarkerDesiredDirectionsPath: path.join(
              generatedRoot,
              "biomarker-desired-directions.json",
            ),
          },
        ),
      ).toBe("lower_or_stable");
      expect(loadGeneratedHealthCommonsWebRouteIndex().catalogHash).toBe(catalogHash);
    } finally {
      if (previousPackageRoot === undefined) {
        delete process.env[MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV];
      } else {
        process.env[MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV] = previousPackageRoot;
      }
    }
  });

  it("fails missing generated artifact loads under the env-pinned package root instead of probing cwd fallbacks", async () => {
    const packageRoot = await mkdtemp(
      path.join(os.tmpdir(), "murph-health-commons-empty-package-root-"),
    );
    const previousPackageRoot =
      process.env[MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV];
    process.env[MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV] = packageRoot;
    try {
      const expectedGeneratedRootPath = path.join(packageRoot, "generated");
      const expectedWebRootPath = path.join(packageRoot, "generated", "web");

      expect(() => loadGeneratedHealthCommonsBiomarkerDesiredDirections())
        .toThrow(
          path.join(
            expectedGeneratedRootPath,
            "biomarker-desired-directions.json",
          ),
        );
      expect(() => loadGeneratedHealthCommonsWebRouteIndex())
        .toThrow(path.join(expectedWebRootPath, "routes", "index.json"));
      expect(() => loadGeneratedHealthCommonsWebBiomarkerIndex())
        .toThrow(path.join(expectedWebRootPath, "browse", "biomarkers.json"));
    } finally {
      if (previousPackageRoot === undefined) {
        delete process.env[MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV];
      } else {
        process.env[MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV] = previousPackageRoot;
      }
    }
  });

  it("rejects malformed generated biomarker desired directions", async () => {
    const generatedRoot = await mkdtemp(
      path.join(os.tmpdir(), "murph-health-commons-directions-"),
    );
    const artifactPath = path.join(
      generatedRoot,
      "biomarker-desired-directions.json",
    );
    await writeFile(
      artifactPath,
      `${JSON.stringify({
        biomarkers: [{
          desiredDirection: "sideways",
          key: "biomarker:resting-heart-rate",
        }],
        catalogHash: TEST_CATALOG_HASH,
        schemaVersion:
          HEALTH_COMMONS_BIOMARKER_DESIRED_DIRECTIONS_SCHEMA_VERSION,
      })}\n`,
      "utf8",
    );

    expect(() =>
      loadGeneratedHealthCommonsBiomarkerDesiredDirections({
        biomarkerDesiredDirectionsPath: artifactPath,
      })
    ).toThrow(
      "Health Commons generated biomarker desired directions are invalid.",
    );
  });

  it("loads route-scoped web bundles and preserves the route-bundle reader contract", () => {
    const routeIndex = getGeneratedHealthCommonsWebRouteIndex();
    const routeEntry = routeIndex.routes.find((entry) =>
      entry.entityType === "biomarker" && entry.routeId === "estimated-vo2max"
    );

    expect(routeEntry).toMatchObject({
      bundlePath: "bundles/biomarker/estimated-vo2max.json",
      entityType: "biomarker",
      routeId: "estimated-vo2max",
    });

    const bundle = loadGeneratedHealthCommonsWebRouteBundle({
      entityType: "biomarker",
      routeId: "estimated-vo2max",
    });

    expect(bundle).not.toBeNull();
    if (!bundle) {
      throw new Error("Expected a generated estimated VO2max route bundle.");
    }
    expect(bundle.route).toEqual(expect.objectContaining({
      entityType: "biomarker",
      routeId: "estimated-vo2max",
      slug: "biomarkers/estimated-vo2max",
    }));
    expect(bundle.entitiesByKey[bundle.primaryKey]?.entityType).toBe("biomarker");
    expect(bundle.revisionManifest[bundle.primaryKey]).toEqual({
      pageRevisionId: expect.stringMatching(/^sha256:/u),
      recipeHash: null,
      runSpecRevisionId: null,
      workflowSpecRevisionId: null,
    });
    const reader = createHealthCommonsRouteBundleReader(bundle);
    expect(reader.route).toEqual(bundle.route);
    expect(reader.revisionManifest).toEqual(bundle.revisionManifest);
    expect(reader.findByKey(bundle.primaryKey)?.entityType).toBe("biomarker");
    expect(
      bundle.reverseEdges.every((edge) => bundle.entitiesByKey[edge.sourceKey] !== undefined),
    ).toBe(true);

    const [firstSourceKey, sourceSnippet] = Object.entries(bundle.sourceSnippets)[0] ?? [];
    expect(firstSourceKey).toEqual(expect.stringMatching(/^source_artifact:/u));
    expect(sourceSnippet).toEqual(expect.objectContaining({
      key: firstSourceKey,
      title: expect.any(String),
    }));
    expect(
      Object.values(bundle.sourceSnippets).every((snippet) =>
        (snippet.finding?.length ?? 0) <= 1_000
      ),
    ).toBe(true);
    expect(reader.getSourceSnippet(`${firstSourceKey}@sha256:deadbeef`)).toEqual(sourceSnippet);

    const sourceBodies = Object.values(bundle.entitiesByKey)
      .filter((entity) => entity.entityType === "source_artifact")
      .map((entity) => entity.body);
    expect(sourceBodies.length).toBeGreaterThan(0);
    expect(sourceBodies.every((body) => body.length < 1_500)).toBe(true);
    expect(sourceBodies.every((body) => body === "" || body.startsWith("**Findings:**"))).toBe(
      true,
    );
    expect(
      Object.values(bundle.entitiesByKey)
        .filter((entity) => entity.entityType === "source_artifact")
        .every((entity) => entity.relations?.length === 0),
    ).toBe(true);

    const reverseMeasurementEdges = reader.listReverseEdges({
      relationTypes: ["measures"],
      targetKey: bundle.primaryKey,
    });
    expect(reverseMeasurementEdges.length).toBeGreaterThan(0);
    expect(
      reverseMeasurementEdges.every(
        (edge) =>
          edge.relation.type === "measures"
          && edge.relation.target === bundle.primaryKey
          && edge.sourceKey.length > 0,
      ),
    ).toBe(true);

    expect(bundle.reverseEdges.every((edge) => edge.relation.type !== "cites")).toBe(true);
  });

  it("rejects unsafe projection paths in generated route indexes", async () => {
    const routeIndex = getGeneratedHealthCommonsWebRouteIndex();
    const goalRoute = routeIndex.routes.find((entry) =>
      entry.entityType === "goal_template" && entry.projections?.["goal.page"] !== undefined
    );
    if (!goalRoute?.projections) {
      throw new Error("Expected a generated goal route with projections.");
    }

    const generatedWebRoot = await mkdtemp(path.join(os.tmpdir(), "murph-health-commons-web-"));
    await mkdir(path.join(generatedWebRoot, "routes"), { recursive: true });
    const unsafeProjectionPaths = [
      "../pages/goals/other.json",
      "%2e%2e/pages/goals/other.json",
      "%252e%252e/pages/goals/other.json",
      "pages%2fgoals/other.json",
      "pages%252fgoals/other.json",
      "pages%5cgoals/other.json",
      "pages/goals/other.json?outside",
      "pages/goals/other.json#outside",
    ];

    for (const unsafeProjectionPath of unsafeProjectionPaths) {
      await writeFile(
        path.join(generatedWebRoot, "routes/index.json"),
        JSON.stringify({
          ...routeIndex,
          routes: [
            {
              ...goalRoute,
              projections: {
                ...goalRoute.projections,
                "goal.page": unsafeProjectionPath,
              },
            },
          ],
        }),
        "utf8",
      );

      expect(
        () => getGeneratedHealthCommonsWebRouteIndex({ generatedWebRoot }),
        unsafeProjectionPath,
      ).toThrow("Health Commons generated web route index is invalid.");
    }
  });

  it("lists and searches measurement methods with compact measurement fields", () => {
    const reader = createMeasurementMethodCatalogReader();

    const methods = reader.listMeasurementMethods({
      categories: ["skin"],
      limit: 5,
      query: "same camera",
      statuses: ["reviewed"],
    });

    expect(methods).toHaveLength(2);
    expect(methods.map((method) => method.key)).toEqual(
      expect.arrayContaining([
        "measurement_method:skin-erythema-score",
        "measurement_method:standardized-skin-photo-score",
      ]),
    );

    const standardizedMethod = methods.find(
      (method) => method.key === "measurement_method:standardized-skin-photo-score",
    );
    expect(standardizedMethod).toMatchObject({
      entityType: "measurement_method",
      key: "measurement_method:standardized-skin-photo-score",
      measurementMethod: {
        modalities: ["standardized_photo"],
        privacy: {
          notes: ["Keep identifiable face regions cropped when possible."],
        },
        tier: "optional_home",
      },
      measurementPlan: null,
    });

    if (!standardizedMethod?.measurementMethod?.privacy?.notes) {
      throw new Error("Expected standardized method privacy notes in compact entity.");
    }
    standardizedMethod.measurementMethod.privacy.notes.push("Mutated compact copy.");
    const sourceEntity = reader.findByKey("measurement_method:standardized-skin-photo-score");
    if (!sourceEntity) {
      throw new Error("Expected standardized measurement method source entity.");
    }
    expect(reader.compactEntity(sourceEntity).measurementMethod?.privacy?.notes).toEqual([
      "Keep identifiable face regions cropped when possible.",
    ]);

    expect(reader.listMeasurementMethods({
      candidateKeys: [],
      limit: 5,
    })).toEqual([]);

    const webPageMethods = reader.listMeasurementMethods({
      categories: ["skin"],
      limit: 5,
      query: "same camera",
      sourceKinds: ["web_page"],
      statuses: ["reviewed"],
    });
    expect(webPageMethods).toHaveLength(1);
    expect(webPageMethods[0]?.key).toBe("measurement_method:standardized-skin-photo-score");

    const methodResults = reader.search({
      entityTypes: ["measurement_method"],
      limit: 5,
      query: "lighting control",
    });
    expect(methodResults[0]).toMatchObject({
      entity: {
        key: "measurement_method:standardized-skin-photo-score",
      },
      matchedFields: expect.arrayContaining(["measurement_method"]),
    });

    const protocolResults = reader.search({
      entityTypes: ["protocol_variant"],
      limit: 5,
      query: "same camera setup",
    });
    expect(protocolResults[0]).toMatchObject({
      entity: {
        key: "protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging",
        measurementPlan: {
          defaultPathId: "home-photo-score",
          paths: [
            expect.objectContaining({
              methodKeys: ["measurement_method:standardized-skin-photo-score"],
              outcomeKeys: ["biomarker:skin-tolerability-symptoms"],
            }),
          ],
          schemaVersion: "murph.commons.measurement-plan.v1",
        },
      },
      matchedFields: expect.arrayContaining(["measurement_plan"]),
    });
  });

  it("normalizes wildcard filters for compact catalog lists", () => {
    const reader = createMeasurementMethodCatalogReader();

    const wildcardStatusKeys = reader.listMeasurementMethods({
      limit: 20,
      query: "camera",
      statuses: ["*"],
    }).map((method) => method.key);
    expect(wildcardStatusKeys).toContain("measurement_method:standardized-skin-photo-score");

    const wildcardCategoryKeys = reader.listMeasurementMethods({
      categories: ["*"],
      limit: 20,
      query: "camera",
    }).map((method) => method.key);
    expect(wildcardCategoryKeys).toContain("measurement_method:standardized-skin-photo-score");

    const spacedCategoryKeys = reader.listMeasurementMethods({
      categories: ["skin photography"],
      limit: 500,
    }).map((method) => method.key);
    const slugCategoryKeys = reader.listMeasurementMethods({
      categories: ["skin-photography"],
      limit: 500,
    }).map((method) => method.key);
    expect(spacedCategoryKeys).toEqual(slugCategoryKeys);

    expect(reader.normalizeListOptions({
      categories: ["*"],
      limit: 20,
      query: "Camera",
      statuses: ["*"],
    })).toMatchObject({
      categories: [],
      ignoredWildcards: {
        categories: ["*"],
        statuses: ["*"],
      },
      query: "camera",
      statuses: [],
    });

    expect(() => reader.listMeasurementMethods({
      statuses: ["active"],
    })).toThrow(/Unknown Health Commons status filter\. Expected one of:/u);
  });
});
