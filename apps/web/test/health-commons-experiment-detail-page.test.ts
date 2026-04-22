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
      expect.objectContaining({ label: "SOURCES CHECKED", value: 93 }),
      expect.objectContaining({ label: "DIRECT HUMAN PARTICIPANTS", value: "11,706+" }),
      expect.objectContaining({ label: "REVIEW PAPERS", value: 22 }),
      expect.objectContaining({ label: "RESEARCH PAPERS", value: 71 }),
      expect.objectContaining({ label: "YEARS COVERED", value: "1979–2026" }),
    ]));
    expect(clientExperiment.researchLandscape).toEqual(expect.objectContaining({
      bottomLine:
        "Best read as a bounded dry-sauna self-experiment for near-term recovery and cardiovascular proxies, not as proof of long-term disease prevention or a guarantee that HRV, vascular, gut, or inflammatory markers will improve.",
      confidenceLabel: "mixed",
      mainCaveat:
        "The strongest long-term findings are observational, several modern intervention endpoints are null or mixed, and post-exercise, cold-immersion, clinical, extreme-heat, infrared, and steam-sauna contexts must stay separate.",
      primaryClaim:
        "The most practical support is for testing resting heart rate, optional morning blood pressure, recovery context, and session tolerance across repeated dry-sauna sessions.",
    }));
    expect(
      clientExperiment.researchGroups?.map((group) => ({
        count: group.studies.length,
        defaultOpen: group.defaultOpen ?? false,
        id: group.id,
        label: group.label,
        stance: group.stance,
      })),
    ).toEqual([
      {
        count: 21,
        defaultOpen: false,
        id: "evidence-backbone-and-claim-calibration",
        label: "Evidence backbone and claim calibration",
        stance: "mixed",
      },
      {
        count: 18,
        defaultOpen: false,
        id: "near-term-autonomic-vascular-and-immune-signals",
        label: "Near-term physiology and wearable signals",
        stance: "mixed",
      },
      {
        count: 19,
        defaultOpen: false,
        id: "long-term-finnish-cohort-and-real-world-context",
        label: "Long-term Finnish cohort and real-world context",
        stance: "context_only",
      },
      {
        count: 17,
        defaultOpen: false,
        id: "intervention-design-training-and-mixed-results",
        label: "Intervention design, training, and mixed results",
        stance: "mixed",
      },
      {
        count: 18,
        defaultOpen: false,
        id: "safety-dose-modality-and-context-boundaries",
        label: "Safety, dose, and modality boundaries",
        stance: "safety_boundary",
      },
    ]);
    expect(
      clientExperiment.researchGroups?.every((group) =>
        group.studies.every((study) => typeof study.implication === "string" && study.implication.length > 0)
      ),
    ).toBe(true);
    expect(
      clientExperiment.researchGroups?.find((group) => group.id === "near-term-autonomic-vascular-and-immune-signals")?.studies,
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({
        implication:
          "This source is one of the best sources for choosing pre/post BP, HR, and recovery signals.",
        participants: 102,
        population: "Adults with cardiovascular risk factors",
        scope: "direct_protocol",
        title: "Acute effects of sauna bathing on cardiovascular function",
        type: "MECH",
      }),
      expect.objectContaining({
        duration: "Single sauna plus cold-water session",
        implication:
          "Use it to justify near-term cardiovascular signal tracking without silently merging cold exposure into the default protocol.",
        participants: 37,
        population: "Heart failure, CAD, and control participants",
        scope: "adjacent_variant",
        title:
          "Acute effects of Finnish sauna and cold-water immersion on haemodynamic variables and autonomic nervous system activity in patients with heart failure",
        type: "MECH",
      }),
      expect.objectContaining({
        duration: "Single-session 2 x 10-minute Finnish sauna exposure",
        implication:
          "Supports vascular plausibility while keeping clinical status and screening visible.",
        participants: 22,
        population: "Middle-aged and older adults with stable coronary artery disease",
        scope: "clinical_supervised",
        title: "Acute Vascular Benefits of Finnish Sauna Bathing in Patients With Stable Coronary Artery Disease",
        type: "MECH",
      }),
    ]));
    expect(clientExperiment.studies).toHaveLength(93);
    const overlappingFlatStudy = clientExperiment.studies.find((study) =>
      study.title === "Acute effects of Finnish sauna and cold-water immersion on haemodynamic variables and autonomic nervous system activity in patients with heart failure"
    );
    expect(overlappingFlatStudy).toEqual(expect.objectContaining({
      participants: 37,
      population: "Heart failure, CAD, and control participants",
      title:
        "Acute effects of Finnish sauna and cold-water immersion on haemodynamic variables and autonomic nervous system activity in patients with heart failure",
      type: "MECH",
    }));
    expect(overlappingFlatStudy?.groupId).toBeUndefined();
    expect(overlappingFlatStudy?.scope).toBeUndefined();
    expect(overlappingFlatStudy?.stance).toBeUndefined();
    expect(overlappingFlatStudy?.implication).toBeUndefined();
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
      researchSummaryLabel: "11 studies + 3 reviews",
      studyCount: 11,
      title: expect.stringContaining("Bryan Johnson"),
    }));
    expect(clientExperiment.researchGroups).toHaveLength(8);
    expect(clientExperiment.researchGroups).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "independent-sauna-physiology-context",
        label: "Independent heat-load context",
      }),
      expect.objectContaining({
        id: "post-workout-training-context",
        label: "Post-workout and recovery evidence",
      }),
      expect.objectContaining({
        id: "safety-fertility-cooling-boundary",
        label: "Fertility and groin-cooling boundary",
      }),
    ]));
    expect(clientExperiment.researchStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "SOURCES CHECKED", value: 26 }),
      expect.objectContaining({ label: "DIRECT HUMAN PARTICIPANTS", value: "2,557+" }),
      expect.objectContaining({ label: "REVIEW PAPERS", value: 3 }),
      expect.objectContaining({ label: "RESEARCH PAPERS", value: 11 }),
      expect.objectContaining({ label: "YEARS COVERED", value: "1998–2025" }),
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
      expect.objectContaining({
        journal: "Blueprint Page",
        participants: 1,
        title: "My Morning Routine 2026",
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

    expect(clientExperiment.researchStats).toEqual([
      { label: "SOURCES CHECKED", value: 29 },
      { label: "DIRECT HUMAN PARTICIPANTS", value: "1,269+" },
      { label: "REVIEW PAPERS", value: 8 },
      { label: "RESEARCH PAPERS", value: 17 },
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
    expect(clientExperiment.researchGroups).toHaveLength(6);
    expect(
      clientExperiment.researchGroups?.map((group) => ({
        count: group.studies.length,
        defaultOpen: group.defaultOpen ?? false,
        id: group.id,
        label: group.label,
        stance: group.stance,
      })),
    ).toEqual([
      {
        count: 2,
        defaultOpen: true,
        id: "exact-or-close-4x4-trials",
        label: "Exact or close 4x4 trials",
        stance: "supports",
      },
      {
        count: 3,
        defaultOpen: true,
        id: "dose-fidelity-and-implementation",
        label: "Dose, target zone, and implementation",
        stance: "supports",
      },
      {
        count: 2,
        defaultOpen: false,
        id: "broader-hiit-vo2-context",
        label: "Broader HIIT and VO2max context",
        stance: "context_only",
      },
      {
        count: 11,
        defaultOpen: false,
        id: "clinical-context-mixed-superiority",
        label: "Clinical lineage and mixed superiority",
        stance: "mixed",
      },
      {
        count: 6,
        defaultOpen: false,
        id: "safety-boundary",
        label: "Safety boundaries",
        stance: "safety_boundary",
      },
      {
        count: 5,
        defaultOpen: false,
        id: "adjacent-variants-and-recovery-context",
        label: "Nearby protocols and recovery context",
        stance: "context_only",
      },
    ]);
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
