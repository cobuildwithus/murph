import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ProtocolTab,
  type ProtocolTabExperiment,
} from "@/src/components/experiments/experiment-detail/protocol-tab";
import { resolveHealthCommonsExperimentProtocolTab } from "@/src/lib/health-commons/experiment-projections";

function buildExperiment(
  signal: ProtocolTabExperiment["expectedSignals"][number],
): ProtocolTabExperiment {
  return {
    baselineDays: 7,
    durationDays: 21,
    expectedSignals: [signal],
    experts: [],
    id: "pre-sleep-resonance-breathing-and-meditation",
    measurementPaths: [],
    mechanismChain: [],
    protocol: [],
    protocolFacts: [],
    protocolTips: [],
    safety: {
      cautionLevel: 1,
      precautions: [],
      whoShouldAvoid: [],
    },
    whyItWorks: "",
  };
}

describe("ProtocolTab signal display", () => {
  it("keeps generated subjective signal headlines human-readable", () => {
    const expectedSignals = [
      {
        routeId: "cold-plunge",
        label: "Self-Reported Mood",
        expected: "Mood lift",
        direction: "up",
      },
      {
        routeId: "pneumatic-compression-pants",
        label: "Muscle Soreness Score",
        expected: "Less sore",
        direction: "down",
      },
      {
        routeId: "pneumatic-compression-pants",
        label: "Leg Heaviness Score",
        expected: "Lighter legs",
        direction: "down",
      },
      {
        routeId: "pneumatic-compression-pants",
        label: "Perceived Recovery Score",
        expected: "More recovered",
        direction: "up",
      },
    ];

    for (const expectedSignal of expectedSignals) {
      const protocolTab = resolveHealthCommonsExperimentProtocolTab(
        expectedSignal.routeId,
      );
      const signal = protocolTab?.expectedSignals.find((candidate) =>
        candidate.label === expectedSignal.label
      );

      expect(signal, `${expectedSignal.routeId}: ${expectedSignal.label}`)
        .toBeDefined();
      expect(signal?.expected).toBe(expectedSignal.expected);
      expect(signal?.direction).toBe(expectedSignal.direction);
      expect(signal?.estimatedChange?.kind).toBe("mixed_or_contextual");
      expect(signal?.estimatedChange).not.toHaveProperty("unit");
    }
  });

  it("uses displayValue instead of rendering subjective rating units as the headline", () => {
    const markup = renderToStaticMarkup(createElement(ProtocolTab, {
      experiment: buildExperiment({
        biomarkerRouteId: "pre-sleep-arousal",
        delta: "",
        description: "Breath pacing gives attention a repeatable low-threat task.",
        direction: "down",
        displayValue: "Less wired",
        estimatedChange: {
          confidence: "low",
          high: -1,
          kind: "absolute",
          low: -3,
          unit: "0-10 rating points",
          window: "14 nights vs 7-night baseline",
        },
        expected: "Could trend lower",
        label: "Pre-Sleep Arousal",
        value: "",
      }),
    }));

    expect(markup).toContain('data-card="Pre-Sleep Arousal"');
    expect(markup).toContain("Less wired");
    expect(markup).toContain(
      "Pre-Sleep Arousal projected less wired over 14 nights vs 7-night baseline",
    );
    expect(markup).not.toContain("0-10 rating points");
  });

  it("uses the expected label for contextual subjective estimates", () => {
    const markup = renderToStaticMarkup(createElement(ProtocolTab, {
      experiment: buildExperiment({
        biomarkerRouteId: "pre-sleep-arousal",
        delta: "",
        description: "Breath pacing gives attention a repeatable low-threat task.",
        direction: "down",
        estimatedChange: {
          confidence: "low",
          kind: "mixed_or_contextual",
          window: "14 nights vs 7-night baseline",
        },
        expected: "Less wired",
        label: "Pre-Sleep Arousal",
        value: "",
      }),
    }));

    expect(markup).toContain("Less wired");
    expect(markup).toContain(
      "Pre-Sleep Arousal tracked as less wired over 14 nights vs 7-night baseline",
    );
    expect(markup).not.toContain("0-10 rating points");
  });
});
