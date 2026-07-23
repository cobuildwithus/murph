import { describe, expect, it } from "vitest";

import type {
  HealthCommonsBiomarkerReferenceGuidance,
  HealthCommonsCatalogEntity,
} from "@murphai/contracts";
import { buildHealthCommonsWebBiomarkerResearch } from "../src/biomarker-web-artifacts.ts";

const TEST_PAGE_REVISION_ID = `sha256:${"1".repeat(64)}`;
const TEST_CATALOG_HASH = `sha256:${"2".repeat(64)}`;
const SOURCE_KEY = "source_artifact:test-source";
const TEST_REFERENCE_GUIDANCE: HealthCommonsBiomarkerReferenceGuidance = {
  classification: "conditional_numeric",
  reviewStatus: "reviewed",
  use: "context_only",
  fallbackRanges: [
    {
      eligibleSpecimenKinds: ["serum"],
      label: "Example contextual interval",
      unit: "fallback-unit",
      lowerBound: { inclusive: true, value: 2 },
      upperBound: { inclusive: true, value: 8 },
      applicability: "Applies only to the matrix and population reviewed by the source.",
      source: {
        title: "Example reference interval guideline",
        organization: "Example organization",
        year: 2026,
        sourceType: "consensus_statement",
        url: "https://example.test/reference-interval-guideline",
      },
    },
  ],
  items: [
    {
      kind: "decision_limit",
      guidance: "A test decision limit is preserved as contextual education only.",
      applicability: "Applies only to the named test method and reviewed population.",
      numericValues: [
        {
          label: "Example upper comparator",
          unit: "example-unit",
          upperBound: { inclusive: false, value: 10 },
        },
      ],
      source: {
        title: "Example guideline",
        organization: "Example organization",
        year: 2026,
        sourceType: "clinical_guideline",
        url: "https://example.test/guideline",
      },
    },
  ],
};

describe("@murphai/health-commons biomarker web artifacts", () => {
  it("omits unsafe biomarker source urls from research links", () => {
    const unsafeUrls = [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "//example.test/source",
      "https://user:password@example.test/source",
    ];

    for (const unsafeUrl of unsafeUrls) {
      const research = buildResearchWithSourceUrl(unsafeUrl);

      expect(research.sourceHighlights[0]?.externalUrl).toBeNull();
      expect(research.claims[0]?.sources[0]?.externalUrl).toBeNull();
    }
  });

  it("keeps safe biomarker source urls in research links", () => {
    const research = buildResearchWithSourceUrl(" https://example.test/source ");

    expect(research.sourceHighlights[0]?.externalUrl).toBe("https://example.test/source");
    expect(research.claims[0]?.sources[0]?.externalUrl).toBe("https://example.test/source");
  });

  it("projects structured reference guidance into the research artifact", () => {
    const research = buildResearchWithSourceUrl("https://example.test/source");

    expect(research.referenceGuidance).toEqual(TEST_REFERENCE_GUIDANCE);
  });
});

function buildResearchWithSourceUrl(url: string) {
  const biomarker = createBiomarkerEntity();
  const source = createSourceEntity(url);
  const entitiesByKey = new Map<string, HealthCommonsCatalogEntity>([
    [biomarker.key, biomarker],
    [source.key, source],
  ]);

  return buildHealthCommonsWebBiomarkerResearch({
    biomarker,
    catalogHash: TEST_CATALOG_HASH,
    entitiesByKey,
    routeAliases: [],
    routeId: "test-biomarker",
    routeIdByEntityKey: new Map([[biomarker.key, "test-biomarker"]]),
  });
}

function createBiomarkerEntity() {
  return {
    schemaVersion: "murph.commons.page.v1",
    entityType: "biomarker",
    key: "biomarker:test-biomarker",
    slug: "biomarkers/test-biomarker",
    title: "Test biomarker",
    body: "Test biomarker body.",
    claims: [
      {
        claimId: "test-claim",
        type: "evidence_scope",
        text: "Test claim.",
        strength: "moderate",
        sourceKeys: [SOURCE_KEY],
      },
    ],
    referenceGuidance: TEST_REFERENCE_GUIDANCE,
    relativePath: "biomarkers/test-biomarker.md",
    revision: {
      pageRevisionId: TEST_PAGE_REVISION_ID,
    },
  } satisfies HealthCommonsCatalogEntity & { entityType: "biomarker" };
}

function createSourceEntity(url: string) {
  return {
    schemaVersion: "murph.commons.page.v1",
    entityType: "source_artifact",
    key: SOURCE_KEY,
    slug: "sources/test-source",
    title: "Test source",
    body: "Test source body.",
    source: {
      kind: "web_page",
      title: "Test source",
      url,
    },
    relativePath: "sources/test-source.md",
    revision: {
      pageRevisionId: TEST_PAGE_REVISION_ID,
    },
  } satisfies HealthCommonsCatalogEntity;
}
