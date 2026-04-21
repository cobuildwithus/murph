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
    const clientExperiment = mocks.experimentDetailClient.mock.calls.at(-1)?.[0]
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
      whyItWorks: expect.stringContaining("controlled whole-body heat load"),
    }));
    expect(clientExperiment.researchStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "SOURCES CHECKED", value: 81 }),
      expect.objectContaining({ label: "REVIEW PAPERS", value: 17 }),
      expect.objectContaining({ label: "RESEARCH PAPERS", value: 64 }),
      expect.objectContaining({ label: "YEARS COVERED", value: "1979–2026" }),
    ]));
    expect(clientExperiment.studies).toHaveLength(81);
    const highestParticipantCount = Math.max(
      ...clientExperiment.studies.map((study) => study.participants ?? -1),
    );
    const highestParticipantCountYears = clientExperiment.studies
      .filter((study) => study.participants === highestParticipantCount)
      .map((study) => study.year)
      .filter((year): year is number => typeof year === "number");
    expect(clientExperiment.studies[0]).toEqual(expect.objectContaining({
      participants: highestParticipantCount,
      type: expect.any(String),
    }));
    if (highestParticipantCountYears.length > 0) {
      expect(clientExperiment.studies[0]?.year).toBe(
        Math.max(...highestParticipantCountYears),
      );
    }
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

    const clientExperiment = mocks.experimentDetailClient.mock.calls.at(-1)?.[0]
      ?.protocol as ExperimentProtocol;

    expect(clientExperiment).toEqual(expect.objectContaining({
      commons: expect.objectContaining({
        aliases: expect.arrayContaining(["bryan-johnson-blueprint"]),
        key: "protocol_variant:dry-sauna/bryan-johnson-blueprint",
      }),
      id: "bryan-johnson-blueprint",
      researchSummaryLabel: "n=1 report",
      studyCount: 12,
      title: expect.stringContaining("Bryan Johnson"),
    }));
    expect(clientExperiment.researchStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "SOURCES CHECKED", value: 12 }),
      expect.objectContaining({ label: "TOTAL PARTICIPANTS", value: "1" }),
    ]));
    expect(clientExperiment.studies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        designLabel: "Single-person report",
        journal: "Substack Post",
        participants: 1,
        population: "Bryan Johnson",
        title: "31 brutal minutes to saunamaxx",
        type: "N1",
      }),
      expect.objectContaining({
        journal: "LinkedIn Post",
        participants: 1,
        title: "Most people might miss the biggest benefit of sauna",
        type: "N1",
      }),
      expect.objectContaining({
        journal: "X Post",
        participants: 1,
        title: "Core-temperature sauna update",
        type: "N1",
      }),
      expect.objectContaining({
        participantCountKind: "reported",
        journal: "Blueprint Page",
        participants: 1,
        title: "My #1 Longevity Protocol of 2025",
        type: "N1",
      }),
    ]));
    expect(markup).toContain('data-experiment-id="bryan-johnson-blueprint"');
    expect(markup).toContain(
      'data-experiment-key="protocol_variant:dry-sauna/bryan-johnson-blueprint"',
    );
  });

  it("prefers newer years when participant counts tie in the research list", async () => {
    const element = await ExperimentDetailPage({
      params: Promise.resolve({
        experimentId: "bryan-johnson-blueprint",
      }),
    });
    renderToStaticMarkup(element);

    const clientExperiment = mocks.experimentDetailClient.mock.calls.at(-1)?.[0]
      ?.protocol as ExperimentProtocol;
    const yearsForSingleParticipantSources = clientExperiment.studies
      .filter((study) => study.participants === 1 && typeof study.year === "number")
      .map((study) => study.year as number);

    expect(yearsForSingleParticipantSources.length).toBeGreaterThan(1);
    expect(yearsForSingleParticipantSources).toEqual(
      [...yearsForSingleParticipantSources].sort((left, right) => right - left),
    );
  });

  it("projects Norwegian 4x4 coded evidence metadata into research stats and study rows", async () => {
    const element = await ExperimentDetailPage({
      params: Promise.resolve({
        experimentId: "norwegian-4x4",
      }),
    });
    renderToStaticMarkup(element);

    const clientExperiment = mocks.experimentDetailClient.mock.calls.at(-1)?.[0]
      ?.protocol as ExperimentProtocol;

    expect(clientExperiment.researchStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "TOTAL PARTICIPANTS", value: "6,115+" }),
      expect.objectContaining({ label: "SOURCES CHECKED", value: 28 }),
      expect.objectContaining({ label: "YEARS COVERED", value: "2004–2024" }),
    ]));
    expect(clientExperiment.studies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        designLabel: "Four-arm randomized training trial",
        participantCountKind: "reported",
        participants: 40,
        population: "Moderately trained men",
        type: "RCT",
      }),
      expect.objectContaining({
        includedStudyCount: 23,
        participants: 1374,
        type: "MA",
      }),
    ]));
    expect(
      clientExperiment.studies.findIndex((study) => study.participants === 1374),
    ).toBeLessThan(
      clientExperiment.studies.findIndex((study) => study.participants === 40),
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
