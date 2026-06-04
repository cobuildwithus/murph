import { describe, expect, it } from "vitest";

import {
  HEALTH_COMMONS_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
  type HealthCommonsArtifactManifest,
  type HealthCommonsPageFrontmatter,
} from "@murphai/contracts";
import {
  buildHealthCommonsCatalogFromContent,
  buildHealthCommonsSourceArtifactIndex,
  buildHealthCommonsSourceIndex,
  collectArtifactPointers,
  sortChangesById,
  sortRedirects,
  validateHealthCommonsContent,
} from "../src/catalog.ts";
import type { HealthCommonsContentSet, HealthCommonsSourcePage } from "../src/load.ts";

const biomarkerPage: HealthCommonsSourcePage = {
  body: "Biomarker body",
  rawFrontmatter: null,
  relativePath: "biomarkers/example.md",
  frontmatter: {
    schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
    entityType: "biomarker",
    key: "biomarker:example",
    slug: "biomarkers/example",
    title: "Example biomarker",
  },
};

const measurementMethodPage: HealthCommonsSourcePage = {
  body: "Measurement method body",
  rawFrontmatter: null,
  relativePath: "measurement-methods/example.md",
  frontmatter: {
    schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
    entityType: "measurement_method",
    key: "measurement_method:example",
    slug: "measurement-methods/example",
    title: "Example measurement method",
    measurementMethod: {
      tier: "optional_home",
      modalities: ["standardized_photo", "image_analysis"],
      measuredBiomarkerKeys: ["biomarker:example"],
      outputs: [
        {
          outputId: "example_output",
          label: "Example output",
          valueType: "score",
          mapsToBiomarkerKey: "biomarker:example",
          direction: "lower_or_stable",
        },
      ],
      procedure: {
        summary: "Measure the same outcome with a repeatable method.",
        steps: ["Record the same measurement repeatedly."],
      },
      privacy: {
        containsIdentifiableImages: true,
        localOnlyRecommended: true,
      },
    },
  },
};

const sourcePage = (key: string, slug: string): HealthCommonsSourcePage => ({
  body: "Source body",
  rawFrontmatter: null,
  relativePath: `sources/${slug}.md`,
  frontmatter: {
    schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
    entityType: "source_artifact",
    key,
    slug: `sources/${slug}`,
    title: slug,
    source: {
      kind: "web_page",
      url: `https://example.com/${slug}`,
    },
  },
});

const protocolPage = (key: string, title: string, withRelation = false): HealthCommonsSourcePage => ({
  body: "Protocol body",
  rawFrontmatter: null,
  relativePath: `protocols/${title}.md`,
  frontmatter: {
    schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
    entityType: "protocol_variant",
    key,
    slug: `protocols/${title}`,
    title,
    lineage: {
      relationship: "root",
    },
    attribution: {
      ownerType: "murph",
    },
    protocol: {
      doseSignature: "10m at 90C",
    },
    safety: {
      cautionLevel: "low",
    },
    testPlans: [
      {
        planId: `${title}-plan`,
        durationDays: 7,
        baselineDays: 3,
        interventionDays: 4,
        primaryBiomarkerKey: "biomarker:example",
      },
    ],
    ...(withRelation
      ? {
          relations: [
            {
              type: "related_protocol",
              target: key,
            },
          ],
        }
      : {}),
  } satisfies HealthCommonsPageFrontmatter,
});

const artifactManifest = {
  schemaVersion: HEALTH_COMMONS_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  manifestKey: "source_artifact:example/research-artifacts",
  artifacts: [
    {
      artifactId: "art_example_pdf",
      kind: "pdf",
      storage: "cloudflare-r2",
      objectKey: "commons/research/example/source.pdf",
      localPath: "research-artifacts/example.pdf",
      rightsStatus: "permission_required",
      redistributable: false,
    },
  ],
} satisfies HealthCommonsArtifactManifest;

describe("@murphai/health-commons catalog coverage", () => {
  it("covers the collection and sorting helpers", () => {
    expect(
      collectArtifactPointers([artifactManifest]).map(({ artifact }) => artifact.artifactId),
    ).toEqual(["art_example_pdf"]);
    expect(
      sortChangesById([
        {
          schemaVersion: "murph.commons.change.v1",
          changeId: "b-change",
          entityKey: "source_artifact:example",
          changeType: "artifact_change",
          minor: false,
          editSummary: "b",
        },
        {
          schemaVersion: "murph.commons.change.v1",
          changeId: "a-change",
          entityKey: "source_artifact:example",
          changeType: "artifact_change",
          minor: false,
          editSummary: "a",
        },
      ]).map((change) => change.changeId),
    ).toEqual(["a-change", "b-change"]);
    expect(
      sortRedirects([
        { from: "b", to: "target-b" },
        { from: "a", to: "target-a" },
      ]).map((redirect) => redirect.from),
    ).toEqual(["a", "b"]);
  });

  it("allows duplicate source keys and aliases from imported source copies", () => {
    const duplicateKeyContent: HealthCommonsContentSet = {
      artifactManifests: [],
      changes: [],
      evidenceAppraisals: [],
      redirects: [],
      pages: [sourcePage("source_artifact:example", "one"), sourcePage("source_artifact:example", "two")],
    };

    expect(() => validateHealthCommonsContent(duplicateKeyContent)).not.toThrow();

    const duplicateAliasPage = sourcePage("source_artifact:example-two", "two");
    duplicateAliasPage.frontmatter.aliases = ["Example Alias"];
    const duplicateAliasContent: HealthCommonsContentSet = {
      artifactManifests: [],
      changes: [],
      evidenceAppraisals: [],
      redirects: [],
      pages: [
        {
          ...sourcePage("source_artifact:example-one", "one"),
          frontmatter: {
            ...sourcePage("source_artifact:example-one", "one").frontmatter,
            aliases: ["Example Alias"],
          },
        },
        duplicateAliasPage,
      ],
    };

    expect(() => validateHealthCommonsContent(duplicateAliasContent)).not.toThrow();
  });

  it("rejects missing targets and duplicate recipe hashes without explicit relations", () => {
    const missingTargetContent: HealthCommonsContentSet = {
      artifactManifests: [],
      changes: [],
      evidenceAppraisals: [],
      redirects: [],
      pages: [
        biomarkerPage,
        {
          ...protocolPage("protocol_variant:dry-sauna/one", "one"),
          frontmatter: {
            ...protocolPage("protocol_variant:dry-sauna/one", "one").frontmatter,
            relations: [
              {
                type: "related_protocol",
                target: "protocol_variant:missing",
              },
            ],
          },
        },
      ],
    };

    expect(() => validateHealthCommonsContent(missingTargetContent)).toThrow(
      "points to missing health commons target protocol_variant:missing",
    );

    const duplicateRecipeContent: HealthCommonsContentSet = {
      artifactManifests: [],
      changes: [],
      evidenceAppraisals: [],
      redirects: [],
      pages: [
        biomarkerPage,
        protocolPage("protocol_variant:dry-sauna/one", "one"),
        protocolPage("protocol_variant:dry-sauna/two", "two"),
      ],
    };

    expect(() => validateHealthCommonsContent(duplicateRecipeContent)).toThrow(
      /Duplicate protocol recipeHash/u,
    );
  });

  it("rejects non-biomarker test-plan, measurement-plan, and measurement-method targets", () => {
    const methodAsBiomarkerContent: HealthCommonsContentSet = {
      artifactManifests: [],
      changes: [],
      evidenceAppraisals: [],
      redirects: [],
      pages: [
        biomarkerPage,
        measurementMethodPage,
        {
          ...protocolPage("protocol_variant:dry-sauna/one", "one"),
          frontmatter: {
            ...protocolPage("protocol_variant:dry-sauna/one", "one").frontmatter,
            testPlans: [
              {
                planId: "method-as-biomarker",
                durationDays: 7,
                baselineDays: 3,
                interventionDays: 4,
                primaryBiomarkerKey: "measurement_method:example",
              },
            ],
          },
        },
      ],
    };

    expect(() => validateHealthCommonsContent(methodAsBiomarkerContent)).toThrow(
      "primaryBiomarkerKey must point to biomarker",
    );

    const secondaryBiomarkerAsMethodContent: HealthCommonsContentSet = {
      artifactManifests: [],
      changes: [],
      evidenceAppraisals: [],
      redirects: [],
      pages: [
        biomarkerPage,
        measurementMethodPage,
        {
          ...protocolPage("protocol_variant:dry-sauna/one", "one"),
          frontmatter: {
            ...protocolPage("protocol_variant:dry-sauna/one", "one").frontmatter,
            testPlans: [
              {
                ...protocolPage("protocol_variant:dry-sauna/one", "one").frontmatter.testPlans![0]!,
                secondaryBiomarkerKeys: ["measurement_method:example"],
              },
            ],
          },
        },
      ],
    };

    expect(() => validateHealthCommonsContent(secondaryBiomarkerAsMethodContent)).toThrow(
      "secondaryBiomarkerKeys must point to biomarker",
    );

    const safetyOutcomeAsMethodContent: HealthCommonsContentSet = {
      artifactManifests: [],
      changes: [],
      evidenceAppraisals: [],
      redirects: [],
      pages: [
        biomarkerPage,
        measurementMethodPage,
        {
          ...protocolPage("protocol_variant:dry-sauna/one", "one"),
          frontmatter: {
            ...protocolPage("protocol_variant:dry-sauna/one", "one").frontmatter,
            testPlans: [
              {
                ...protocolPage("protocol_variant:dry-sauna/one", "one").frontmatter.testPlans![0]!,
                safetyOutcomeKeys: ["measurement_method:example"],
              },
            ],
          },
        },
      ],
    };

    expect(() => validateHealthCommonsContent(safetyOutcomeAsMethodContent)).toThrow(
      "safetyOutcomeKeys must point to biomarker",
    );

    const validMeasurementPlanContent: HealthCommonsContentSet = {
      artifactManifests: [],
      changes: [],
      evidenceAppraisals: [],
      redirects: [],
      pages: [
        biomarkerPage,
        measurementMethodPage,
        {
          ...protocolPage("protocol_variant:dry-sauna/one", "one"),
          frontmatter: {
            ...protocolPage("protocol_variant:dry-sauna/one", "one").frontmatter,
            measurementPlan: {
              schemaVersion: "murph.commons.measurement-plan.v1",
              defaultPathId: "home-photo-score",
              paths: [
                {
                  pathId: "home-photo-score",
                  label: "Home photo score",
                  tier: "default_home",
                  required: true,
                  methodKeys: ["measurement_method:example"],
                  outcomeKeys: ["biomarker:example"],
                },
              ],
            },
          },
        },
      ],
    };

    expect(() => validateHealthCommonsContent(validMeasurementPlanContent)).not.toThrow();

    const biomarkerAsMethodContent: HealthCommonsContentSet = {
      ...validMeasurementPlanContent,
      pages: validMeasurementPlanContent.pages.map((page) =>
        page.frontmatter.entityType === "protocol_variant"
          ? {
              ...page,
              frontmatter: {
                ...page.frontmatter,
                measurementPlan: {
                  schemaVersion: "murph.commons.measurement-plan.v1",
                  defaultPathId: "home-photo-score",
                  paths: [
                    {
                      pathId: "home-photo-score",
                      label: "Home photo score",
                      tier: "default_home",
                      required: true,
                      methodKeys: ["biomarker:example"],
                      outcomeKeys: ["biomarker:example"],
                    },
                  ],
                },
              },
            }
          : page,
      ),
    };

    expect(() => validateHealthCommonsContent(biomarkerAsMethodContent)).toThrow(
      "measurementPlan path home-photo-score methodKeys must point to measurement_method",
    );

    const measurementPlanOutcomeAsMethodContent: HealthCommonsContentSet = {
      artifactManifests: [],
      changes: [],
      evidenceAppraisals: [],
      redirects: [],
      pages: [
        biomarkerPage,
        measurementMethodPage,
        {
          ...protocolPage("protocol_variant:dry-sauna/one", "one"),
          frontmatter: {
            ...protocolPage("protocol_variant:dry-sauna/one", "one").frontmatter,
            measurementPlan: {
              schemaVersion: "murph.commons.measurement-plan.v1",
              defaultPathId: "home-photo-score",
              paths: [
                {
                  pathId: "home-photo-score",
                  label: "Home photo score",
                  tier: "default_home",
                  required: true,
                  methodKeys: ["measurement_method:example"],
                  outcomeKeys: ["measurement_method:example"],
                },
              ],
            },
          },
        },
      ],
    };

    expect(() => validateHealthCommonsContent(measurementPlanOutcomeAsMethodContent)).toThrow(
      "measurementPlan path home-photo-score outcomeKeys must point to biomarker",
    );

    const measurementPlanSafetyAsMethodContent: HealthCommonsContentSet = {
      artifactManifests: [],
      changes: [],
      evidenceAppraisals: [],
      redirects: [],
      pages: [
        biomarkerPage,
        measurementMethodPage,
        {
          ...protocolPage("protocol_variant:dry-sauna/one", "one"),
          frontmatter: {
            ...protocolPage("protocol_variant:dry-sauna/one", "one").frontmatter,
            measurementPlan: {
              schemaVersion: "murph.commons.measurement-plan.v1",
              defaultPathId: "home-photo-score",
              paths: [
                {
                  pathId: "home-photo-score",
                  label: "Home photo score",
                  tier: "default_home",
                  required: true,
                  methodKeys: ["measurement_method:example"],
                  safetyOutcomeKeys: ["measurement_method:example"],
                },
              ],
            },
          },
        },
      ],
    };

    expect(() => validateHealthCommonsContent(measurementPlanSafetyAsMethodContent)).toThrow(
      "measurementPlan path home-photo-score safetyOutcomeKeys must point to biomarker",
    );

    const measurementMethodOutputAsMethodContent: HealthCommonsContentSet = {
      artifactManifests: [],
      changes: [],
      evidenceAppraisals: [],
      redirects: [],
      pages: [
        biomarkerPage,
        {
          ...measurementMethodPage,
          frontmatter: {
            ...measurementMethodPage.frontmatter,
            measurementMethod: {
              ...measurementMethodPage.frontmatter.measurementMethod!,
              outputs: [
                {
                  ...measurementMethodPage.frontmatter.measurementMethod!.outputs[0]!,
                  mapsToBiomarkerKey: "measurement_method:example",
                },
              ],
            },
          },
        },
      ],
    };

    expect(() => validateHealthCommonsContent(measurementMethodOutputAsMethodContent)).toThrow(
      "measurementMethod output example_output must point to biomarker",
    );

  });

  it("rejects experiment onboarding plan defaults that point to a missing test plan", () => {
    const onboardingPlanMismatchContent: HealthCommonsContentSet = {
      artifactManifests: [],
      changes: [],
      evidenceAppraisals: [],
      redirects: [],
      pages: [
        biomarkerPage,
        {
          ...protocolPage("protocol_variant:norwegian-4x4/example", "norwegian"),
          frontmatter: {
            ...protocolPage("protocol_variant:norwegian-4x4/example", "norwegian").frontmatter,
            experimentOnboarding: {
              schemaVersion: "murph.commons.experiment-onboarding.v2",
              startIntent: {
                displayPrompt: "Explore Norwegian 4x4",
                intentSummary: "Explore Norwegian 4x4",
              },
              planDefaults: {
                testPlanId: "missing-test-plan",
              },
            },
          },
        },
      ],
    };

    expect(() => validateHealthCommonsContent(onboardingPlanMismatchContent)).toThrow(
      "experimentOnboarding planDefaults.testPlanId points to missing test plan missing-test-plan",
    );
  });

  it("allows grouped research sources without matching standalone evidence appraisals", () => {
    const groupedCoverageMismatchContent: HealthCommonsContentSet = {
      artifactManifests: [],
      changes: [],
      evidenceAppraisals: [],
      redirects: [],
      pages: [
        biomarkerPage,
        sourcePage("source_artifact:sauna/example", "sauna-example"),
        {
          ...protocolPage("protocol_variant:dry-sauna/example", "dry-sauna-example"),
          frontmatter: {
            ...protocolPage("protocol_variant:dry-sauna/example", "dry-sauna-example").frontmatter,
            researchLandscape: {
              bottomLine: "Grouped evidence should be internally aligned.",
              confidenceLabel: "mixed",
              primaryClaim: "Only group-covered sources should appear in grouped research.",
              mainCaveat: "Standalone appraisals can be added later.",
              groups: [
                {
                  id: "expected-group",
                  label: "Expected group",
                  stance: "supports",
                  summary: "A grouped source can be represented by page-level findings first.",
                  sourceKeys: ["source_artifact:sauna/example"],
                },
              ],
            },
          },
        },
      ],
    };

    expect(() => validateHealthCommonsContent(groupedCoverageMismatchContent)).not.toThrow();
  });

  it("requires explicit relations for duplicate source identities", () => {
    const firstSource = {
      ...sourcePage("source_artifact:example/one", "example-one"),
      frontmatter: {
        ...sourcePage("source_artifact:example/one", "example-one").frontmatter,
        source: {
          kind: "journal_article",
          doi: "10.1000/Example",
          url: "https://doi.org/10.1000/Example",
        },
      },
    } satisfies HealthCommonsSourcePage;
    const secondSource = {
      ...sourcePage("source_artifact:example/two", "example-two"),
      frontmatter: {
        ...sourcePage("source_artifact:example/two", "example-two").frontmatter,
        source: {
          kind: "journal_article",
          doi: "https://doi.org/10.1000/example",
          url: "https://example.com/secondary",
        },
      },
    } satisfies HealthCommonsSourcePage;
    const duplicateIdentityContent: HealthCommonsContentSet = {
      artifactManifests: [],
      changes: [],
      evidenceAppraisals: [],
      redirects: [],
      pages: [firstSource, secondSource],
    };

    expect(() => validateHealthCommonsContent(duplicateIdentityContent)).toThrow(
      /Duplicate Health Commons source identity/u,
    );

    const explicitlyRelatedContent: HealthCommonsContentSet = {
      ...duplicateIdentityContent,
      pages: [
        firstSource,
        {
          ...secondSource,
          frontmatter: {
            ...secondSource.frontmatter,
            relations: [
              {
                type: "same_work_as",
                target: "source_artifact:example/one",
              },
            ],
          },
        },
      ],
    };

    expect(() => validateHealthCommonsContent(explicitlyRelatedContent)).not.toThrow();
  });

  it("lets standalone evidence appraisals satisfy research landscape groups", () => {
    const content: HealthCommonsContentSet = {
      artifactManifests: [],
      changes: [],
      evidenceAppraisals: [
        {
          schemaVersion: "murph.commons.evidence-appraisal.v1",
          key: "evidence_appraisal:sauna-example",
          sourceKey: "source_artifact:sauna/example",
          targetKey: "protocol_variant:dry-sauna/example",
          targetKind: "protocol_variant",
          groupId: "expected-group",
          stance: "supports",
          scope: "direct_protocol",
          result: "positive",
          headline: "Example headline",
          implication: "Example implication",
        },
      ],
      redirects: [],
      pages: [
        biomarkerPage,
        sourcePage("source_artifact:sauna/example", "sauna-example"),
        {
          ...protocolPage("protocol_variant:dry-sauna/example", "dry-sauna-example"),
          frontmatter: {
            ...protocolPage("protocol_variant:dry-sauna/example", "dry-sauna-example").frontmatter,
            researchLandscape: {
              bottomLine: "Grouped evidence should be internally aligned.",
              confidenceLabel: "mixed",
              primaryClaim: "Standalone appraisals can own the protocol-specific edge.",
              mainCaveat: "The source page can stay source-owned.",
              groups: [
                {
                  id: "expected-group",
                  label: "Expected group",
                  stance: "supports",
                  summary: "A matching standalone edge should satisfy this group.",
                  sourceKeys: ["source_artifact:sauna/example"],
                },
              ],
            },
          },
        },
      ],
    };

    expect(() => validateHealthCommonsContent(content)).not.toThrow();
  });

  it("validates standalone evidence appraisal identity and reference targets", () => {
    const source = {
      ...sourcePage("source_artifact:sauna/example", "sauna-example"),
      frontmatter: {
        ...sourcePage("source_artifact:sauna/example", "sauna-example").frontmatter,
        sourceFindings: [
          {
            findingId: "finding:sauna/example-summary",
            findingKind: "context",
            summary: "Reusable source finding.",
          },
        ],
      },
    } satisfies HealthCommonsSourcePage;
    const protocol = protocolPage("protocol_variant:dry-sauna/example", "dry-sauna-example", true);
    const baseContent: HealthCommonsContentSet = {
      artifactManifests: [],
      changes: [],
      evidenceAppraisals: [],
      redirects: [],
      pages: [biomarkerPage, source, protocol],
    };
    const appraisal = {
      schemaVersion: "murph.commons.evidence-appraisal.v1",
      key: "evidence_appraisal:sauna-example",
      sourceKey: "source_artifact:sauna/example",
      targetKey: "protocol_variant:dry-sauna/example",
      targetKind: "protocol_variant",
      groupId: "expected-group",
      stance: "supports",
      scope: "direct_protocol",
      result: "positive",
      headline: "Example headline",
      implication: "Example implication",
    } as const;

    expect(() =>
      validateHealthCommonsContent({
        ...baseContent,
        evidenceAppraisals: [appraisal, appraisal],
      }),
    ).toThrow("Duplicate evidence appraisal key evidence_appraisal:sauna-example");

    expect(() =>
      validateHealthCommonsContent({
        ...baseContent,
        evidenceAppraisals: [
          {
            ...appraisal,
            key: "evidence_appraisal:sauna-example:bad-kind",
            targetKind: "source_artifact",
          },
        ],
      }),
    ).toThrow("targetKind source_artifact does not match protocol_variant:dry-sauna/example entityType protocol_variant");

    expect(() =>
      validateHealthCommonsContent({
        ...baseContent,
        evidenceAppraisals: [
          {
            ...appraisal,
            key: "evidence_appraisal:sauna-example:freeform-endpoint",
            endpointKeys: ["biomarker:generated-taxonomy-token"],
          },
        ],
      }),
    ).not.toThrow();

    expect(() =>
      validateHealthCommonsContent({
        ...baseContent,
        evidenceAppraisals: [
          {
            ...appraisal,
            key: "evidence_appraisal:sauna-example:wrong-endpoint-kind",
            endpointKeys: ["source_artifact:sauna/example"],
          },
        ],
      }),
    ).toThrow("endpointKeys must point to biomarker");

    expect(() =>
      validateHealthCommonsContent({
        ...baseContent,
        evidenceAppraisals: [
          {
            ...appraisal,
            key: "evidence_appraisal:sauna-example:missing-finding",
            findingKeys: ["finding:sauna/missing"],
          },
        ],
      }),
    ).not.toThrow();

    expect(() =>
      validateHealthCommonsContent({
        ...baseContent,
        pages: [
          biomarkerPage,
          source,
          {
            ...sourcePage("source_artifact:sauna/wrong-owner", "sauna-wrong-owner"),
            frontmatter: {
              ...sourcePage("source_artifact:sauna/wrong-owner", "sauna-wrong-owner").frontmatter,
              sourceFindings: [
                {
                  findingId: "finding:sauna/wrong-owner",
                  sourceKey: "source_artifact:sauna/example",
                  findingKind: "context",
                  summary: "This finding was assigned to the wrong source page.",
                },
              ],
            },
          },
          protocol,
        ],
      }),
    ).toThrow(
      "source_artifact:sauna/wrong-owner sourceFindings finding:sauna/wrong-owner belongs to source_artifact:sauna/example; source-owned findings must live on their owning source page.",
    );

    expect(() =>
      validateHealthCommonsContent({
        ...baseContent,
        pages: [
          biomarkerPage,
          source,
          {
            ...protocol,
            frontmatter: {
              ...protocol.frontmatter,
              sourceFindings: [
                {
                  findingId: "finding:sauna/protocol-owned",
                  sourceKey: "source_artifact:sauna/example",
                  findingKind: "context",
                  summary: "Protocol page must not own source findings.",
                },
              ],
            },
          },
        ],
      }),
    ).toThrow(
      "protocol_variant:dry-sauna/example sourceFindings finding:sauna/protocol-owned belongs to source_artifact:sauna/example; source-owned findings must live on their owning source page.",
    );

    const protocolWithLandscape = {
      ...protocolPage("protocol_variant:dry-sauna/example", "dry-sauna-example"),
      frontmatter: {
        ...protocolPage("protocol_variant:dry-sauna/example", "dry-sauna-example").frontmatter,
        researchLandscape: {
          bottomLine: "Standalone appraisals must align to landscape groups.",
          confidenceLabel: "mixed",
          primaryClaim: "Source-owned findings should map into the curated evidence landscape.",
          mainCaveat: "Standalone appraisals must match the curated landscape.",
          groups: [
            {
              id: "expected-group",
              label: "Expected group",
              stance: "supports",
              summary: "Standalone appraisals must use this group.",
              sourceKeys: ["source_artifact:sauna/example"],
            },
          ],
        },
      },
    } satisfies HealthCommonsSourcePage;

    expect(() =>
      validateHealthCommonsContent({
        ...baseContent,
        pages: [biomarkerPage, source, protocolWithLandscape],
        evidenceAppraisals: [
          {
            ...appraisal,
            key: "evidence_appraisal:sauna-example:missing-landscape-group",
            groupId: "missing-group",
          },
        ],
      }),
    ).not.toThrow();

    expect(() =>
      validateHealthCommonsContent({
        ...baseContent,
        pages: [
          biomarkerPage,
          source,
          sourcePage("source_artifact:sauna/other", "sauna-other"),
          {
            ...protocolWithLandscape,
            frontmatter: {
              ...protocolWithLandscape.frontmatter,
              researchLandscape: {
                ...protocolWithLandscape.frontmatter.researchLandscape,
                groups: [
                  {
                    ...protocolWithLandscape.frontmatter.researchLandscape.groups[0],
                    sourceKeys: ["source_artifact:sauna/other"],
                  },
                ],
              },
            },
          },
        ],
        evidenceAppraisals: [
          {
            ...appraisal,
            key: "evidence_appraisal:sauna-example:source-not-listed",
          },
        ],
      }),
    ).not.toThrow();

    expect(() =>
      validateHealthCommonsContent({
        ...baseContent,
        pages: [biomarkerPage, source, protocol],
        evidenceAppraisals: [
          {
            ...appraisal,
            key: "evidence_appraisal:sauna-example:wrong-source-kind",
            sourceKey: "protocol_variant:dry-sauna/example",
          },
        ],
      }),
    ).toThrow(
      "evidence appraisal evidence_appraisal:sauna-example:wrong-source-kind sourceKey must point to source_artifact, but protocol_variant:dry-sauna/example is protocol_variant.",
    );

    expect(() =>
      validateHealthCommonsContent({
        ...baseContent,
        pages: [
          biomarkerPage,
          source,
          {
            ...protocolWithLandscape,
            frontmatter: {
              ...protocolWithLandscape.frontmatter,
              researchLandscape: {
                ...protocolWithLandscape.frontmatter.researchLandscape,
                groups: [
                  {
                    ...protocolWithLandscape.frontmatter.researchLandscape.groups[0],
                    summary: "Standalone evidence-appraisal edges for Expected group are listed here so protocol source references resolve through the research landscape.",
                  },
                ],
              },
            },
          },
        ],
      }),
    ).toThrow("researchLandscape group expected-group uses generated placeholder summary text");
  });

  it("builds source and artifact indexes from canonical identities, findings, and manifests", () => {
    const source = {
      ...sourcePage("source_artifact:example/indexed", "indexed-source"),
      frontmatter: {
        ...sourcePage("source_artifact:example/indexed", "indexed-source").frontmatter,
        sourceIdentity: {
          identityKind: "scholarly_work",
          canonicalIdBasis: "doi",
          identifiers: {
            doi: "https://doi.org/10.2000/Indexed",
            titleHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
          canonicalUrl: "https://example.com/indexed-source/?utm_source=newsletter&ok=1",
          identityAliases: ["pubmed:12345"],
        },
        sourceFindings: [
          {
            findingId: "finding:example/indexed-summary",
            extractedFromArtifactId: "art_example_pdf",
            findingKind: "context",
            summary: "Reusable indexed source finding.",
          },
        ],
      },
    } satisfies HealthCommonsSourcePage;
    const catalog = buildHealthCommonsCatalogFromContent({
      artifactManifests: [
        {
          ...artifactManifest,
          artifacts: [
            {
              ...artifactManifest.artifacts[0],
              sourceKey: "source_artifact:example/indexed",
            },
          ],
        },
      ],
      changes: [],
      evidenceAppraisals: [],
      redirects: [],
      pages: [source],
    });

    const sourceIndex = buildHealthCommonsSourceIndex(catalog);
    const sourceEntry = sourceIndex.sources.find(
      (entry) => entry.sourceKey === "source_artifact:example/indexed",
    );
    expect(sourceEntry).toMatchObject({
      artifactIds: ["art_example_pdf"],
      canonicalIdBasis: "doi",
      canonicalUrl: "https://example.com/indexed-source?ok=1",
      extractionStatus: "findings_available",
      findingIds: ["finding:example/indexed-summary"],
      identityKind: "scholarly_work",
      sourceUrl: "https://example.com/indexed-source",
      identifiers: {
        doi: "https://doi.org/10.2000/Indexed",
        titleHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        url: "https://example.com/indexed-source?ok=1",
      },
    });
    expect(sourceEntry?.identityKeys).toEqual([
      "doi:10.2000/indexed",
      "pmid:12345",
      "title_hash:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "url:https://example.com/indexed-source",
      "url:https://example.com/indexed-source?ok=1",
    ]);
    expect(sourceIndex.identityLookup).toContainEqual({
      canonicalSourceKey: "source_artifact:example/indexed",
      identityKey: "doi:10.2000/indexed",
      sourceKeys: ["source_artifact:example/indexed"],
    });

    const artifactIndex = buildHealthCommonsSourceArtifactIndex(catalog);
    expect(artifactIndex.artifacts).toEqual([
      expect.objectContaining({
        artifactId: "art_example_pdf",
        manifestKey: "source_artifact:example/research-artifacts",
        sourceKey: "source_artifact:example/indexed",
      }),
    ]);
    expect(artifactIndex.sources).toEqual([
      {
        artifactIds: ["art_example_pdf"],
        sourceKey: "source_artifact:example/indexed",
      },
    ]);

    const sourceWithSensitiveUrl = {
      ...sourcePage("source_artifact:example/sensitive-url", "sensitive-url"),
      frontmatter: {
        ...sourcePage("source_artifact:example/sensitive-url", "sensitive-url").frontmatter,
        source: {
          kind: "web_page",
          url: "https://example.com/sensitive-url?token=secret",
        },
      },
    } satisfies HealthCommonsSourcePage;
    const catalogWithSensitiveUrl = buildHealthCommonsCatalogFromContent({
      artifactManifests: [],
      changes: [],
      evidenceAppraisals: [],
      redirects: [],
      pages: [sourceWithSensitiveUrl],
    });
    expect(() => buildHealthCommonsSourceIndex(catalogWithSensitiveUrl)).toThrow(
      "must not contain sensitive query parameter token",
    );
    expect(() => buildHealthCommonsSourceIndex(catalogWithSensitiveUrl)).not.toThrow(
      "secret",
    );

    const sourceWithCredentialUrl = {
      ...sourcePage("source_artifact:example/credential-url", "credential-url"),
      frontmatter: {
        ...sourcePage("source_artifact:example/credential-url", "credential-url").frontmatter,
        source: {
          kind: "web_page",
          url: "https://user:secret@example.com/credential-url",
        },
      },
    } satisfies HealthCommonsSourcePage;
    const catalogWithCredentialUrl = buildHealthCommonsCatalogFromContent({
      artifactManifests: [],
      changes: [],
      evidenceAppraisals: [],
      redirects: [],
      pages: [sourceWithCredentialUrl],
    });
    expect(() => buildHealthCommonsSourceIndex(catalogWithCredentialUrl)).toThrow(
      "Source index URL must not contain username or password.",
    );
    expect(() => buildHealthCommonsSourceIndex(catalogWithCredentialUrl)).not.toThrow(
      "secret",
    );

    const catalogWithInvalidSensitiveUrl = {
      ...catalogWithSensitiveUrl,
      entities: catalogWithSensitiveUrl.entities.map((entity) => (
        entity.key === "source_artifact:example/sensitive-url"
          ? {
              ...entity,
              source: entity.source
                ? {
                    ...entity.source,
                    url: "https://[secret",
                  }
                : entity.source,
            }
          : entity
      )),
    };
    expect(() => buildHealthCommonsSourceIndex(catalogWithInvalidSensitiveUrl)).toThrow(
      "Source index URL must be a valid URL.",
    );
    expect(() => buildHealthCommonsSourceIndex(catalogWithInvalidSensitiveUrl)).not.toThrow(
      "secret",
    );
  });

  it("allows source finding references to missing extracted artifacts", () => {
    const source = {
      ...sourcePage("source_artifact:example/missing-artifact", "missing-artifact"),
      frontmatter: {
        ...sourcePage("source_artifact:example/missing-artifact", "missing-artifact").frontmatter,
        sourceFindings: [
          {
            findingId: "finding:example/missing-artifact",
            extractedFromArtifactId: "art_missing",
            findingKind: "context",
            summary: "This finding points to a missing artifact.",
          },
        ],
      },
    } satisfies HealthCommonsSourcePage;
    const content: HealthCommonsContentSet = {
      artifactManifests: [],
      changes: [],
      evidenceAppraisals: [],
      redirects: [],
      pages: [source],
    };

    expect(() => validateHealthCommonsContent(content)).not.toThrow();
  });

  it("rejects source finding references to artifacts owned by another source", () => {
    const ownerSource = sourcePage("source_artifact:example/owned-artifact", "owned-artifact");
    const source = {
      ...sourcePage("source_artifact:example/wrong-artifact-owner", "wrong-artifact-owner"),
      frontmatter: {
        ...sourcePage("source_artifact:example/wrong-artifact-owner", "wrong-artifact-owner").frontmatter,
        sourceFindings: [
          {
            findingId: "finding:example/wrong-artifact-owner",
            extractedFromArtifactId: "art_example_pdf",
            findingKind: "context",
            summary: "This finding points at an artifact owned by another source.",
          },
        ],
      },
    } satisfies HealthCommonsSourcePage;
    const ownedArtifactManifest = {
      ...artifactManifest,
      artifacts: artifactManifest.artifacts.map((artifact) => ({
        ...artifact,
        sourceKey: ownerSource.frontmatter.key,
      })),
    } satisfies HealthCommonsArtifactManifest;
    const content: HealthCommonsContentSet = {
      artifactManifests: [ownedArtifactManifest],
      changes: [],
      evidenceAppraisals: [],
      redirects: [],
      pages: [ownerSource, source],
    };

    expect(() => validateHealthCommonsContent(content)).toThrow(
      "source_artifact:example/wrong-artifact-owner sourceFindings finding:example/wrong-artifact-owner extractedFromArtifactId art_example_pdf belongs to source_artifact:example/owned-artifact, not source_artifact:example/wrong-artifact-owner.",
    );
  });
});
