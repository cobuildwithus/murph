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
              target: "protocol_variant:dry-sauna/one",
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

  it("rejects duplicate keys and aliases early", () => {
    const duplicateKeyContent: HealthCommonsContentSet = {
      artifactManifests: [],
      changes: [],
      evidenceAppraisals: [],
      redirects: [],
      pages: [sourcePage("source_artifact:example", "one"), sourcePage("source_artifact:example", "two")],
    };

    expect(() => validateHealthCommonsContent(duplicateKeyContent)).toThrow(
      "Duplicate health commons key source_artifact:example",
    );

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

    expect(() => validateHealthCommonsContent(duplicateAliasContent)).toThrow(
      'Duplicate health commons alias "Example Alias"',
    );
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
              schemaVersion: "murph.commons.experiment-onboarding.v1",
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

  it("rejects grouped research sources that lack matching same-group protocol evidence", () => {
    const groupedCoverageMismatchContent: HealthCommonsContentSet = {
      artifactManifests: [],
      changes: [],
      evidenceAppraisals: [],
      redirects: [],
      pages: [
        biomarkerPage,
        {
          ...sourcePage("source_artifact:sauna/example", "sauna-example"),
          frontmatter: {
            ...sourcePage("source_artifact:sauna/example", "sauna-example").frontmatter,
            protocolEvidence: [
              {
                protocolKey: "protocol_variant:dry-sauna/example",
                groupId: "wrong-group",
                stance: "supports",
                scope: "direct_protocol",
                result: "positive",
                headline: "Example headline",
                implication: "Example implication",
              },
            ],
          },
        },
        {
          ...protocolPage("protocol_variant:dry-sauna/example", "dry-sauna-example"),
          frontmatter: {
            ...protocolPage("protocol_variant:dry-sauna/example", "dry-sauna-example").frontmatter,
            researchLandscape: {
              bottomLine: "Grouped evidence should be internally aligned.",
              confidenceLabel: "mixed",
              primaryClaim: "Only group-covered sources should appear in grouped research.",
              mainCaveat: "Missing same-group appraisals should fail fast.",
              groups: [
                {
                  id: "expected-group",
                  label: "Expected group",
                  stance: "supports",
                  summary: "A grouped source without a same-group appraisal should be rejected.",
                  sourceKeys: ["source_artifact:sauna/example"],
                },
              ],
            },
          },
        },
      ],
    };

    expect(() => validateHealthCommonsContent(groupedCoverageMismatchContent)).toThrow(
      "protocol_variant:dry-sauna/example researchLandscape group expected-group source source_artifact:sauna/example lacks matching protocolEvidence or evidence-appraisal edge",
    );
  });

  it("rejects duplicate source identities unless the pages are explicitly related", () => {
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
      "Duplicate source identity doi:10.1000/example across source_artifact:example/one",
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
          },
          canonicalUrl: "https://example.com/indexed-source/",
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
      canonicalUrl: "https://example.com/indexed-source/",
      extractionStatus: "findings_available",
      findingIds: ["finding:example/indexed-summary"],
      identityKind: "scholarly_work",
      identifiers: {
        doi: "https://doi.org/10.2000/Indexed",
        url: "https://example.com/indexed-source/",
      },
    });
    expect(sourceEntry?.identityKeys).toEqual([
      "doi:10.2000/indexed",
      "pmid:12345",
      "url:https://example.com/indexed-source",
    ]);

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
  });

  it("rejects source finding references to missing artifacts", () => {
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

    expect(() => validateHealthCommonsContent(content)).toThrow(
      "source_artifact:example/missing-artifact sourceFindings finding:example/missing-artifact extractedFromArtifactId points to missing artifact art_missing",
    );
  });
});
