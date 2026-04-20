import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
      title: "Murph Finnish Dry Sauna",
    }));
    expect(clientExperiment.researchStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "CITED SOURCES" }),
      expect.objectContaining({ label: "JOURNAL ARTICLES" }),
      expect.objectContaining({ label: "RESEARCH YEARS" }),
    ]));
    expect(clientExperiment.studies.length).toBeGreaterThan(0);
    expect(clientExperiment.studies[0]).toEqual(expect.objectContaining({
      title: expect.any(String),
      type: expect.any(String),
    }));
    expect(markup).toContain('data-experiment-id="finnish-sauna"');
    expect(markup).toContain(
      'data-experiment-key="protocol_variant:dry-sauna/murph-finnish-standard-3x-week"',
    );
    expect(markup).toContain("Murph Finnish Dry Sauna");
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
