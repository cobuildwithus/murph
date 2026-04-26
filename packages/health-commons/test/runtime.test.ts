import { describe, expect, it } from "vitest";

import {
  createHealthCommonsCatalogReader,
  getGeneratedHealthCommonsCatalogReader,
  loadGeneratedHealthCommonsCatalog,
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
  it("loads the generated catalog and resolves keys, slugs, and route ids", () => {
    const catalog = loadGeneratedHealthCommonsCatalog();
    const reader = createHealthCommonsCatalogReader(catalog);

    expect(reader.catalogHash).toBe(catalog.catalogHash);

    const finnishSauna = reader.findByKey("protocol_variant:finnish-sauna");
    expect(finnishSauna?.key).toBe(
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );

    expect(
      reader.findByRouteId({
        entityType: "protocol_variant",
        routeId: "finnish-sauna",
      })?.key,
    ).toBe("protocol_variant:dry-sauna/murph-finnish-standard-3x-week");

    expect(reader.findBySlug("protocols/norwegian-4x4/norwegian-4x4")?.key).toBe(
      "protocol_variant:norwegian-4x4/norwegian-4x4",
    );

    expect(
      reader.findByRouteId({
        entityType: "protocol_variant",
        routeId: "/protocols/norwegian-4x4/norwegian-4x4/",
      })?.key,
    ).toBe("protocol_variant:norwegian-4x4/norwegian-4x4");

    const { findByRouteId } = reader;
    expect(
      findByRouteId({
        entityType: "protocol_variant",
        routeId: "norwegian-4x4",
      })?.key,
    ).toBe("protocol_variant:norwegian-4x4/norwegian-4x4");

    expect(
      reader.findByRouteId({
        entityType: "protocol_variant",
        routeId: "%E0%A4%A",
      }),
    ).toBeNull();
  });

  it("lists compact protocol variants and source artifacts deterministically", () => {
    const reader = getGeneratedHealthCommonsCatalogReader();

    const protocols = reader.listProtocolVariants({ limit: 6 });
    expect(protocols.map((protocol) => protocol.key)).toEqual([
      "protocol_variant:cold-water-immersion/cold-plunge",
      "protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides",
      "protocol_variant:consistent-wake-time/consistent-wake-time",
      "protocol_variant:creatine-supplementation/creatine-monohydrate",
      "protocol_variant:dry-sauna/bryan-johnson-blueprint",
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    ]);
    expect(Object.keys(protocols[0] ?? {})).not.toContain("body");
    expect(protocols[5]?.protocol).toMatchObject({
      doseSignature: expect.stringContaining("3x/week"),
      runSpecRevisionId: expect.stringMatching(/^sha256:/u),
    });
    expect(protocols[5]?.routeIds).toContain("finnish-sauna");

    const saunaSources = reader.listSourceArtifacts({
      categories: ["sauna"],
      limit: 2,
    });
    expect(saunaSources).toHaveLength(2);
    expect(saunaSources.every((source) => source.entityType === "source_artifact")).toBe(true);
    expect(saunaSources.every((source) => source.categories.includes("sauna"))).toBe(true);

    expect(reader.listSourceArtifacts({ limit: 500 }).length).toBeGreaterThan(100);
  });

  it("searches by query, category, and entity type with compact results", () => {
    const reader = getGeneratedHealthCommonsCatalogReader();

    const protocolResults = reader.search({
      categories: ["passive heat"],
      entityTypes: ["protocol_variant"],
      limit: 5,
      query: "sauna",
    });

    expect(protocolResults.map((result) => result.entity.key)).toContain(
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );
    expect(
      protocolResults.every((result) => result.entity.entityType === "protocol_variant"),
    ).toBe(true);
    expect(protocolResults[0]?.score).toBeGreaterThanOrEqual(protocolResults.at(-1)?.score ?? 0);

    const sourceResults = reader.search({
      entityTypes: ["source_artifact"],
      limit: 1,
      query: "25705824",
    });

    expect(sourceResults[0]).toMatchObject({
      entity: {
        key: "source_artifact:pmid-25705824",
        source: {
          pmid: "25705824",
        },
      },
      matchedFields: expect.arrayContaining(["source"]),
    });
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

  it("normalizes wildcard filters and keeps protocol search/list semantics aligned", () => {
    const reader = getGeneratedHealthCommonsCatalogReader();

    const wildcardStatusProtocolKeys = reader.listProtocolVariants({
      limit: 20,
      query: "sauna",
      statuses: ["*"],
    }).map((protocol) => protocol.key);
    expect(wildcardStatusProtocolKeys).toContain(
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );

    const wildcardCategoryProtocolKeys = reader.listProtocolVariants({
      categories: ["*"],
      limit: 20,
      query: "sauna",
    }).map((protocol) => protocol.key);
    expect(wildcardCategoryProtocolKeys).toContain(
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );
    expect(reader.listSourceArtifacts({
      candidateKeys: [],
      limit: 500,
    })).toEqual([]);

    const spacedCategoryKeys = reader.listProtocolVariants({
      categories: ["passive heat"],
      limit: 500,
    }).map((protocol) => protocol.key);
    const slugCategoryKeys = reader.listProtocolVariants({
      categories: ["passive-heat"],
      limit: 500,
    }).map((protocol) => protocol.key);
    expect(spacedCategoryKeys).toEqual(slugCategoryKeys);

    const searchKeys = reader.search({
      entityTypes: ["protocol_variant"],
      includeBody: true,
      limit: 500,
      query: "sauna",
    }).map((result) => result.entity.key);
    const listKeys = reader.listProtocolVariants({
      limit: 500,
      query: "sauna",
    }).map((protocol) => protocol.key);
    expect(listKeys).toEqual(searchKeys);

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

    expect(() => reader.listProtocolVariants({
      statuses: ["active"],
    })).toThrow(/Unknown Health Commons status filter\. Expected one of:/u);
  });

  it("resolves compact relations and source context for assistant tools", () => {
    const reader = getGeneratedHealthCommonsCatalogReader();
    const protocol = reader.findByRouteId({
      entityType: "protocol_variant",
      routeId: "finnish-sauna",
    });
    expect(protocol).not.toBeNull();

    const context = reader.resolveEntityContext({
      entity: protocol?.key ?? "",
      relationLimit: 4,
      relationTypes: ["parent_family", "primary_biomarker", "secondary_biomarker"],
      sourceLimit: 5,
    });

    expect(context?.entity.key).toBe(
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );
    expect(context?.relations.map((entry) => entry.relation.type)).toEqual([
      "parent_family",
      "primary_biomarker",
      "secondary_biomarker",
      "secondary_biomarker",
    ]);
    expect(context?.sources).toHaveLength(5);
    expect(context?.sources.every((entry) => entry.source.entityType === "source_artifact")).toBe(true);
    expect(context?.sources[0]?.reasons[0]).toMatchObject({
      claimId: "research-base-is-broad-but-mixed",
      kind: "claim",
    });

    const sourceContext = reader.resolveEntityContext({
      entity: "source_artifact:pmid-25705824",
      sourceLimit: 1,
    });

    expect(sourceContext?.sources[0]).toMatchObject({
      reasons: [
        {
          kind: "self",
        },
      ],
      source: {
        key: "source_artifact:pmid-25705824",
      },
    });

    const hyperbaric = reader.findByKey(
      "protocol_variant:hyperbaric-oxygen-therapy/hyperbaric-oxygen-therapy",
    );
    expect(hyperbaric).not.toBeNull();
    expect(reader.resolveSources({ entity: hyperbaric?.key ?? "", limit: 500 }).length)
      .toBeGreaterThan(100);
    expect(reader.collectSourceKeys({ entity: hyperbaric }).length).toBeGreaterThan(100);
    expect(reader.collectSourceKeys({ entity: "source_artifact:pmid-25705824" })).toEqual([]);
    expect(
      reader.collectSourceKeys({
        entity: "source_artifact:pmid-25705824",
        includeSelf: true,
      }),
    ).toEqual(["source_artifact:pmid-25705824"]);
  });
});
