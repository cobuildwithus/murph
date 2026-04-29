import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveHealthCommonsExperimentProtocol } from "@/src/lib/health-commons/experiment-detail";
import type { ResearchTabExperiment } from "@/src/components/experiments/experiment-detail/research-tab";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  researchTab: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

vi.mock("@/src/components/experiments/experiment-detail/research-tab", () => ({
  ResearchTab({
    experiment,
  }: {
    experiment: ResearchTabExperiment;
  }) {
    mocks.researchTab({ experiment });

    return createElement(
      "div",
      {
        "data-experiment-id": experiment.id,
        "data-study-count": experiment.studies.length,
      },
      experiment.researchLandscape?.primaryClaim ?? experiment.id,
    );
  },
}));

import ExperimentResearchPage, {
  generateMetadata,
} from "../app/(dashboard)/experiments/[experimentId]/research/page";

describe("ExperimentResearchPage", () => {
  beforeEach(() => {
    mocks.notFound.mockClear();
    mocks.researchTab.mockClear();
  });

  it("loads the research-tab projection without the full experiment resolver or BrowserVault client path", async () => {
    const source = readFileSync(
      new URL("../app/(dashboard)/experiments/[experimentId]/research/page.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("loadGeneratedExperimentResearchTab");
    expect(source).not.toContain("resolveHealthCommonsExperimentProtocol");
    expect(source).not.toContain("ResearchTabClient");
    expect(source).not.toContain("useBrowserVault");
  });

  it("returns metadata from the minimal projection", async () => {
    await expect(generateMetadata({
      params: Promise.resolve({
        experimentId: "finnish-sauna",
      }),
    })).resolves.toEqual(expect.objectContaining({
      description: expect.stringContaining("traditional dry-sauna"),
      openGraph: expect.objectContaining({
        type: "article",
      }),
      title: "Finnish Dry Sauna research — Murph Experiments",
    }));
  });

  it("renders the same Finnish sauna research fields as the full detail model", async () => {
    const fullProtocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");
    if (!fullProtocol) {
      throw new Error("Expected the full Finnish sauna protocol.");
    }

    const element = await ExperimentResearchPage({
      params: Promise.resolve({
        experimentId: "murph-finnish-standard-3x-week",
      }),
    });
    const markup = renderToStaticMarkup(element);
    const experiment = mocks.researchTab.mock.calls.at(-1)?.[0]
      ?.experiment as ResearchTabExperiment;

    expect(experiment).toEqual(expect.objectContaining({
      id: "finnish-sauna",
      protocolKeepInMind: fullProtocol.protocolKeepInMind,
      researchStats: fullProtocol.researchStats,
      studies: fullProtocol.studies,
    }));
    expect(experiment.researchLandscape).toEqual(fullProtocol.researchLandscape
      ? {
          bottomLine: fullProtocol.researchLandscape.bottomLine,
          confidenceLabel: fullProtocol.researchLandscape.confidenceLabel,
          mainCaveat: fullProtocol.researchLandscape.mainCaveat,
          primaryClaim: fullProtocol.researchLandscape.primaryClaim,
        }
      : undefined);
    expect(experiment.researchGroups).toEqual(fullProtocol.researchGroups);
    expect(markup).toContain('data-experiment-id="finnish-sauna"');
    expect(markup).toContain(`data-study-count="${fullProtocol.studies.length}"`);
  });

  it("routes missing experiment research projections to notFound", async () => {
    await expect(
      ExperimentResearchPage({
        params: Promise.resolve({
          experimentId: "missing-health-commons-route",
        }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });

  it("routes hidden protocol variants to notFound even when a route index entry exists", async () => {
    await expect(
      ExperimentResearchPage({
        params: Promise.resolve({
          experimentId: "hydrolyzed-collagen-peptides",
        }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });
});
