import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION } from "@/src/lib/experiments/experiment-detail";
import type { ExperimentProtocol } from "@/src/types/experiments";

const mocks = vi.hoisted(() => ({
  experimentDetailClient: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

vi.mock("../app/(dashboard)/experiments/[experimentId]/experiment-detail-client", () => ({
  ExperimentDetailClient({
    protocol,
  }: {
    protocol: ExperimentProtocol;
  }) {
    mocks.experimentDetailClient({ protocol });

    return createElement(
      "div",
      {
        "data-experiment-id": protocol.id,
        "data-experiment-key": protocol.commons?.key,
      },
      protocol.title,
    );
  },
}));

import ExperimentDetailPage from "../app/(dashboard)/experiments/[experimentId]/page";

describe("ExperimentDetailPage", () => {
  it("hands the Health Commons sauna protocol through to the client shell", async () => {
    const element = await ExperimentDetailPage({
      params: Promise.resolve({
        experimentId: "finnish-sauna",
      }),
    });
    const markup = renderToStaticMarkup(element);

    expect(mocks.experimentDetailClient).toHaveBeenCalledTimes(1);
    const clientExperiment = mocks.experimentDetailClient.mock.calls[0]?.[0]
      ?.protocol as ExperimentProtocol;

    expect(clientExperiment).toEqual(expect.objectContaining({
      commons: expect.objectContaining({
        key: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
        routeId: "finnish-sauna",
      }),
      id: "finnish-sauna",
      protocolContractVersion: CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION,
      protocolFacts: expect.arrayContaining([
        expect.objectContaining({ label: "Baseline", value: "7 days" }),
        expect.objectContaining({ label: "Intervention", value: "14 days" }),
      ]),
      protocolKeepInMind: expect.arrayContaining([
        expect.stringContaining("short-term recovery"),
      ]),
      protocolLogFields: expect.arrayContaining([
        "duration",
        "time of day",
      ]),
      protocolTips: expect.arrayContaining([
        expect.stringContaining("similar time of day"),
      ]),
      title: "Finnish Dry Sauna",
      whyItWorks: expect.stringContaining("heat stressor"),
    }));
    expect(clientExperiment.researchStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "STUDIES", value: 81 }),
      expect.objectContaining({ label: "REVIEWS", value: 17 }),
      expect.objectContaining({ label: "JOURNAL ARTICLES", value: 64 }),
      expect.objectContaining({ label: "RESEARCH YEARS", value: "1979–2026" }),
    ]));
    expect(clientExperiment.studies).toHaveLength(81);
    expect(clientExperiment.studies[0]).toEqual(expect.objectContaining({
      title: "Health effects and risks of sauna bathing",
      type: expect.any(String),
    }));
    expect(markup).toContain('data-experiment-id="finnish-sauna"');
    expect(markup).toContain(
      'data-experiment-key="protocol_variant:dry-sauna/murph-finnish-standard-3x-week"',
    );
    expect(markup).toContain("Finnish Dry Sauna");
  });

  it("resolves a unique trailing slug segment for non-Finnish protocol variants", async () => {
    const element = await ExperimentDetailPage({
      params: Promise.resolve({
        experimentId: "bryan-johnson-blueprint",
      }),
    });
    const markup = renderToStaticMarkup(element);

    expect(mocks.experimentDetailClient).toHaveBeenCalledWith({
      protocol: expect.objectContaining({
        commons: expect.objectContaining({
          aliases: expect.arrayContaining(["bryan-johnson-blueprint"]),
          key: "protocol_variant:dry-sauna/bryan-johnson-blueprint",
        }),
        id: "bryan-johnson-blueprint",
        title: "Bryan Johnson Blueprint Sauna",
      }),
    });
    expect(markup).toContain('data-experiment-id="bryan-johnson-blueprint"');
    expect(markup).toContain(
      'data-experiment-key="protocol_variant:dry-sauna/bryan-johnson-blueprint"',
    );
  });

  it("routes missing experiment ids to notFound", async () => {
    await expect(
      ExperimentDetailPage({
        params: Promise.resolve({
          experimentId: "missing-health-commons-route",
        }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });
});
