import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { composeExperimentDetail } from "@/src/lib/experiments/experiment-detail";
import { resolveHealthCommonsExperimentProtocol } from "@/src/lib/health-commons/experiment-detail";
import type { ExperimentResearchGroup } from "@/src/types/experiments";

vi.mock("@/src/components/experiments/experiment-detail/expected-signal-card", () => ({
  ExpectedSignalCard({ label }: { label: string }) {
    return createElement("div", { "data-card": label }, label);
  },
}));

vi.mock("@/src/components/experiments/experiment-detail/experiment-progress", () => ({
  ExperimentProgress({
    baselineLabel,
    overallPercent,
    protocolLabel,
  }: {
    baselineLabel: string;
    overallPercent: number;
    protocolLabel: string;
  }) {
    return createElement(
      "div",
      {
        "data-progress-baseline": baselineLabel,
        "data-progress-percent": String(overallPercent),
        "data-progress-protocol": protocolLabel,
      },
      `${baselineLabel} | ${protocolLabel} | ${overallPercent}`,
    );
  },
}));

vi.mock("@/src/components/experiments/experiment-detail/expert-card", () => ({
  ExpertCard({ name }: { name: string }) {
    return createElement("div", null, name);
  },
}));

vi.mock("@/src/components/experiments/experiment-detail/study-card", () => ({
  StudyCard({ title }: { title: string }) {
    return createElement("div", null, title);
  },
}));

vi.mock("@/src/components/experiments/experiment-detail/safety-section", () => ({
  SafetySection() {
    return createElement("div", null, "safety");
  },
}));

import { ProtocolTab } from "@/src/components/experiments/experiment-detail/protocol-tab";

describe("ProtocolTab", () => {
  it("renders the protocol layout without generic step labels or duplicated summary copy", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("bryan-johnson-blueprint");

    expect(protocol).not.toBeNull();

    const experiment = composeExperimentDetail({
      protocol: protocol!,
      privateRun: null,
    });
    const markup = renderToStaticMarkup(createElement(ProtocolTab, { experiment }));
    const summaryParagraph = experiment.whyItWorks.split("\n\n")[0]?.trim();

    expect(markup).toContain("Run the protocol");
    expect(markup).toContain("At a glance");
    expect(markup).toContain("Why it works");
    expect(markup).toContain("Baseline · 7 days");
    expect(markup).toContain("Protocol · 14 days");
    expect(markup).toContain('data-progress-percent="33"');
    expect(markup).not.toContain("days to analysis");
    expect(markup).not.toContain("Total run");
    expect(markup).not.toContain("Protocol window");
    expect(markup).not.toContain("Before change");
    expect(markup).not.toContain("Step 1");
    expect(markup).not.toContain("STEP 1");

    expect(summaryParagraph).toBeTruthy();
    expect(countOccurrences(markup, summaryParagraph!)).toBe(1);
  });

  it("caps focus cards at three and moves overflow signals into context pills", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const experiment = composeExperimentDetail({
      protocol: protocol!,
      privateRun: null,
    });
    const markup = renderToStaticMarkup(createElement(ProtocolTab, { experiment }));

    expect(markup).toContain("What could change");
    expect(markup).toContain("Also worth watching");
    expect(countOccurrences(markup, "data-card=")).toBe(3);
    expect(markup).toContain('data-card="Resting Heart Rate"');
    expect(markup).toContain('data-card="Morning Blood Pressure"');
    expect(markup).toContain('data-card="HRV / RMSSD"');
    expect(markup).not.toContain('data-card="Sleep Efficiency"');
    expect(markup).not.toContain('data-card="Deep Sleep Minutes"');
    expect(markup).toContain("Sleep Efficiency");
    expect(markup).toContain("Deep Sleep Minutes");
    expect(markup).toContain("Bottom line");
    expect(markup).toContain("Best-supported claim");
    expect(markup).toContain("Confidence · Mixed");
    expect(markup).not.toContain("Evidence backbone and claim calibration");
    expect(markup).not.toContain("Read these top to bottom");
  });

  it("keeps the Bryan Johnson sauna hierarchy focused on tolerability signals", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("bryan-johnson-blueprint");

    expect(protocol).not.toBeNull();

    const experiment = composeExperimentDetail({
      protocol: protocol!,
      privateRun: null,
    });
    const markup = renderToStaticMarkup(createElement(ProtocolTab, { experiment }));

    expect(markup).toContain("What could change");
    expect(countOccurrences(markup, "data-card=")).toBe(2);
    expect(markup).toContain('data-card="HRV / RMSSD"');
    expect(markup).toContain('data-card="Resting Heart Rate"');
    expect(markup).not.toContain("Also worth watching");
  });

  it("prioritizes aerobic adaptation signals for Norwegian 4x4 and leaves slower proxies in context", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("norwegian-4x4");

    expect(protocol).not.toBeNull();

    const experiment = composeExperimentDetail({
      protocol: protocol!,
      privateRun: null,
    });
    const markup = renderToStaticMarkup(createElement(ProtocolTab, { experiment }));

    expect(markup).toContain("What could change");
    expect(markup).toContain("Also worth watching");
    expect(countOccurrences(markup, "data-card=")).toBe(3);
    expect(markup).toContain('data-card="Estimated VO2max"');
    expect(markup).toContain('data-card="HRV / RMSSD"');
    expect(markup).toContain('data-card="Resting Heart Rate"');
    expect(markup).not.toContain('data-card="Morning Blood Pressure"');
    expect(markup).not.toContain('data-card="Sleep Efficiency"');
    expect(markup).toContain("Morning Blood Pressure");
    expect(markup).toContain("Sleep Efficiency");
    expect(markup).toContain("Bottom line");
    expect(markup).toContain("Best-supported claim");
    expect(markup).toContain("Confidence · Moderate");
    expect(markup).toContain("Exact or close 4x4 trials");
    expect(markup).toContain("Dose, target zone, and implementation");
    expect(markup).toContain("Broader HIIT and VO2max context");
    expect(markup).toContain("Clinical lineage and mixed superiority");
    expect(markup).toContain("Safety boundaries");
    expect(markup).toContain("Nearby protocols and recovery context");
    expect(markup).toContain("Read these top to bottom");
  });

  it("renders grouped research inside native details cards with source-mix summaries", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("norwegian-4x4");

    expect(protocol).not.toBeNull();

    const experiment = composeExperimentDetail({
      protocol: protocol!,
      privateRun: null,
    });
    const markup = renderToStaticMarkup(createElement(ProtocolTab, { experiment }));

    expect(countOccurrences(markup, "<details")).toBe(6);
    expect(countOccurrences(markup, 'open=""')).toBe(2);
    expect(markup).toContain("2 sources · 2 trials");
    expect(markup).toContain("3 sources · 1 physiology study · 1 trial · 1 guidance source");
    expect(markup).toContain("11 sources · 9 trials · 2 reviews");
    expect(markup).toContain("6 sources · 3 guidance sources · 2 reviews · 1 observational study");
  });

  it("shortens long Finnish research-group labels at display time only", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();

    const baseExperiment = composeExperimentDetail({
      protocol: protocol!,
      privateRun: null,
    });
    const researchGroups: ExperimentResearchGroup[] = [
      {
        id: "near-term-autonomic-vascular-and-immune-signals",
        label: "Synthetic fallback label that should not drive the display mapping",
        stance: "mixed",
        summary: "Synthetic grouped-research proof for the UI-only label formatting pass.",
        defaultOpen: true,
        studies: [
          {
            type: "MECH",
            title: "Physiology study A",
            authors: "A Team",
            journal: "Example Journal",
          },
          {
            type: "MECH",
            title: "Physiology study B",
            authors: "A Team",
            journal: "Example Journal",
          },
          {
            type: "INT",
            title: "Intervention study",
            authors: "B Team",
            journal: "Example Journal",
          },
          {
            type: "REV",
            title: "Review study",
            authors: "C Team",
            journal: "Example Journal",
          },
        ],
      },
    ];
    const experiment = {
      ...baseExperiment,
      researchGroups,
    };
    const markup = renderToStaticMarkup(createElement(ProtocolTab, { experiment }));

    expect(markup).toContain("Short-term signals to watch");
    expect(markup).not.toContain("Synthetic fallback label that should not drive the display mapping");
    expect(markup).toContain("4 sources · 2 physiology studies · 1 trial · 1 review");
    expect(countOccurrences(markup, 'open=""')).toBe(1);
  });

  it("prioritizes the clearest red-light-glasses signals and moves the noisier ones into context pills", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("red-light-glasses-before-bed");

    expect(protocol).not.toBeNull();

    const experiment = composeExperimentDetail({
      protocol: protocol!,
      privateRun: null,
    });
    const markup = renderToStaticMarkup(createElement(ProtocolTab, { experiment }));

    expect(markup).toContain("What could change");
    expect(markup).toContain("Also worth watching");
    expect(countOccurrences(markup, "data-card=")).toBe(2);
    expect(markup).toContain('data-card="Sleep Efficiency"');
    expect(markup).toContain('data-card="Sleep Onset Latency"');
    expect(markup).not.toContain('data-card="Deep Sleep Minutes"');
    expect(markup).not.toContain('data-card="HRV / RMSSD"');
    expect(markup).not.toContain('data-card="Resting Heart Rate"');
    expect(markup).not.toContain("Primary marker");
    expect(markup).not.toContain("Sleep context");
    expect(markup).not.toContain("Exploratory signal");
    expect(markup).toContain("Deep Sleep Minutes");
    expect(markup).toContain("HRV / RMSSD");
    expect(markup).toContain("Resting Heart Rate");
    expect(markup).toContain("Sleep Onset Latency");
    expect(countOccurrences(markup, "Can be noisy")).toBe(3);
  });

});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
