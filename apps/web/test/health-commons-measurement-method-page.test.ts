import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MeasurementMethodPageModel } from "@/src/lib/health-commons/measurement-method-detail";

const fixtureMethod: MeasurementMethodPageModel = {
  aliases: ["Home image analysis"],
  body: "A reusable fixture measurement method.",
  burden: {
    costTier: "free",
    userBurden: "low",
  },
  catalogHash: "sha256:catalog",
  categories: ["measurement", "skin"],
  confounders: ["lighting"],
  fidelity: {
    minimumRequirements: ["Use the same camera and room lighting."],
    repeatabilityRisks: ["expression"],
  },
  interpretation: {
    caveat: "Do not treat this as diagnostic.",
    principle: "Compare the same method against itself.",
  },
  key: "measurement_method:home-image-analysis",
  modalities: ["Standardized Photo", "Image Analysis"],
  outputs: [
    {
      label: "Texture score",
      mapsToLabel: "Skin Texture / Roughness Score",
      notes: ["Higher is not automatically better without the same ROI."],
      valueType: "score",
    },
  ],
  pageRevisionId: "sha256:1234567890abcdef",
  privacy: {
    containsIdentifiableImages: true,
    localOnlyRecommended: true,
    notes: ["Keep source photos private by default."],
  },
  procedure: {
    materials: ["Same camera"],
    schedule: ["Baseline and follow-up"],
    steps: ["Capture the same region under the same light."],
    summary: "Repeatable at-home image analysis.",
  },
  qualityLabel: "Usable",
  relatedBiomarkers: [
    {
      key: "biomarker:skin-texture-roughness-score",
      title: "Skin Texture / Roughness Score",
    },
  ],
  routeId: "home-image-analysis",
  shortName: "Home image analysis",
  slug: "measurement-methods/home-image-analysis",
  statusLabel: "Field testing",
  summary: "At-home image analysis keeps the photo method separate from the outcome.",
  tier: "optional_home",
  title: "Home Image Analysis",
};

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  resolveHealthCommonsMeasurementMethodDetail: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

vi.mock("@/src/lib/health-commons/measurement-method-detail", () => ({
  listHealthCommonsMeasurementMethodRoutes: () => ["home-image-analysis"],
  resolveHealthCommonsMeasurementMethodDetail:
    mocks.resolveHealthCommonsMeasurementMethodDetail,
}));

import MeasurementMethodPage, {
  generateMetadata,
  generateStaticParams,
} from "../app/measurement-methods/[measurementMethodId]/page";

describe("MeasurementMethodPage", () => {
  beforeEach(() => {
    mocks.notFound.mockClear();
    mocks.resolveHealthCommonsMeasurementMethodDetail.mockReset();
    mocks.resolveHealthCommonsMeasurementMethodDetail.mockImplementation((id: string) => {
      if (id !== "home-image-analysis") {
        return null;
      }

      return fixtureMethod;
    });
  });

  it("publishes measurement-method static params", () => {
    expect(generateStaticParams()).toEqual([
      { measurementMethodId: "home-image-analysis" },
    ]);
  });

  it("returns metadata for measurement-method detail pages", async () => {
    await expect(generateMetadata({
      params: Promise.resolve({
        measurementMethodId: "home-image-analysis",
      }),
    })).resolves.toEqual(expect.objectContaining({
      alternates: {
        canonical: "/measurement-methods/home-image-analysis",
      },
      description: "At-home image analysis keeps the photo method separate from the outcome.",
      openGraph: expect.objectContaining({
        type: "article",
      }),
      robots: { follow: true, index: true },
      title: "Home Image Analysis | Murph Measurement Methods",
    }));
  });

  it("renders a simple measurement-method page", async () => {
    const element = await MeasurementMethodPage({
      params: Promise.resolve({
        measurementMethodId: "home-image-analysis",
      }),
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain("Measurement method page");
    expect(markup).toContain("Home Image Analysis");
    expect(markup).toContain("Repeatable at-home image analysis");
    expect(markup).toContain('href="/experiments"');
    expect(markup).toContain("Texture score");
    expect(markup).toContain("Local-only storage is recommended");
    expect(markup).toContain("Skin Texture / Roughness Score");
  });

  it("returns notFound for non-canonical measurement-method routes", async () => {
    await expect(MeasurementMethodPage({
      params: Promise.resolve({
        measurementMethodId: "unknown-home-image",
      }),
    })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("returns notFound when no measurement-method page exists", async () => {
    await expect(MeasurementMethodPage({
      params: Promise.resolve({
        measurementMethodId: "missing",
      }),
    })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
