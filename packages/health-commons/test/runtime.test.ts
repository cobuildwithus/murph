import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";
import { resolveMetricDefinition } from "@murphai/health-metrics";

import {
  createHealthCommonsCatalogReader,
  createHealthCommonsRouteBundleReader,
  getGeneratedHealthCommonsProtocolFamilyGraphReader,
  getGeneratedHealthCommonsProtocolIndexReader,
  getGeneratedHealthCommonsProtocolRunSpecReader,
  getGeneratedHealthCommonsWebBiomarkerIndex,
  getGeneratedHealthCommonsWebExperimentIndex,
  getGeneratedHealthCommonsWebRouteIndex,
  listGeneratedAssistantProtocolIndexEntries,
  loadGeneratedHealthCommonsProtocolFamilyGraph,
  loadGeneratedHealthCommonsProtocolIndex,
  loadGeneratedHealthCommonsProtocolRunSpecs,
  loadGeneratedHealthCommonsWebExperimentProtocolTab,
  loadGeneratedHealthCommonsWebExperimentResearchTab,
  loadGeneratedHealthCommonsWebExperimentResultsPublic,
  loadGeneratedHealthCommonsWebExperimentShell,
  loadGeneratedHealthCommonsWebRouteBundle,
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
  it("loads the compact generated biomarker browse index", () => {
    const biomarkerIndex = getGeneratedHealthCommonsWebBiomarkerIndex();
    const publishedRouteIds = biomarkerIndex.biomarkers
      .filter((entry) => entry.published)
      .map((entry) => entry.routeId);

    expect(biomarkerIndex.schemaVersion).toBe("murph.commons.web.biomarker-index.v1");
    expect(publishedRouteIds).toEqual(expect.arrayContaining([
      "estimated-vo2max",
      "resting-heart-rate",
      "deep-sleep-minutes",
    ]));
    expect(
      biomarkerIndex.biomarkers.find((entry) => entry.routeId === "estimated-vo2max"),
    ).toEqual(expect.objectContaining({
      bundlePath: "bundles/biomarker/estimated-vo2max.json",
      key: "biomarker:estimated-vo2max",
      published: true,
    }));
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

  it("keeps protocol sort rank in the generated experiment index", () => {
    const experimentIndex = getGeneratedHealthCommonsWebExperimentIndex();
    const firstProtocolIds = experimentIndex.experiments
      .filter((entry) => entry.sortRank != null)
      .sort((left, right) => (left.sortRank ?? 0) - (right.sortRank ?? 0))
      .slice(0, 4)
      .map((entry) => entry.routeId);

    expect(firstProtocolIds).toEqual([
      "finnish-sauna",
      "norwegian-4x4",
      "red-light-glasses-before-bed",
      "bryan-johnson-blueprint",
    ]);
    expect(
      experimentIndex.experiments.find((entry) => entry.routeId === "finnish-sauna"),
    ).toEqual(expect.objectContaining({ sortRank: 10 }));
  });

  it("exposes a compact assistant protocol index from generated protocol artifacts", () => {
    const protocolIndex = loadGeneratedHealthCommonsProtocolIndex();
    const entries = listGeneratedAssistantProtocolIndexEntries();

    expect(entries).toEqual(
      protocolIndex.protocols.map((entry) => ({
        category: expect.any(String),
        routeId: entry.routeId,
        title: entry.title,
      })),
    );
    expect(entries).toContainEqual({
      category: "Recovery",
      routeId: "finnish-sauna",
      title: "Finnish Dry Sauna",
    });
    expect(entries.some((entry) => entry.routeId === "creatine-monohydrate")).toBe(false);
    expect(
      entries.every((entry) =>
        Object.keys(entry).sort().join(",") === "category,routeId,title"
      ),
    ).toBe(true);
  });

  it("builds assistant protocol entries from the compact protocol index without web artifacts", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "murph-health-commons-protocol-index-"));
    const protocolIndexPath = path.join(tempDir, "protocol-index.json");
    const index = loadGeneratedHealthCommonsProtocolIndex();
    const finnishSauna = index.protocols.find((protocol) =>
      protocol.key === "protocol_variant:dry-sauna/murph-finnish-standard-3x-week"
    );

    if (!finnishSauna) {
      throw new Error("Expected Finnish sauna in generated protocol index.");
    }

    await writeFile(
      protocolIndexPath,
      `${JSON.stringify({
        catalogHash: index.catalogHash,
        protocols: [finnishSauna],
        schemaVersion: index.schemaVersion,
      }, null, 2)}\n`,
      "utf8",
    );

    expect(listGeneratedAssistantProtocolIndexEntries({ protocolIndexPath })).toEqual([
      {
        category: "Recovery",
        routeId: "finnish-sauna",
        title: "Finnish Dry Sauna",
      },
    ]);
  });

  it("loads route-scoped web bundles and preserves the route-bundle reader contract", () => {
    const routeIndex = getGeneratedHealthCommonsWebRouteIndex();
    const routeEntry = routeIndex.routes.find((entry) =>
      entry.entityType === "protocol_variant" && entry.routeId === "finnish-sauna"
    );

    expect(routeEntry).toMatchObject({
      bundlePath: "bundles/protocol_variant/finnish-sauna.json",
      entityType: "protocol_variant",
      routeId: "finnish-sauna",
    });

    const bundle = loadGeneratedHealthCommonsWebRouteBundle({
      entityType: "protocol_variant",
      routeId: "murph-finnish-standard-3x-week",
    });

    expect(bundle).not.toBeNull();
    if (!bundle) {
      throw new Error("Expected a generated Finnish sauna route bundle.");
    }
    expect(bundle.route).toEqual(expect.objectContaining({
      aliases: expect.arrayContaining(["murph-finnish-standard-3x-week"]),
      entityType: "protocol_variant",
      routeId: "finnish-sauna",
      slug: "protocols/dry-sauna/murph-finnish-standard-3x-week",
    }));
    expect(bundle.entitiesByKey[bundle.primaryKey]?.entityType).toBe("protocol_variant");
    expect(Object.keys(bundle.sourceSnippets)).not.toHaveLength(0);

    expect(bundle.revisionManifest[bundle.primaryKey]).toEqual({
      pageRevisionId: expect.stringMatching(/^sha256:/u),
      recipeHash: expect.stringMatching(/^sha256:/u),
      runSpecRevisionId: expect.stringMatching(/^sha256:/u),
    });
    const reader = createHealthCommonsRouteBundleReader(bundle);
    expect(reader.route).toEqual(bundle.route);
    expect(reader.revisionManifest).toEqual(bundle.revisionManifest);
    expect(reader.findByKey(bundle.primaryKey)?.entityType).toBe("protocol_variant");
    expect(reader.listEvidenceAppraisals({ targetKey: bundle.primaryKey }).length).toBeGreaterThan(0);
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

    const reverseProtocolEdges = reader.listReverseEdges({
      relationTypes: ["related_protocol"],
      targetKey: bundle.primaryKey,
    });
    expect(reverseProtocolEdges.length).toBeGreaterThan(0);
    expect(reverseProtocolEdges.every((edge) => edge.relation.type === "related_protocol")).toBe(
      true,
    );
    expect(
      reverseProtocolEdges.every(
        (edge) => edge.relation.target === bundle.primaryKey && edge.sourceKey.length > 0,
      ),
    ).toBe(true);
    expect(reverseProtocolEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        relation: expect.objectContaining({
          target: bundle.primaryKey,
          type: "related_protocol",
        }),
        sourceKey: "biomarker:resting-heart-rate",
      }),
    ]));

    expect(bundle.reverseEdges.every((edge) => edge.relation.type !== "cites")).toBe(true);
  });

  it("loads the minimal experiment research-tab projection by primary id and aliases", () => {
    const researchTab = loadGeneratedHealthCommonsWebExperimentResearchTab({
      routeId: "finnish-sauna",
    });
    const aliasResearchTab = loadGeneratedHealthCommonsWebExperimentResearchTab({
      routeId: "murph-finnish-standard-3x-week",
    });

    expect(researchTab).not.toBeNull();
    expect(aliasResearchTab).toEqual(researchTab);
    if (!researchTab) {
      throw new Error("Expected the generated Finnish sauna research tab.");
    }

    expect(researchTab).toEqual(expect.objectContaining({
      key: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
      route: expect.objectContaining({
        entityType: "protocol_variant",
        routeId: "finnish-sauna",
      }),
      schemaVersion: "murph.commons.web.experiment-research-tab.v1",
      title: "Finnish Dry Sauna",
    }));
    expect(researchTab.researchStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "SOURCES CHECKED", value: 178 }),
      expect.objectContaining({ label: "DIRECT HUMAN PARTICIPANTS", value: "11,584+" }),
      expect.objectContaining({ label: "REVIEW PAPERS", value: 51 }),
      expect.objectContaining({ label: "RESEARCH PAPERS", value: 98 }),
      expect.objectContaining({ label: "YEARS COVERED", value: "1979–2026" }),
    ]));
    expect(researchTab.protocolKeepInMind).toEqual(expect.arrayContaining([
      expect.stringContaining("short self-experiment"),
    ]));
    expect(Object.keys(researchTab.researchLandscape ?? {})).not.toContain("groups");
    expect(researchTab.researchGroups?.map((group) => [group.id, group.studies.length])).toEqual([
      ["evidence-backbone-and-claim-calibration", 23],
      ["dry_sauna_acute_thermoregulation", 1],
      ["near-term-autonomic-vascular-and-immune-signals", 38],
      ["intervention-design-training-and-mixed-results", 29],
      ["post_exercise_heat_performance", 2],
      ["cultural-practice-and-protocol-context", 4],
      ["traditional-sauna-design-and-operation", 2],
      ["sauna-modality-definition-context", 1],
      ["long-term-finnish-cohort-and-real-world-context", 21],
      ["safety-dose-modality-and-context-boundaries", 69],
      ["operational-public-sauna-safety", 3],
      ["external-protocol-claims", 5],
      ["external-protocol-dose-context", 1],
      ["core-temperature-measurement-context", 2],
      ["heat-tolerance-safety-boundaries", 2],
    ]);
    expect(researchTab.studies.length).toBeGreaterThan(100);
    expect(researchTab.studies[0]).toEqual(expect.objectContaining({
      authors: expect.any(String),
      journal: expect.any(String),
      title: expect.any(String),
      type: expect.any(String),
    }));
    expect(researchTab.studies.every((study) => (study.finding?.length ?? 0) <= 1_000))
      .toBe(true);
    expect(researchTab.studies.every((study) =>
      Object.keys(study).every((key) => RESEARCH_STUDY_PROJECTION_KEYS.has(key))
    )).toBe(true);
    expect(
      researchTab.researchGroups?.every((group) =>
        group.studies.every((study) =>
          Object.keys(study).every((key) => RESEARCH_STUDY_PROJECTION_KEYS.has(key))
        )
      ) ?? true,
    ).toBe(true);
    expect(Object.keys(researchTab)).not.toContain("entitiesByKey");
    expect(Object.keys(researchTab)).not.toContain("evidenceAppraisals");
    expect(Object.keys(researchTab)).not.toContain("sourceSnippets");
  });

  it("loads minimal experiment shell, protocol-tab, and results projections by aliases", () => {
    const shell = loadGeneratedHealthCommonsWebExperimentShell({
      routeId: "murph-finnish-standard-3x-week",
    });
    const protocolTab = loadGeneratedHealthCommonsWebExperimentProtocolTab({
      routeId: "murph-finnish-standard-3x-week",
    });
    const resultsPublic = loadGeneratedHealthCommonsWebExperimentResultsPublic({
      routeId: "murph-finnish-standard-3x-week",
    });

    expect(shell).toEqual(expect.objectContaining({
      baselineDays: 7,
      durationDays: 21,
      id: "finnish-sauna",
      schemaVersion: "murph.commons.web.experiment-shell.v1",
      title: "Finnish Dry Sauna",
    }));
    expect(protocolTab).toEqual(expect.objectContaining({
      baselineDays: 7,
      durationDays: 21,
      id: "finnish-sauna",
      schemaVersion: "murph.commons.web.experiment-protocol-tab.v1",
    }));
    expect(resultsPublic).toEqual(expect.objectContaining({
      commons: expect.objectContaining({
        aliases: expect.arrayContaining([
          "finnish-sauna",
          "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
          "murph-finnish-standard-3x-week",
        ]),
        key: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
        routeId: "finnish-sauna",
      }),
      id: "finnish-sauna",
      schemaVersion: "murph.commons.web.experiment-results-public.v1",
    }));
    expect(protocolTab?.expectedSignals.length).toBeGreaterThan(0);
    expect(protocolTab?.expectedSignals).toContainEqual(expect.objectContaining({
      biomarkerRouteId: "resting-heart-rate",
      label: "Resting Heart Rate",
    }));
    expect(protocolTab?.protocol.length).toBeGreaterThan(0);
    expect(protocolTab?.mechanismChain).toContainEqual(expect.objectContaining({
      content: "3x/week dry heat · 5–20 min · tolerable cooldown",
      label: "Session",
    }));
    expect(protocolTab?.safety.precautions.length).toBeGreaterThan(0);
    expect(resultsPublic?.protocol).toEqual(protocolTab?.protocol);
    expect(Object.keys(shell ?? {})).not.toContain("entitiesByKey");
    expect(Object.keys(protocolTab ?? {})).not.toContain("studies");
    expect(Object.keys(resultsPublic ?? {})).not.toContain("expectedSignals");
    expect(Object.keys(resultsPublic ?? {})).not.toContain("safety");
  });

  it("projects Consistent Wake Time expected signals in the edited order with metadata", () => {
    const protocolTab = loadGeneratedHealthCommonsWebExperimentProtocolTab({
      routeId: "consistent-wake-time",
    });

    expect(protocolTab).toEqual(expect.objectContaining({
      id: "consistent-wake-time",
      title: "Consistent Wake Time",
    }));
    expect(protocolTab?.expectedSignals.map((signal) => signal.biomarkerRouteId)).toEqual([
      "total-sleep-time",
      "sleep-efficiency",
      "resting-heart-rate",
      "hrv-rmssd",
      "sleep-onset-latency",
      "daytime-sleepiness",
    ]);
    expect(protocolTab?.expectedSignals).toContainEqual(expect.objectContaining({
      biomarkerRouteId: "daytime-sleepiness",
      expected: "Should fall, not rise",
      estimatedChange: expect.objectContaining({
        confidence: "low",
        high: 0,
        kind: "absolute",
        low: -2,
        unit: "score points",
        window: "4 weeks",
      }),
      protocolProminence: "focus",
    }));
    expect(protocolTab?.expectedSignals).toContainEqual(expect.objectContaining({
      biomarkerRouteId: "sleep-efficiency",
      expected: "Track as mixed context",
      protocolProminence: "context",
    }));
    expect(protocolTab?.expectedSignals).toContainEqual(expect.objectContaining({
      biomarkerRouteId: "resting-heart-rate",
      expected: "May drop slightly",
      estimatedChange: expect.objectContaining({
        confidence: "low",
        high: 0,
        kind: "absolute",
        low: -3,
        unit: "bpm",
        window: "2-4 weeks",
      }),
      protocolProminence: "context",
    }));
  });

  it("projects Daily Step Floor safety outcomes into protocol signal cards", () => {
    const protocolTab = loadGeneratedHealthCommonsWebExperimentProtocolTab({
      routeId: "daily-step-floor",
    });

    expect(protocolTab?.expectedSignals.map((signal) => signal.biomarkerRouteId)).toEqual([
      "daily-step-count",
      "step-floor-days",
      "resting-heart-rate",
      "estimated-vo2max",
      "morning-blood-pressure",
      "sleep-efficiency",
      "musculoskeletal-pain",
      "walking-safety-events",
      "sedentary-time",
      "moderate-to-vigorous-activity-minutes",
      "walking-bout-minutes",
      "walking-cadence",
    ]);
    expect(protocolTab?.expectedSignals).toContainEqual(expect.objectContaining({
      biomarkerRouteId: "daily-step-count",
      expected: "Could improve",
      protocolProminence: "focus",
    }));
    expect(protocolTab?.expectedSignals).toContainEqual(expect.objectContaining({
      biomarkerRouteId: "walking-safety-events",
      expected: "Could trend lower",
      protocolProminence: "focus",
    }));
  });

  it("rejects route-index projection paths that do not match the route bundle id", async () => {
    const routeIndex = getGeneratedHealthCommonsWebRouteIndex();
    const finnishRoute = routeIndex.routes.find((entry) =>
      entry.entityType === "protocol_variant" && entry.routeId === "finnish-sauna"
    );
    if (!finnishRoute?.projections) {
      throw new Error("Expected a generated Finnish sauna route with projections.");
    }

    const generatedWebRoot = await mkdtemp(path.join(os.tmpdir(), "murph-health-commons-web-"));
    await mkdir(path.join(generatedWebRoot, "routes"), { recursive: true });
    await mkdir(path.join(generatedWebRoot, "tabs/experiments/norwegian-4x4"), { recursive: true });
    await writeFile(
      path.join(generatedWebRoot, "routes/index.json"),
      JSON.stringify({
        ...routeIndex,
        routes: [
          {
            ...finnishRoute,
            projections: {
              ...finnishRoute.projections,
              "experiment.research": "tabs/experiments/norwegian-4x4/research.json",
            },
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      path.join(generatedWebRoot, "tabs/experiments/norwegian-4x4/research.json"),
      readFileSync(
        new URL("../generated/web/tabs/experiments/norwegian-4x4/research.json", import.meta.url),
        "utf8",
      ),
      "utf8",
    );

    expect(() => loadGeneratedHealthCommonsWebExperimentResearchTab({
      generatedWebRoot,
      routeId: "finnish-sauna",
    })).toThrow("projection path does not match route bundle id");
  });

  it("rejects generated research study urls with unsafe schemes", async () => {
    const routeIndex = getGeneratedHealthCommonsWebRouteIndex();
    const finnishRoute = routeIndex.routes.find((entry) =>
      entry.entityType === "protocol_variant" && entry.routeId === "finnish-sauna"
    );
    if (!finnishRoute?.projections) {
      throw new Error("Expected a generated Finnish sauna route with projections.");
    }

    const unsafeUrls = [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "//example.test/source",
      "https://user:password@example.test/source",
    ];

    for (const unsafeUrl of unsafeUrls) {
      const generatedWebRoot = await mkdtemp(path.join(os.tmpdir(), "murph-health-commons-web-"));
      await mkdir(path.join(generatedWebRoot, "routes"), { recursive: true });
      await mkdir(path.join(generatedWebRoot, "tabs/experiments/finnish-sauna"), {
        recursive: true,
      });
      await writeFile(
        path.join(generatedWebRoot, "routes/index.json"),
        JSON.stringify({
          ...routeIndex,
          routes: [finnishRoute],
        }),
        "utf8",
      );
      const researchTab = JSON.parse(
        readFileSync(
          new URL("../generated/web/tabs/experiments/finnish-sauna/research.json", import.meta.url),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const studies = researchTab["studies"];
      if (!Array.isArray(studies) || typeof studies[0] !== "object" || studies[0] === null) {
        throw new Error("Expected generated Finnish sauna research studies.");
      }
      const firstStudy = studies[0] as Record<string, unknown>;
      await writeFile(
        path.join(generatedWebRoot, "tabs/experiments/finnish-sauna/research.json"),
        JSON.stringify({
          ...researchTab,
          studies: [
            {
              ...firstStudy,
              url: unsafeUrl,
            },
            ...studies.slice(1),
          ],
        }),
        "utf8",
      );

      expect(() => loadGeneratedHealthCommonsWebExperimentResearchTab({
        generatedWebRoot,
        routeId: "finnish-sauna",
      })).toThrow("Health Commons generated experiment research tab is invalid");
    }
  });

  it("rejects unsafe projection paths in generated route indexes", async () => {
    const routeIndex = getGeneratedHealthCommonsWebRouteIndex();
    const finnishRoute = routeIndex.routes.find((entry) =>
      entry.entityType === "protocol_variant" && entry.routeId === "finnish-sauna"
    );
    if (!finnishRoute?.projections) {
      throw new Error("Expected a generated Finnish sauna route with projections.");
    }

    const generatedWebRoot = await mkdtemp(path.join(os.tmpdir(), "murph-health-commons-web-"));
    await mkdir(path.join(generatedWebRoot, "routes"), { recursive: true });
    await writeFile(
      path.join(generatedWebRoot, "routes/index.json"),
      JSON.stringify({
        ...routeIndex,
        routes: [
          {
            ...finnishRoute,
            projections: {
              ...finnishRoute.projections,
              "experiment.research": "../tabs/experiments/norwegian-4x4/research.json",
            },
          },
        ],
      }),
      "utf8",
    );

    expect(() => getGeneratedHealthCommonsWebRouteIndex({ generatedWebRoot }))
      .toThrow("Health Commons generated web route index is invalid.");
  });

  it("rejects projection artifacts whose top-level id no longer matches the route index", async () => {
    const routeIndex = getGeneratedHealthCommonsWebRouteIndex();
    const finnishRoute = routeIndex.routes.find((entry) =>
      entry.entityType === "protocol_variant" && entry.routeId === "finnish-sauna"
    );
    if (!finnishRoute?.projections) {
      throw new Error("Expected a generated Finnish sauna route with projections.");
    }

    const generatedWebRoot = await mkdtemp(path.join(os.tmpdir(), "murph-health-commons-web-"));
    await mkdir(path.join(generatedWebRoot, "routes"), { recursive: true });
    await mkdir(path.join(generatedWebRoot, "shell/experiments"), { recursive: true });
    await writeFile(
      path.join(generatedWebRoot, "routes/index.json"),
      JSON.stringify({
        ...routeIndex,
        routes: [finnishRoute],
      }),
      "utf8",
    );
    const shell = JSON.parse(
      readFileSync(
        new URL("../generated/web/shell/experiments/finnish-sauna.json", import.meta.url),
        "utf8",
      ),
    ) as Record<string, unknown>;
    await writeFile(
      path.join(generatedWebRoot, "shell/experiments/finnish-sauna.json"),
      JSON.stringify({
        ...shell,
        id: "not-finnish-sauna",
      }),
      "utf8",
    );

    expect(() => loadGeneratedHealthCommonsWebExperimentShell({
      generatedWebRoot,
      routeId: "finnish-sauna",
    })).toThrow("projection id does not match route index");
  });

  it("does not publish hidden protocol variants as research-tab projections", () => {
    expect(loadGeneratedHealthCommonsWebExperimentResearchTab({
      routeId: "hydrolyzed-collagen-peptides",
    })).toBeNull();
    expect(loadGeneratedHealthCommonsWebExperimentShell({
      routeId: "hydrolyzed-collagen-peptides",
    })).toBeNull();
    expect(loadGeneratedHealthCommonsWebExperimentProtocolTab({
      routeId: "hydrolyzed-collagen-peptides",
    })).toBeNull();
    expect(loadGeneratedHealthCommonsWebExperimentResultsPublic({
      routeId: "hydrolyzed-collagen-peptides",
    })).toBeNull();
  });

  it("does not include hidden protocol variants in public biomarker route bundles", () => {
    const bundle = loadGeneratedHealthCommonsWebRouteBundle({
      entityType: "biomarker",
      routeId: "musculoskeletal-pain",
    });

    expect(bundle).not.toBeNull();
    expect(bundle?.entitiesByKey).not.toHaveProperty(
      "protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides",
    );
    expect(bundle?.reverseEdges.map((edge) => edge.sourceKey)).not.toContain(
      "protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides",
    );
  });

  it("keeps the Finnish sauna tab projections materially smaller than the route bundle", () => {
    const bundle = readFileSync(
      new URL("../generated/web/bundles/protocol_variant/finnish-sauna.json", import.meta.url),
    );
    const shell = readFileSync(
      new URL("../generated/web/shell/experiments/finnish-sauna.json", import.meta.url),
    );
    const protocolTab = readFileSync(
      new URL("../generated/web/tabs/experiments/finnish-sauna/protocol.json", import.meta.url),
    );
    const resultsPublic = readFileSync(
      new URL("../generated/web/tabs/experiments/finnish-sauna/results-public.json", import.meta.url),
    );
    const researchTab = readFileSync(
      new URL("../generated/web/tabs/experiments/finnish-sauna/research.json", import.meta.url),
    );

    expect(shell.byteLength).toBeLessThan(5_000);
    expect(protocolTab.byteLength).toBeLessThan(30_000);
    expect(resultsPublic.byteLength).toBeLessThan(10_000);
    expect(researchTab.byteLength).toBeLessThan(500_000);
    expect(gzipSync(shell).byteLength).toBeLessThan(2_000);
    expect(gzipSync(protocolTab).byteLength).toBeLessThan(8_000);
    expect(gzipSync(resultsPublic).byteLength).toBeLessThan(4_000);
    expect(gzipSync(researchTab).byteLength).toBeLessThan(90_000);
    expect(bundle.byteLength / researchTab.byteLength).toBeGreaterThan(2);
    expect(bundle.byteLength / protocolTab.byteLength).toBeGreaterThan(80);
    expect(bundle.byteLength / resultsPublic.byteLength).toBeGreaterThan(250);
  });

  it("loads compact protocol artifacts and resolves keys, slugs, and route ids", () => {
    const index = loadGeneratedHealthCommonsProtocolIndex();
    const runSpecs = loadGeneratedHealthCommonsProtocolRunSpecs();
    const familyGraph = loadGeneratedHealthCommonsProtocolFamilyGraph();
    const indexReader = getGeneratedHealthCommonsProtocolIndexReader();
    const runSpecReader = getGeneratedHealthCommonsProtocolRunSpecReader();
    const graphReader = getGeneratedHealthCommonsProtocolFamilyGraphReader();

    expect(index.catalogHash).toBe(runSpecs.catalogHash);
    expect(index.catalogHash).toBe(familyGraph.catalogHash);
    expect(Object.keys(index.protocols[0] ?? {})).toContain("searchText");
    expect(Object.keys(familyGraph.protocols[0] ?? {})).not.toContain("searchText");

    const finnishSauna = indexReader.findByLookup("protocol_variant:finnish-sauna");
    expect(finnishSauna?.key).toBe(
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );

    expect(indexReader.findByLookup("finnish-sauna")?.key).toBe(
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );
    expect(indexReader.findByLookup("PROTOCOL_VARIANT:DRY-SAUNA")?.key).toBe(
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );
    expect(indexReader.findByLookup("protocol_variant%3Afinnish-sauna")?.key).toBe(
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );

    expect(
      indexReader.findByLookup(
        "protocol_variant:sauna/finnish-dry/murph-standard-3x-week",
      )?.key,
    ).toBe("protocol_variant:dry-sauna/murph-finnish-standard-3x-week");

    expect(indexReader.findByLookup("protocols/norwegian-4x4/norwegian-4x4")?.key).toBe(
      "protocol_variant:norwegian-4x4/norwegian-4x4",
    );

    expect(indexReader.findByLookup("/protocols/norwegian-4x4/norwegian-4x4/")?.key)
      .toBe("protocol_variant:norwegian-4x4/norwegian-4x4");
    expect(
      indexReader.findByLookup("PROTOCOL_VARIANT:NORWEGIAN-4X4/NORWEGIAN-4X4")?.key,
    ).toBe("protocol_variant:norwegian-4x4/norwegian-4x4");
    expect(indexReader.findByLookup("norwegian-4x4")?.key).toBe(
      "protocol_variant:norwegian-4x4/norwegian-4x4",
    );

    expect(indexReader.findByLookup("%E0%A4%A")).toBeNull();

    expect(runSpecReader.findByLookup("finnish-sauna")?.protocol).toMatchObject({
      doseSignature: expect.stringContaining("3x/week"),
    });
    expect(
      graphReader.findEntity({
        entityTypes: ["experiment_family"],
        lookup: "dry-sauna",
      })?.key,
    ).toBe("experiment_family:dry-sauna");
    expect(
      graphReader.findEntity({
        entityTypes: ["experiment_family"],
        lookup: "experiment_family:sauna/finnish-dry",
      })?.key,
    ).toBe("experiment_family:dry-sauna");
    expect(
      graphReader.findEntity({
        entityTypes: ["experiment_family", "protocol_variant"],
        lookup: "protocol_variant:dry-sauna",
      })?.key,
    ).toBe("protocol_variant:dry-sauna/murph-finnish-standard-3x-week");
  });

  it("lists compact protocol variants deterministically", () => {
    const indexReader = getGeneratedHealthCommonsProtocolIndexReader();
    const runSpecReader = getGeneratedHealthCommonsProtocolRunSpecReader();

    const protocols = indexReader.listProtocols({ limit: 6 });
    expect(protocols.map((protocol) => protocol.key)).toEqual([
      "protocol_variant:static-stretching/at-home-static-stretching-for-flexibility",
      "protocol_variant:dry-sauna/bryan-johnson-blueprint",
      "protocol_variant:caffeine-timing/caffeine-curfew-dose-reset",
      "protocol_variant:cold-water-immersion/cold-plunge",
      "protocol_variant:consistent-wake-time/consistent-wake-time",
      "protocol_variant:daily-step-floor/daily-step-floor",
    ]);
    expect(Object.keys(protocols[0] ?? {})).not.toContain("body");
    expect(Object.keys(protocols[0] ?? {})).not.toContain("protocol");
    expect(protocols[0]?.revision.runSpecRevisionId).toEqual(expect.stringMatching(/^sha256:/u));
    const finnishSauna = runSpecReader.findByLookup(
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );
    expect(finnishSauna?.protocol).toMatchObject({
      doseSignature: expect.stringContaining("3x/week"),
    });
    expect(
      indexReader.findByLookup("protocol_variant:creatine-supplementation/creatine-monohydrate"),
    ).toBeNull();
    expect(
      runSpecReader.findByLookup("protocol_variant:creatine-supplementation/creatine-monohydrate"),
    ).toBeNull();
  });

  it("filters compact protocol index entries by query and category", () => {
    const reader = getGeneratedHealthCommonsProtocolIndexReader();

    const protocolResults = reader.listProtocols({
      categories: ["passive heat"],
      limit: 5,
      query: "sauna",
    });

    expect(protocolResults.map((protocol) => protocol.key)).toContain(
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );
    expect(
      protocolResults.every((protocol) => protocol.entityType === "protocol_variant"),
    ).toBe(true);

    const bodyFieldResults = reader.listProtocols({
      limit: 10,
      query: "RPE",
    }).map((protocol) => protocol.key);
    expect(bodyFieldResults).toContain("protocol_variant:norwegian-4x4/norwegian-4x4");
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

  it("normalizes wildcard filters for compact protocol lists", () => {
    const reader = getGeneratedHealthCommonsProtocolIndexReader();

    const wildcardStatusProtocolKeys = reader.listProtocols({
      limit: 20,
      query: "sauna",
      statuses: ["*"],
    }).map((protocol) => protocol.key);
    expect(wildcardStatusProtocolKeys).toContain(
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );

    const wildcardCategoryProtocolKeys = reader.listProtocols({
      categories: ["*"],
      limit: 20,
      query: "sauna",
    }).map((protocol) => protocol.key);
    expect(wildcardCategoryProtocolKeys).toContain(
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );

    const spacedCategoryKeys = reader.listProtocols({
      categories: ["passive heat"],
      limit: 500,
    }).map((protocol) => protocol.key);
    const slugCategoryKeys = reader.listProtocols({
      categories: ["passive-heat"],
      limit: 500,
    }).map((protocol) => protocol.key);
    expect(spacedCategoryKeys).toEqual(slugCategoryKeys);

    const listKeys = reader.listProtocols({
      limit: 500,
      query: "sauna",
    }).map((protocol) => protocol.key);
    expect(listKeys).toContain("protocol_variant:dry-sauna/murph-finnish-standard-3x-week");

    expect(reader.normalizeListOptions({
      categories: ["*"],
      limit: 20,
      query: "Sauna",
      statuses: ["*"],
    })).toMatchObject({
      categories: [],
      ignoredWildcards: {
        categories: ["*"],
        statuses: ["*"],
      },
      query: "sauna",
      statuses: [],
    });

    expect(() => reader.listProtocols({
      statuses: ["active"],
    })).toThrow(/Unknown Health Commons status filter\. Expected one of:/u);
  });

  it("resolves compact protocol family graph relations", () => {
    const reader = getGeneratedHealthCommonsProtocolFamilyGraphReader();
    const protocol = reader.findEntity({
      entityTypes: ["protocol_variant"],
      lookup: "finnish-sauna",
    });
    expect(protocol).not.toBeNull();

    if (!protocol || protocol.entityType !== "protocol_variant") {
      throw new Error("Expected Finnish sauna protocol in compact family graph.");
    }

    expect(protocol.key).toBe(
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );
    expect(reader.parentFamilies(protocol).map((family) => family.key)).toContain(
      "experiment_family:dry-sauna",
    );

    const family = reader.findEntity({
      entityTypes: ["experiment_family"],
      lookup: "dry-sauna",
    });
    if (!family || family.entityType !== "experiment_family") {
      throw new Error("Expected dry-sauna family in compact family graph.");
    }
    const familyVariantKeys = reader.protocolVariantsForFamily(family).map((variant) => variant.key);
    expect(familyVariantKeys).toContain(
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );
    expect(familyVariantKeys).toContain(
      "protocol_variant:dry-sauna/bryan-johnson-blueprint",
    );

    const bodyFieldMatches = reader.listProtocolMatches({
      limit: 10,
      lookup: "RPE",
    }).map((match) => match.protocol.key);
    expect(bodyFieldMatches).toContain("protocol_variant:norwegian-4x4/norwegian-4x4");
  });
});

const RESEARCH_STUDY_PROJECTION_KEYS = new Set<string>([
  "authors",
  "caveat",
  "designLabel",
  "displayPriority",
  "duration",
  "finding",
  "findingKind",
  "groupId",
  "headline",
  "implication",
  "includedStudyCount",
  "journal",
  "participantCountKind",
  "participants",
  "population",
  "result",
  "scope",
  "stance",
  "title",
  "type",
  "url",
  "year",
]);
