import { describe, expect, it } from "vitest";

import {
  healthCommonsCatalogSchema,
  type HealthCommonsCatalog,
} from "@murphai/contracts";
import { createHealthCommonsCatalogReader } from "@murphai/health-commons/runtime";
import {
  listHealthCommonsMeasurementMethodRoutes,
  resolveHealthCommonsMeasurementMethodDetail,
} from "@/src/lib/health-commons/measurement-method-detail";

const TEST_CATALOG_HASH = `sha256:${"0".repeat(64)}`;
const TEST_PAGE_REVISION_ID = `sha256:${"1".repeat(64)}`;

describe("resolveHealthCommonsMeasurementMethodDetail", () => {
  it("resolves generated measurement-method pages from route bundles by default", () => {
    expect(listHealthCommonsMeasurementMethodRoutes()).toContain(
      "home-standardized-photo-roi-analysis",
    );

    const method = resolveHealthCommonsMeasurementMethodDetail(
      "home-standardized-photo-roi-analysis",
    );

    expect(method).toMatchObject({
      routeId: "home-standardized-photo-roi-analysis",
      title: "Home Standardized Photo ROI Analysis",
      outputs: expect.arrayContaining([
        expect.objectContaining({
          label: "Wrinkle line length or area",
          mapsToLabel: "Periocular Wrinkle Score",
        }),
      ]),
      relatedBiomarkers: expect.arrayContaining([
        {
          key: "biomarker:periocular-wrinkle-score",
          title: "Periocular Wrinkle Score",
        },
      ]),
    });
    expect(method?.catalogHash).toMatch(/^sha256:/u);
  });

  it("returns null for malformed percent-encoded route ids", () => {
    expect(resolveHealthCommonsMeasurementMethodDetail("%E0%A4%A")).toBeNull();
  });

  it("maps output biomarker labels through active biomarker pages", () => {
    const reader = createHealthCommonsCatalogReader(createFixtureCatalog({
      mapsToBiomarkerKey: "biomarker:skin-texture-roughness-score",
    }));

    const method = resolveHealthCommonsMeasurementMethodDetail(
      "home-standardized-photo-roi-analysis",
      reader,
    );

    expect(method).toMatchObject({
      outputs: [
        expect.objectContaining({
          mapsToLabel: "Skin Texture / Roughness Score",
        }),
      ],
      relatedBiomarkers: [
        {
          key: "biomarker:skin-texture-roughness-score",
          title: "Skin Texture / Roughness Score",
        },
      ],
    });
  });

  it("fails closed when output mappings do not resolve to biomarkers", () => {
    const reader = createHealthCommonsCatalogReader(createFixtureCatalog({
      mapsToBiomarkerKey: "measurement_method:skin/home-standardized-photo-roi-analysis",
    }));

    expect(() =>
      resolveHealthCommonsMeasurementMethodDetail(
        "home-standardized-photo-roi-analysis",
        reader,
      )
    ).toThrow(
      /Measurement method output mapping measurement_method:skin\/home-standardized-photo-roi-analysis did not resolve to a biomarker/u,
    );
  });
});

function createFixtureCatalog(input: {
  mapsToBiomarkerKey: string;
}): HealthCommonsCatalog {
  return healthCommonsCatalogSchema.parse({
    schemaVersion: "murph.commons.catalog.v1",
    catalogHash: TEST_CATALOG_HASH,
    entities: [
      {
        schemaVersion: "murph.commons.page.v1",
        entityType: "biomarker",
        key: "biomarker:skin-texture-roughness-score",
        slug: "biomarkers/skin-texture-roughness-score",
        title: "Skin Texture / Roughness Score",
        body: "Skin texture outcome.",
        relativePath: "biomarkers/skin-texture-roughness-score.md",
        revision: {
          pageRevisionId: TEST_PAGE_REVISION_ID,
        },
      },
      {
        schemaVersion: "murph.commons.page.v1",
        entityType: "measurement_method",
        key: "measurement_method:skin/home-standardized-photo-roi-analysis",
        slug: "measurement-methods/skin/home-standardized-photo-roi-analysis",
        title: "Home Standardized Photo ROI Analysis",
        summary: "Analyze a fixed skin photo region with fixed settings.",
        body: "Use the same region of interest each time.",
        relativePath: "measurement-methods/skin/home-standardized-photo-roi-analysis.md",
        measurementMethod: {
          shortName: "Home ROI photo analysis",
          tier: "optional_home",
          modalities: ["standardized_photo", "image_analysis"],
          measuredBiomarkerKeys: ["biomarker:skin-texture-roughness-score"],
          outputs: [
            {
              outputId: "texture_index",
              label: "Image-derived skin texture index",
              valueType: "index",
              mapsToBiomarkerKey: input.mapsToBiomarkerKey,
              direction: "lower_or_stable",
            },
          ],
          procedure: {
            summary: "Analyze the same photo region across repeated photos.",
            steps: ["Capture a standardized photo.", "Analyze the same ROI."],
          },
          privacy: {
            containsIdentifiableImages: true,
            localOnlyRecommended: true,
            notes: ["Keep original face photos local by default."],
          },
        },
        revision: {
          pageRevisionId: TEST_PAGE_REVISION_ID,
        },
      },
    ],
    redirects: [],
    changes: [],
    artifactManifests: [],
    evidenceAppraisals: [],
  });
}
