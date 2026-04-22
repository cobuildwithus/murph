import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  healthCommonsCatalogSchema,
  type HealthCommonsCatalog,
} from "@murphai/contracts/health-commons";
import healthCommonsCatalogJson from "@murphai/health-commons/generated/catalog.json";

import {
  listHealthCommonsBiomarkerRoutes,
  resolveHealthCommonsBiomarkerDetail,
  type BiomarkerPageModel,
} from "@/src/lib/health-commons/biomarker-detail";

const mocks = vi.hoisted(() => ({
  biomarkerPageClient: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

vi.mock("../app/biomarkers/[biomarkerId]/biomarker-page-client", () => ({
  BiomarkerPageClient({
    biomarker,
  }: {
    biomarker: BiomarkerPageModel;
  }) {
    mocks.biomarkerPageClient({ biomarker });

    return createElement(
      "div",
      {
        "data-biomarker-id": biomarker.routeId,
        "data-biomarker-key": biomarker.key,
      },
      biomarker.title,
    );
  },
}));

import BiomarkerPage, {
  generateMetadata,
  generateStaticParams,
} from "../app/biomarkers/[biomarkerId]/page";
import { createHealthCommonsCatalogReader } from "../src/lib/health-commons/catalog";

function createFixtureCatalog(): HealthCommonsCatalog {
  return structuredClone(healthCommonsCatalogSchema.parse(healthCommonsCatalogJson));
}

describe("BiomarkerPage", () => {
  it("publishes only the production-ready RHR biomarker route", () => {
    expect(generateStaticParams()).toEqual([
      { biomarkerId: "resting-heart-rate" },
    ]);
  });

  it("resolves the resting-heart-rate biomarker page model", async () => {
    const element = await BiomarkerPage({
      params: Promise.resolve({
        biomarkerId: "resting-heart-rate",
      }),
    });
    const markup = renderToStaticMarkup(element);

    expect(mocks.biomarkerPageClient).toHaveBeenCalledTimes(1);
    const clientBiomarker = mocks.biomarkerPageClient.mock.calls.at(-1)?.[0]
      ?.biomarker as BiomarkerPageModel;

    expect(clientBiomarker).toEqual(expect.objectContaining({
      key: "biomarker:resting-heart-rate",
      routeId: "resting-heart-rate",
      shortName: "RHR",
      title: "Resting Heart Rate",
    }));
    expect(clientBiomarker.privateMetricBindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        domain: "recovery",
        metric: "restingHeartRate",
        preferred: true,
        source: "browser_vault_metric",
      }),
    ]));
    expect(
      clientBiomarker.protocolRankings.map((protocol) => ({
        href: protocol.href,
        title: protocol.title,
      })).slice(0, 3),
    ).toEqual([
      {
        href: "/experiments/norwegian-4x4",
        title: "Norwegian 4x4 Intervals",
      },
      {
        href: "/experiments/finnish-sauna",
        title: "Finnish Dry Sauna",
      },
      {
        href: "/experiments/red-light-glasses-before-bed",
        title: "Red-Light Glasses Before Bed",
      },
    ]);
    expect(clientBiomarker.protocolRankings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        href: "/experiments/bryan-johnson-blueprint",
        title: "Bryan Johnson Sauna",
      }),
    ]));
    expect(markup).toContain('data-biomarker-id="resting-heart-rate"');
    expect(markup).toContain('data-biomarker-key="biomarker:resting-heart-rate"');
    expect(markup).toContain("Resting Heart Rate");
  });

  it("returns metadata for the published RHR biomarker page", async () => {
    await expect(generateMetadata({
      params: Promise.resolve({
        biomarkerId: "resting-heart-rate",
      }),
    })).resolves.toEqual(expect.objectContaining({
      description: expect.stringContaining("resting pulse trend"),
      title: "Resting Heart Rate | Murph Biomarkers",
    }));
  });

  it("returns notFound for unsupported biomarker pages", async () => {
    await expect(BiomarkerPage({
      params: Promise.resolve({
        biomarkerId: "estimated-vo2max",
      }),
    })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("preserves authored explicit candidate order ahead of computed score", () => {
    const catalog = createFixtureCatalog();
    const biomarkerIndex = catalog.entities.findIndex(
      (entity) => entity.key === "biomarker:resting-heart-rate",
    );
    const biomarker = catalog.entities[biomarkerIndex];

    expect(biomarkerIndex).toBeGreaterThanOrEqual(0);
    expect(biomarker?.entityType).toBe("biomarker");
    expect(biomarker?.protocolRanking?.candidates).toHaveLength(3);

    if (!biomarker || biomarker.entityType !== "biomarker" || !biomarker.protocolRanking?.candidates) {
      throw new Error("Expected the resting-heart-rate biomarker fixture.");
    }

    const [first, second, third] = biomarker.protocolRanking.candidates;

    catalog.entities[biomarkerIndex] = {
      ...biomarker,
      protocolRanking: {
        ...biomarker.protocolRanking,
        candidates: [third, first, second],
      },
    };

    const reader = createHealthCommonsCatalogReader(catalog);
    const detail = resolveHealthCommonsBiomarkerDetail("resting-heart-rate", reader);

    expect(detail?.protocolRankings.slice(0, 3).map((protocol) => protocol.title)).toEqual([
      "Red-Light Glasses Before Bed",
      "Norwegian 4x4 Intervals",
      "Finnish Dry Sauna",
    ]);
  });

  it("keeps bound but incomplete biomarker pages unpublished", () => {
    const catalog = createFixtureCatalog();
    const biomarker = catalog.entities.find(
      (entity) => entity.key === "biomarker:resting-heart-rate",
    );

    expect(biomarker?.entityType).toBe("biomarker");

    if (!biomarker || biomarker.entityType !== "biomarker") {
      throw new Error("Expected the resting-heart-rate biomarker fixture.");
    }

    catalog.entities.push({
      ...biomarker,
      key: "biomarker:incomplete-rhr-fixture",
      slug: "biomarkers/incomplete-rhr-fixture",
      title: "Incomplete RHR Fixture",
      communityOutcomeSummary: undefined,
      protocolRanking: undefined,
      revision: {
        ...biomarker.revision,
        pageRevisionId: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      },
      biomarker: biomarker.biomarker
        ? {
            ...biomarker.biomarker,
            explainerCards: undefined,
          }
        : biomarker.biomarker,
    });

    const reader = createHealthCommonsCatalogReader(catalog);

    expect(listHealthCommonsBiomarkerRoutes(reader)).toEqual(["resting-heart-rate"]);
    expect(resolveHealthCommonsBiomarkerDetail("incomplete-rhr-fixture", reader)).toBeNull();
  });
});
