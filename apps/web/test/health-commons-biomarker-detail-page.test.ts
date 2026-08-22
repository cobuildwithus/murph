import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BiomarkerAboutGrid } from "@/src/components/biomarkers/biomarker-detail/biomarker-about-grid";
import {
  listHealthCommonsBiomarkerRoutes,
  resolveHealthCommonsBiomarkerDetail,
} from "@/src/lib/health-commons/biomarker-detail";
import type {
  BiomarkerShellProjection,
} from "@/src/lib/health-commons/biomarker-projections";

const mocks = vi.hoisted(() => ({
  biomarkerLayoutClient: vi.fn(),
  getHostedDashboardPageAuthSnapshot: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedDashboardPageAuthSnapshot: mocks.getHostedDashboardPageAuthSnapshot,
}));

vi.mock("../app/(dashboard)/biomarkers/[biomarkerId]/biomarker-layout-client", () => ({
  BiomarkerLayoutClient({
    biomarker,
  }: {
    biomarker: BiomarkerShellProjection;
    children?: unknown;
  }) {
    mocks.biomarkerLayoutClient({ biomarker });

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

import BiomarkerDetailLayout, {
  generateStaticParams,
} from "../app/(dashboard)/biomarkers/[biomarkerId]/layout";
import { generateMetadata } from "../app/(dashboard)/biomarkers/[biomarkerId]/page";
import { createHealthCommonsCatalogReader } from "@murphai/health-commons/runtime";
import {
  createHealthCommonsRouteBundleFixtureCatalog,
} from "./health-commons-fixture-catalog";

function createFixtureCatalog() {
  return createHealthCommonsRouteBundleFixtureCatalog();
}

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const spo2PagePath = path.join(
  repoRoot,
  "packages/health-commons/content/biomarkers/blood-oxygen-spo2.md",
);
const redirectsPath = path.join(repoRoot, "packages/health-commons/content/redirects.json");
const changesPath = path.join(repoRoot, "packages/health-commons/content/changes/2026-04.jsonl");

describe("BiomarkerPage", () => {
  beforeEach(() => {
    mocks.biomarkerLayoutClient.mockClear();
    mocks.getHostedDashboardPageAuthSnapshot.mockReset();
    mocks.getHostedDashboardPageAuthSnapshot.mockResolvedValue({
      authenticated: true,
      authenticatedMember: null,
      session: null,
    });
    mocks.notFound.mockClear();
    mocks.redirect.mockClear();
  });

  it("publishes the production-ready biomarker routes", () => {
    const source = readFileSync(
      new URL("../src/lib/health-commons/biomarker-detail.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("generated/catalog.json");
    expect(source).not.toContain("healthCommonsCatalog");
    expect(source).not.toContain("./catalog");

    expect(generateStaticParams()).toEqual([
      { biomarkerId: "blood-oxygen-spo2" },
      { biomarkerId: "deep-sleep-minutes" },
      { biomarkerId: "estimated-vo2max" },
      { biomarkerId: "hrv-rmssd" },
      { biomarkerId: "rem-sleep-minutes" },
      { biomarkerId: "resting-heart-rate" },
    ]);
  });

  it("resolves the VO₂ max biomarker shell projection", async () => {
    const element = await BiomarkerDetailLayout({
      children: createElement("div", null),
      params: Promise.resolve({
        biomarkerId: "estimated-vo2max",
      }),
    });
    const markup = renderToStaticMarkup(element);

    expect(mocks.biomarkerLayoutClient).toHaveBeenCalledTimes(1);
    const clientBiomarker = mocks.biomarkerLayoutClient.mock.calls.at(-1)?.[0]
      ?.biomarker as BiomarkerShellProjection;

    expect(clientBiomarker).toEqual(expect.objectContaining({
      key: "biomarker:estimated-vo2max",
      routeId: "estimated-vo2max",
      shortName: "VO₂ max",
      title: "VO₂ Max",
      unit: "ml/kg/min",
    }));
    expect(markup).toContain('data-biomarker-id="estimated-vo2max"');
    expect(markup).toContain('data-biomarker-key="biomarker:estimated-vo2max"');
    expect(markup).toContain("VO₂ Max");
  });

  it("resolves the SpO₂ biomarker shell projection", async () => {
    const element = await BiomarkerDetailLayout({
      children: createElement("div", null),
      params: Promise.resolve({
        biomarkerId: "blood-oxygen-spo2",
      }),
    });
    const markup = renderToStaticMarkup(element);

    expect(mocks.biomarkerLayoutClient).toHaveBeenCalledTimes(1);
    const clientBiomarker = mocks.biomarkerLayoutClient.mock.calls.at(-1)?.[0]
      ?.biomarker as BiomarkerShellProjection;

    expect(clientBiomarker).toEqual(expect.objectContaining({
      key: "biomarker:blood-oxygen-spo2",
      routeId: "blood-oxygen-spo2",
      shortName: "SpO₂",
      title: "Blood Oxygen Saturation (SpO₂)",
      unit: "%",
    }));
    expect(markup).toContain('data-biomarker-id="blood-oxygen-spo2"');
    expect(markup).toContain('data-biomarker-key="biomarker:blood-oxygen-spo2"');
    expect(markup).toContain("SpO₂");
  });

  it("redirects the short SpO₂ overview route to the canonical biomarker page", async () => {
    const { default: BiomarkerOverviewPage } = await import(
      "../app/(dashboard)/biomarkers/[biomarkerId]/page"
    );

    await expect(BiomarkerOverviewPage({
      params: Promise.resolve({
        biomarkerId: "spo2",
      }),
    })).rejects.toThrow("NEXT_REDIRECT:/biomarkers/blood-oxygen-spo2");

    expect(mocks.redirect).toHaveBeenCalledWith("/biomarkers/blood-oxygen-spo2");
    expect(resolveHealthCommonsBiomarkerDetail("spo2")).toEqual(expect.objectContaining({
      key: "biomarker:blood-oxygen-spo2",
      routeId: "blood-oxygen-spo2",
    }));
  });

  it("redirects the short RHR overview route to the canonical biomarker page", async () => {
    const { default: BiomarkerOverviewPage } = await import(
      "../app/(dashboard)/biomarkers/[biomarkerId]/page"
    );

    await expect(BiomarkerOverviewPage({
      params: Promise.resolve({
        biomarkerId: "rhr",
      }),
    })).rejects.toThrow("NEXT_REDIRECT:/biomarkers/resting-heart-rate");

    expect(mocks.redirect).toHaveBeenCalledWith("/biomarkers/resting-heart-rate");
    expect(resolveHealthCommonsBiomarkerDetail("rhr")).toEqual(expect.objectContaining({
      key: "biomarker:resting-heart-rate",
      routeId: "resting-heart-rate",
    }));
  });

  it("redirects the short SpO₂ research route to the canonical research subpath", async () => {
    const { default: BiomarkerResearchPage } = await import(
      "../app/(dashboard)/biomarkers/[biomarkerId]/research/page"
    );

    await expect(BiomarkerResearchPage({
      params: Promise.resolve({
        biomarkerId: "spo2",
      }),
    })).rejects.toThrow("NEXT_REDIRECT:/biomarkers/blood-oxygen-spo2/research");

    expect(mocks.redirect).toHaveBeenCalledWith("/biomarkers/blood-oxygen-spo2/research");
  });

  it("keeps the authored SpO₂ evidence claims and follow-up change note in repo content", () => {
    const page = readFileSync(spo2PagePath, "utf8");
    const redirects = readFileSync(redirectsPath, "utf8");
    const changes = readFileSync(changesPath, "utf8");

    expect(page).toContain("claims:");
    expect(page).toContain("claimId: spo2-readings-are-estimates");
    expect(page).toContain("claimId: spo2-skin-tone-perfusion-and-motion-can-bias-readings");
    expect(page).toContain("claimId: spo2-overnight-desaturation-is-follow-up-context");
    expect(page).toContain("claimId: spo2-low-readings-with-symptoms-need-escalation-context");
    expect(page).toContain("source_artifact:fda-pulse-oximeter-basics-2025");
    expect(page).toContain("source_artifact:pmid-28162150");
    expect(redirects).toContain('"from": "biomarker:spo2"');
    expect(redirects).toContain('"to": "biomarker:blood-oxygen-spo2"');
    expect(changes).toContain('"changeId":"chg_2026_04_23_spo2_claims_and_delta_copy"');
  });

  it("resolves the REM sleep biomarker shell projection", async () => {
    const element = await BiomarkerDetailLayout({
      children: createElement("div", null),
      params: Promise.resolve({
        biomarkerId: "rem-sleep-minutes",
      }),
    });
    const markup = renderToStaticMarkup(element);

    expect(mocks.biomarkerLayoutClient).toHaveBeenCalledTimes(1);
    const clientBiomarker = mocks.biomarkerLayoutClient.mock.calls.at(-1)?.[0]
      ?.biomarker as BiomarkerShellProjection;

    expect(clientBiomarker).toEqual(expect.objectContaining({
      key: "biomarker:rem-sleep-minutes",
      routeId: "rem-sleep-minutes",
      shortName: "REM",
      title: "REM Sleep",
    }));
    expect(markup).toContain('data-biomarker-id="rem-sleep-minutes"');
    expect(markup).toContain('data-biomarker-key="biomarker:rem-sleep-minutes"');
    expect(markup).toContain("REM Sleep");
  });

  it("resolves the deep sleep biomarker shell projection", async () => {
    const element = await BiomarkerDetailLayout({
      children: createElement("div", null),
      params: Promise.resolve({
        biomarkerId: "deep-sleep-minutes",
      }),
    });
    const markup = renderToStaticMarkup(element);

    expect(mocks.biomarkerLayoutClient).toHaveBeenCalledTimes(1);
    const clientBiomarker = mocks.biomarkerLayoutClient.mock.calls.at(-1)?.[0]
      ?.biomarker as BiomarkerShellProjection;

    expect(clientBiomarker).toEqual(expect.objectContaining({
      key: "biomarker:deep-sleep-minutes",
      routeId: "deep-sleep-minutes",
      shortName: "Deep sleep",
      title: "Deep Sleep",
      unit: "minutes",
    }));
    expect(markup).toContain('data-biomarker-id="deep-sleep-minutes"');
    expect(markup).toContain('data-biomarker-key="biomarker:deep-sleep-minutes"');
    expect(markup).toContain("Deep Sleep");
  });

  it("resolves the HRV biomarker shell projection", async () => {
    const element = await BiomarkerDetailLayout({
      children: createElement("div", null),
      params: Promise.resolve({
        biomarkerId: "hrv-rmssd",
      }),
    });
    const markup = renderToStaticMarkup(element);

    expect(mocks.biomarkerLayoutClient).toHaveBeenCalledTimes(1);
    const clientBiomarker = mocks.biomarkerLayoutClient.mock.calls.at(-1)?.[0]
      ?.biomarker as BiomarkerShellProjection;

    expect(clientBiomarker).toEqual(expect.objectContaining({
      key: "biomarker:hrv-rmssd",
      routeId: "hrv-rmssd",
      shortName: "HRV",
      title: "Heart Rate Variability",
      unit: "ms",
    }));
    expect(markup).toContain('data-biomarker-id="hrv-rmssd"');
    expect(markup).toContain('data-biomarker-key="biomarker:hrv-rmssd"');
    expect(markup).toContain("Heart Rate Variability");
  });

  it("resolves the resting-heart-rate biomarker shell projection", async () => {
    const element = await BiomarkerDetailLayout({
      children: createElement("div", null),
      params: Promise.resolve({
        biomarkerId: "resting-heart-rate",
      }),
    });
    const markup = renderToStaticMarkup(element);

    expect(mocks.biomarkerLayoutClient).toHaveBeenCalledTimes(1);
    const clientBiomarker = mocks.biomarkerLayoutClient.mock.calls.at(-1)?.[0]
      ?.biomarker as BiomarkerShellProjection;

    expect(clientBiomarker).toEqual(expect.objectContaining({
      about: [
        {
          body: "Reflects aerobic fitness, recovery load, stress, illness, alcohol, sleep disruption, and whether an experiment adds strain.",
          iconKey: "whyPeopleCare",
          title: "Why people care",
        },
        {
          body: "Typical adult range: 60-100 bpm; lower trends matter when sleep, recovery, and training load are stable.",
          iconKey: "howToMeasure",
          title: "How to read it",
        },
        {
          body: "Cardio training, sleep, alcohol, heat, illness, hard training, travel, dehydration, medications, stress, and device changes.",
          iconKey: "whatMovesIt",
          title: "What moves it",
        },
      ],
      key: "biomarker:resting-heart-rate",
      routeId: "resting-heart-rate",
      shortName: "RHR",
      title: "Resting Heart Rate",
    }));
    expect(markup).toContain('data-biomarker-id="resting-heart-rate"');
    expect(markup).toContain('data-biomarker-key="biomarker:resting-heart-rate"');
    expect(markup).toContain("Resting Heart Rate");
  });

  it("renders the resting-heart-rate about grid from Health Commons markdown", () => {
    const detail = resolveHealthCommonsBiomarkerDetail("resting-heart-rate");

    expect(detail).not.toBeNull();
    if (!detail) {
      throw new Error("Expected resting-heart-rate detail.");
    }

    const markup = renderToStaticMarkup(createElement(BiomarkerAboutGrid, {
      biomarker: detail,
    }));

    expect(markup).toContain("Why people care");
    expect(markup).toContain("How to read it");
    expect(markup).toContain("What moves it");
    expect(markup).toContain(
      "Reflects aerobic fitness, recovery load, stress, illness, alcohol, sleep disruption, and whether an experiment adds strain.",
    );
    expect(markup).toContain(
      "Typical adult range: 60-100 bpm; lower trends matter when sleep, recovery, and training load are stable.",
    );
    expect(markup).toContain(
      "Cardio training, sleep, alcohol, heat, illness, hard training, travel, dehydration, medications, stress, and device changes.",
    );
  });

  it("keeps three about columns for every published generated biomarker page", () => {
    const publishedRoutes = generateStaticParams().map((param) => param.biomarkerId);

    for (const routeId of publishedRoutes) {
      const detail = resolveHealthCommonsBiomarkerDetail(routeId);

      expect(detail?.about, routeId).toHaveLength(3);
    }

    expect(resolveHealthCommonsBiomarkerDetail("blood-oxygen-spo2")?.about).toEqual([
      expect.objectContaining({
        iconKey: "whyPeopleCare",
        title: "Why people care",
      }),
      expect.objectContaining({
        iconKey: "howToMeasure",
        title: "How to read it",
      }),
      expect.objectContaining({
        iconKey: "whatMovesIt",
        title: "What moves it",
      }),
    ]);
  });

  it("returns metadata for the published RHR biomarker page", async () => {
    await expect(generateMetadata({
      params: Promise.resolve({
        biomarkerId: "resting-heart-rate",
      }),
    })).resolves.toEqual(expect.objectContaining({
      alternates: {
        canonical: "/biomarkers/resting-heart-rate",
      },
      description: expect.stringContaining("quiet rest"),
      openGraph: expect.objectContaining({
        images: [
          expect.objectContaining({
            height: 630,
            url: "/biomarkers/resting-heart-rate/opengraph-image",
            width: 1200,
          }),
        ],
        type: "article",
      }),
      robots: { follow: true, index: true },
      title: "Resting Heart Rate | Murph Biomarkers",
      twitter: expect.objectContaining({
        images: [
          expect.objectContaining({
            height: 630,
            url: "/biomarkers/resting-heart-rate/opengraph-image",
            width: 1200,
          }),
        ],
      }),
    }));
  });

  it("returns notFound for unsupported biomarker pages", async () => {
    await expect(BiomarkerDetailLayout({
      children: createElement("div", null),
      params: Promise.resolve({
        biomarkerId: "unknown-biomarker",
      }),
    })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("derives biomarker protocol rankings from protocol expected signals", () => {
    const detail = resolveHealthCommonsBiomarkerDetail("estimated-vo2max");

    expect(detail?.protocolRankings.slice(0, 4).map((protocol) => protocol.title)).toEqual([
      "Norwegian 4x4",
      "Tabata 20/10 Interval Training",
      "Daily Step Floor",
      "Hyperbaric Oxygen Therapy",
    ]);

    const saunaIndex = detail?.protocolRankings.findIndex((protocol) =>
      protocol.title === "Finnish Dry Sauna"
    ) ?? -1;
    const hyperbaricIndex = detail?.protocolRankings.findIndex((protocol) =>
      protocol.title === "Hyperbaric Oxygen Therapy"
    ) ?? -1;
    const zone2Index = detail?.protocolRankings.findIndex((protocol) =>
      protocol.title === "Zone 2 Cardio"
    ) ?? -1;

    expect(zone2Index).toBe(-1);
    expect(hyperbaricIndex).toBeGreaterThanOrEqual(0);
    expect(saunaIndex).toBeGreaterThan(hyperbaricIndex);
    expect(detail?.protocolRankings[0]).toEqual(expect.objectContaining({
      evidenceLabel: "Moderate",
      fitLabel: "Strong",
      mechanism: expect.stringContaining("Sustained intervals"),
    }));
    expect(detail?.protocolRankings[0]).not.toHaveProperty("rankScore");
    expect(
      resolveHealthCommonsBiomarkerDetail("hrv-rmssd")?.protocolRankings.map((protocol) =>
        protocol.expectedSignalLabel
      ),
    ).not.toEqual(expect.arrayContaining([
      "mixed_or_contextual",
      "down_or_stable",
      "up_or_stable",
    ]));
  });

  it("excludes draft protocol variants from biomarker rankings", () => {
    const catalog = createFixtureCatalog();
    const norwegianFourByFour = catalog.entities.find((entity) =>
      entity.entityType === "protocol_variant" && entity.title === "Norwegian 4x4"
    );

    expect(norwegianFourByFour).toBeDefined();
    if (!norwegianFourByFour) {
      throw new Error("Expected the Norwegian 4x4 protocol fixture.");
    }
    norwegianFourByFour.status = "draft";

    const detail = resolveHealthCommonsBiomarkerDetail(
      "estimated-vo2max",
      createHealthCommonsCatalogReader(catalog),
    );

    expect(detail?.protocolRankings.map((protocol) => protocol.title)).not.toContain(
      "Norwegian 4x4",
    );
  });

  it("keeps incomplete biomarker pages unpublished without requiring private metric bindings", () => {
    const catalog = createFixtureCatalog();
    const biomarker = catalog.entities.find(
      (entity) => entity.key === "biomarker:resting-heart-rate",
    );

    expect(biomarker?.entityType).toBe("biomarker");

    if (!biomarker || biomarker.entityType !== "biomarker") {
      throw new Error("Expected the resting-heart-rate biomarker fixture.");
    }

    if (!biomarker.biomarker) {
      throw new Error("Expected the resting-heart-rate biomarker spec.");
    }

    biomarker.biomarker = {
      ...biomarker.biomarker,
      privateMetricBindings: [],
    };

    catalog.entities.push({
      ...biomarker,
      key: "biomarker:incomplete-rhr-fixture",
      slug: "biomarkers/incomplete-rhr-fixture",
      title: "Incomplete RHR Fixture",
      communityOutcomeSummary: undefined,
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

    const routeIds = listHealthCommonsBiomarkerRoutes(reader);
    expect(routeIds).toEqual(expect.arrayContaining([
      "blood-oxygen-spo2",
      "deep-sleep-minutes",
      "estimated-vo2max",
      "hrv-rmssd",
      "rem-sleep-minutes",
      "resting-heart-rate",
    ]));
    expect(routeIds).not.toContain("blood-glucose");
    expect(routeIds).not.toContain("incomplete-rhr-fixture");
    expect(routeIds).not.toContain("apolipoprotein-b");
    expect(routeIds).not.toContain("sleep-quality");
    expect(resolveHealthCommonsBiomarkerDetail("resting-heart-rate", reader)?.privateMetricBindings).toEqual([]);
    expect(resolveHealthCommonsBiomarkerDetail("apolipoprotein-b", reader)).toBeNull();
    expect(resolveHealthCommonsBiomarkerDetail("sleep-quality", reader)).toBeNull();
    expect(resolveHealthCommonsBiomarkerDetail("incomplete-rhr-fixture", reader)).toBeNull();
  });

  it("does not directly resolve hidden biomarker pages with protocol signals", () => {
    const catalog = createFixtureCatalog();
    const biomarker = catalog.entities.find(
      (entity) => entity.key === "biomarker:resting-heart-rate",
    );

    expect(biomarker?.entityType).toBe("biomarker");

    if (!biomarker || biomarker.entityType !== "biomarker") {
      throw new Error("Expected the resting-heart-rate biomarker fixture.");
    }

    biomarker.hidden = true;

    const reader = createHealthCommonsCatalogReader(catalog);

    expect(listHealthCommonsBiomarkerRoutes(reader)).not.toContain("resting-heart-rate");
    expect(resolveHealthCommonsBiomarkerDetail("resting-heart-rate", reader)).toBeNull();
  });
});
