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

import ExperimentDetailPage, {
  generateMetadata,
} from "../app/(dashboard)/experiments/[experimentId]/page";

describe("ExperimentDetailPage", () => {
  it("returns metadata for published experiment pages", async () => {
    await expect(generateMetadata({
      params: Promise.resolve({
        experimentId: "finnish-sauna",
      }),
    })).resolves.toEqual(expect.objectContaining({
      description: expect.stringContaining("sauna"),
      openGraph: expect.objectContaining({
        images: [
          expect.objectContaining({
            height: 630,
            url: "/opengraph-image",
            width: 1200,
          }),
        ],
        type: "article",
      }),
      title: "Finnish Dry Sauna — Murph Experiments",
      twitter: expect.objectContaining({
        images: [
          expect.objectContaining({
            height: 630,
            url: "/opengraph-image",
            width: 1200,
          }),
        ],
      }),
    }));
  });

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
        expect.stringContaining("short self-experiment"),
      ]),
      protocolLogFields: expect.arrayContaining([
        "session_duration_minutes",
        "session_start_time",
      ]),
      protocolTips: expect.arrayContaining([
        expect.stringContaining("similar time of day"),
      ]),
      title: "Finnish Dry Sauna",
      whyItWorks: expect.stringContaining("controlled whole-body heat stress"),
    }));
    expect(clientExperiment.researchStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "SOURCES CHECKED", value: 178 }),
      expect.objectContaining({ label: "DIRECT HUMAN PARTICIPANTS", value: "11,584+" }),
      expect.objectContaining({ label: "REVIEW PAPERS", value: 51 }),
      expect.objectContaining({ label: "RESEARCH PAPERS", value: 98 }),
      expect.objectContaining({ label: "YEARS COVERED", value: "1979–2026" }),
    ]));
    expect(clientExperiment.researchLandscape).toEqual(expect.objectContaining({
      bottomLine:
        "Best read as a bounded dry-sauna self-experiment for tolerability, recovery context, and short-horizon cardiovascular proxies, not as proof of long-term disease prevention or a guarantee that HRV, vascular, immune, toxin, fertility, or sleep-stage markers will improve.",
      confidenceLabel: "mixed",
      mainCaveat:
        "The extracted evidence is heterogeneous, several adjacent intervention endpoints are mixed or null, major cohort findings are context only, and external high-heat routines should stay separate from the Murph canonical protocol.",
      primaryClaim:
        "The practical support is strongest for tracking resting heart rate, optional morning blood pressure, session tolerance, symptoms, and context over repeated dry-sauna sessions, not for expecting a uniform improvement.",
    }));
    expect(clientExperiment.studies.length).toBeGreaterThan(0);
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
      researchSummaryLabel: "193 studies + 57 reviews",
      studyCount: 193,
      title: expect.stringContaining("Bryan Johnson"),
    }));
    expect(clientExperiment.researchLandscape).toEqual(expect.objectContaining({
      confidenceLabel: "limited",
      primaryClaim: expect.stringContaining("source-attributed"),
    }));
    expect(clientExperiment.researchStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "SOURCES CHECKED", value: 288 }),
      expect.objectContaining({ label: "DIRECT HUMAN PARTICIPANTS", value: "34,925+" }),
      expect.objectContaining({ label: "REVIEW PAPERS", value: 57 }),
      expect.objectContaining({ label: "RESEARCH PAPERS", value: 193 }),
      expect.objectContaining({ label: "YEARS COVERED", value: "1965–2026" }),
    ]));
    expect(clientExperiment.studies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "Most people might miss the biggest benefit of sauna",
        type: "SRC",
      }),
      expect.objectContaining({
        title: "My #1 Longevity Protocol of 2025",
        type: "SRC",
      }),
      expect.objectContaining({
        title: "My Morning Routine (2026)",
        type: "SRC",
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

    expect(clientExperiment.researchStats).toEqual([
      { label: "SOURCES CHECKED", value: 32 },
      { label: "DIRECT HUMAN PARTICIPANTS", value: "1,269+" },
      { label: "REVIEW PAPERS", value: 8 },
      { label: "RESEARCH PAPERS", value: 19 },
      { label: "YEARS COVERED", value: "2004–2024" },
    ]);
    expect(clientExperiment.researchLandscape).toEqual(expect.objectContaining({
      bottomLine:
        "Best read as a bounded cardio-fitness experiment: the strongest proof comes from two small direct 4x4 trials, the next layer shows how to hit the intended dose, and the rest mainly sets boundaries around safety, clinical mismatch, and nearby variants.",
      confidenceLabel: "moderate",
      mainCaveat:
        "The direct 4x4 trials are small, while many larger papers come from supervised cardiac or cardiometabolic settings. Those studies help set boundaries, not prove that unscreened home users should self-treat disease or expect every metric to improve.",
      primaryClaim:
        "If vigorous exercise is appropriate for you, the best-supported claim is that a well-executed 4x4 block can improve lab VO2max, and sometimes a wearable cardio-fitness proxy, over roughly six weeks.",
    }));
    expect(clientExperiment.researchGroups?.length).toBeGreaterThanOrEqual(6);
    expect(
      clientExperiment.researchGroups?.map((group) => ({
        defaultOpen: group.defaultOpen ?? false,
        id: group.id,
        label: group.label,
        stance: group.stance,
      })),
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({
        defaultOpen: true,
        id: "exact-or-close-4x4-trials",
        label: "Exact or close 4x4 trials",
        stance: "supports",
      }),
      expect.objectContaining({
        defaultOpen: true,
        id: "dose-fidelity-and-implementation",
        label: "Dose, target zone, and implementation",
        stance: "supports",
      }),
      expect.objectContaining({
        defaultOpen: false,
        id: "safety-boundary",
        label: "Safety boundaries",
        stance: "safety_boundary",
      }),
    ]));
    expect(
      clientExperiment.researchGroups?.every((group) =>
        group.studies.every((study) => typeof study.implication === "string" && study.implication.length > 0)
      ),
    ).toBe(true);
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

    const safetyRegistryStudy = clientExperiment.studies.find((study) =>
      study.title === "Cardiovascular risk of high- versus moderate-intensity aerobic exercise in coronary heart disease patients"
    );

    expect(safetyRegistryStudy).toEqual(expect.objectContaining({
      finding:
        "The registry compared adverse events during supervised high-intensity and moderate-intensity exercise in coronary heart disease rehabilitation. Serious events were rare across many training hours, but they were not zero. The finding supports a low-risk-with-supervision frame, not a blanket claim that high intensity is safe for everyone.",
    }));
    expect(safetyRegistryStudy?.finding).not.toBe(
      "Quantified supervised cardiac-rehabilitation safety registry; key low-but-not-zero risk framing.",
    );
    expect(
      clientExperiment.researchGroups?.find((group) => group.id === "safety-boundary")?.studies,
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({
        implication:
          "Supports a low-risk-with-supervision frame and justifies strong stop-condition language.",
        result: "not_efficacy_evidence",
        scope: "clinical_supervised",
        stance: "safety_boundary",
        title:
          "Cardiovascular risk of high- versus moderate-intensity aerobic exercise in coronary heart disease patients",
      }),
      expect.objectContaining({
        implication:
          "Supports caution language for symptoms, recent illness, heart disease, and other higher-risk situations.",
        result: "not_efficacy_evidence",
        scope: "general_guideline",
        stance: "safety_boundary",
        title:
          "Exercise-related acute cardiovascular events and potential deleterious adaptations following long-term exercise training: placing the risks into perspective",
      }),
    ]));
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
