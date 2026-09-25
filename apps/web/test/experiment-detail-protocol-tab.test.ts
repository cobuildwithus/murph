import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { composeExperimentDetail } from "@/src/lib/experiments/experiment-detail";
import { resolveExperimentProjectionFixture } from "./health-commons-projection-fixtures";
import { resolveHealthCommonsExperimentProtocolTab } from "@/src/lib/health-commons/experiment-projections";
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
import { ResearchTab } from "@/src/components/experiments/experiment-detail/research-tab";

describe("ProtocolTab", () => {
  it("renders the protocol layout without generic step labels or duplicated summary copy", () => {
    const protocol = resolveExperimentProjectionFixture("bryan-johnson-blueprint");

    expect(protocol).not.toBeNull();

    const experiment = composeExperimentDetail({
      protocol: protocol!,
      privateRun: null,
    });
    const markup = renderToStaticMarkup(createElement(ProtocolTab, { experiment }));
    const summaryParagraph = experiment.whyItWorks
      .split("\n\n")
      .find((block) => !block.trimStart().startsWith("#"))
      ?.trim();

    expect(markup).toContain("Run the protocol");
    expect(markup).toContain("Why it works");
    expect(markup).toContain("Schedule &amp; dose");
    expect(markup).toContain("14-day baseline then 14-day protocol");
    expect(markup).not.toContain("days to analysis");
    expect(markup).not.toContain("Total run");
    expect(markup).not.toContain("Protocol window");
    expect(markup).not.toContain("Before change");
    expect(markup).not.toContain("Step 1");
    expect(markup).not.toContain("STEP 1");

    expect(summaryParagraph).toBeTruthy();
    expect(countOccurrences(markup, summaryParagraph!)).toBe(1);
  });

  it("uses the page-authored Finnish focus signals and moves context signals into pills", () => {
    const protocol = resolveExperimentProjectionFixture("finnish-sauna");
    const protocolTab = resolveHealthCommonsExperimentProtocolTab("finnish-sauna");

    expect(protocol).not.toBeNull();
    expect(protocolTab).not.toBeNull();

    const experiment = composeExperimentDetail({
      protocol: protocol!,
      privateRun: null,
    });
    const markup = renderToStaticMarkup(createElement(ProtocolTab, { experiment }));
    const researchMarkup = renderToStaticMarkup(createElement(ResearchTab, { experiment }));

    expect(markup).toContain("What could change");
    expect(markup).toContain("Also worth watching");
    expect(protocolTab!.expectedSignals.map((signal) => signal.expected)).toContain(
      "Small drop possible",
    );
    expect(protocolTab!.expectedSignals.map((signal) => signal.expected)).toContain(
      "Small change possible",
    );
    expect(protocolTab!.expectedSignals.map((signal) => signal.expected)).not.toContain(
      "mixed_or_contextual",
    );
    expect(protocolTab!.expectedSignals[0]?.label).toBe("Morning Blood Pressure");
    expect(protocolTab!.expectedSignals[1]?.label).toBe("Resting Heart Rate");
    expect(countOccurrences(markup, "data-card=")).toBe(2);
    expect(markup).toContain('data-card="Morning Blood Pressure"');
    expect(markup).toContain('data-card="Resting Heart Rate"');
    expect(markup.indexOf('data-card="Morning Blood Pressure"')).toBeLessThan(
      markup.indexOf('data-card="Resting Heart Rate"'),
    );
    expect(markup).toContain("Up to 5 mmHg lower");
    expect(markup).toContain("−3 to +1 bpm");
    expect(markup).toContain("Morning Blood Pressure projected up to 5 mmHg lower over 2-6 weeks");
    expect(markup).toContain("Resting Heart Rate projected −3 to +1 bpm over 2-6 weeks");
    expect(markup).not.toContain('data-card="HRV / RMSSD"');
    expect(markup).toContain("HRV / RMSSD");
    expect(markup).toContain("2-6 weeks");
    expect(markup).toContain(
      '<span class="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">2-6 weeks</span>',
    );
    expect(markup).not.toContain('data-card="Sleep Efficiency"');
    expect(markup).not.toContain('data-card="Deep Sleep Minutes"');
    expect(markup).toContain("Morning Blood Pressure");
    expect(markup).toContain("HRV / RMSSD");
    expect(markup).toContain("Sleep Efficiency");
    expect(markup).toContain("Deep Sleep");
    expect(markup).toContain("sauna 80–100 °C");
    expect(markup).toContain("23 min");
    expect(researchMarkup).toContain("Bottom line");
    expect(researchMarkup).toContain("Mixed");
    expect(researchMarkup).not.toContain("Evidence backbone and claim calibration");
    expect(markup).not.toContain("Read these top to bottom");
  });

  it("keeps the Bryan Johnson sauna hierarchy focused on tolerability and pressure signals", () => {
    const protocol = resolveExperimentProjectionFixture("bryan-johnson-blueprint");

    expect(protocol).not.toBeNull();

    const experiment = composeExperimentDetail({
      protocol: protocol!,
      privateRun: null,
    });
    const markup = renderToStaticMarkup(createElement(ProtocolTab, { experiment }));

    expect(markup).toContain("What could change");
    expect(markup).toContain("Also worth watching");
    expect(countOccurrences(markup, "data-card=")).toBe(3);
    expect(markup).toContain('data-card="HRV / RMSSD"');
    expect(markup).toContain('data-card="Resting Heart Rate"');
    expect(markup).toContain('data-card="Morning Blood Pressure"');
    expect(markup).toContain("VO₂ Max");
    expect(markup).toContain("sauna 93 °C");
    expect(markup).toContain("after workout");
  });

  it("prioritizes aerobic adaptation signals for Norwegian 4x4 and leaves slower proxies in context", () => {
    const protocol = resolveExperimentProjectionFixture("norwegian-4x4");

    expect(protocol).not.toBeNull();

    const experiment = composeExperimentDetail({
      protocol: protocol!,
      privateRun: null,
    });
    const markup = renderToStaticMarkup(createElement(ProtocolTab, { experiment }));
    const researchMarkup = renderToStaticMarkup(createElement(ResearchTab, { experiment }));

    expect(markup).toContain("What could change");
    expect(markup).toContain("Also worth watching");
    expect(countOccurrences(markup, "data-card=")).toBe(3);
    expect(markup).toContain('data-card="VO₂ Max"');
    expect(markup).toContain("+3–10%");
    expect(markup).not.toContain("−5–10%");
    expect(markup).toContain('data-card="Resting Heart Rate"');
    expect(markup).toContain('data-card="Morning Blood Pressure"');
    expect(markup).toContain("4-minute rep is dose");
    expect(markup).toContain("4 × hard / easy");
    expect(markup).toContain("35 min");
    expect(markup).toContain("During each rep");
    expect(markup).toContain("High blood flow · shear stress · lactate turnover");
    expect(markup).not.toContain('data-card="HRV / RMSSD"');
    expect(markup).not.toContain('data-card="Sleep Efficiency"');
    expect(markup).toContain("Morning Blood Pressure");
    expect(markup).toContain("HRV / RMSSD");
    expect(markup).toContain("Sleep Efficiency");
    expect(researchMarkup).toContain("Bottom line");
    expect(researchMarkup).toContain("best-supported claim");
    expect(researchMarkup).toContain("Moderate confidence");
    expect(researchMarkup).toContain("Exact or close 4x4 trials");
    expect(researchMarkup).toContain("Dose, target zone, and implementation");
    expect(researchMarkup).toContain("Broader HIIT and VO2max context");
    expect(researchMarkup).toContain("Clinical lineage and mixed superiority");
    expect(researchMarkup).toContain("Safety boundaries");
    expect(researchMarkup).toContain("Nearby protocols and recovery context");
    expect(researchMarkup).toContain("Read these top to bottom");
  });

  it("renders grouped research inside native details cards with source-mix summaries", () => {
    const protocol = resolveExperimentProjectionFixture("norwegian-4x4");

    expect(protocol).not.toBeNull();

    const experiment = composeExperimentDetail({
      protocol: protocol!,
      privateRun: null,
    });
    const markup = renderToStaticMarkup(createElement(ResearchTab, { experiment }));

    expect(countOccurrences(markup, "group overflow-hidden rounded-xl")).toBe(9);
    expect(countOccurrences(markup, 'open=""')).toBe(2);
    expect(markup).toContain("2 sources · 2 trials");
    expect(markup).toContain("3 sources · 1 physiology study · 1 trial · 1 guidance source");
    expect(markup).toContain("11 sources · 9 trials · 2 reviews");
    expect(markup).toContain("6 sources · 3 guidance sources · 2 reviews · 1 observational study");
  });

  it("shortens long Finnish research-group labels at display time only", () => {
    const protocol = resolveExperimentProjectionFixture("finnish-sauna");

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
    const markup = renderToStaticMarkup(createElement(ResearchTab, { experiment }));

    expect(markup).toContain("Short-term signals to watch");
    expect(markup).not.toContain("Synthetic fallback label that should not drive the display mapping");
    expect(markup).toContain("4 sources · 2 physiology studies · 1 trial · 1 review");
    expect(countOccurrences(markup, 'open=""')).toBe(1);
  });

  it("uses the page-authored tomorrow-list focus signal and moves the secondary signal into context pills", () => {
    const protocol = resolveExperimentProjectionFixture("five-minute-tomorrow-list");

    expect(protocol).not.toBeNull();

    const experiment = composeExperimentDetail({
      protocol: protocol!,
      privateRun: null,
    });
    const markup = renderToStaticMarkup(createElement(ProtocolTab, { experiment }));

    expect(markup).toContain("What could change");
    expect(markup).toContain("Also worth watching");
    expect(countOccurrences(markup, "data-card=")).toBe(2);
    expect(markup).toContain('data-card="Pre-Sleep Arousal"');
    expect(markup).not.toContain('data-card="Sleep Onset Latency"');
    expect(markup).not.toContain('data-card="Subjective Sleep Quality"');
    expect(markup).toContain('data-card="Daytime Sleepiness"');
    expect(markup).not.toContain("Primary marker");
    expect(markup).not.toContain("Sleep context");
    expect(markup).not.toContain("Exploratory signal");
    expect(markup).toContain("Sleep Onset Latency");
    expect(markup).toContain("write specific future tasks and first actions");
    expect(markup).toContain("stop at 5 min");
  });

  it("keeps expected signals outcome-only while rendering measurement paths separately", () => {
    const protocol = resolveExperimentProjectionFixture("finnish-sauna");
    if (!protocol) throw new Error("Expected the Finnish sauna projection.");
    protocol.measurementPaths = createMeasurementPaths();

    expect(protocol).not.toBeNull();
    expect(protocol?.expectedSignals.map((signal) => signal.label)).not.toEqual(
      expect.arrayContaining([
        "Home image analysis",
        "Clinic imaging",
      ]),
    );
    expect(
      protocol?.measurementPaths.map((path) => ({
        isDefault: path.isDefault,
        label: path.label,
        required: path.required,
      })),
    ).toEqual([
      {
        isDefault: true,
        label: "Home skin scoring",
        required: true,
      },
      {
        isDefault: false,
        label: "Home image analysis",
        required: false,
      },
      {
        isDefault: false,
        label: "Clinic imaging upgrade",
        required: false,
      },
    ]);

    const experiment = composeExperimentDetail({
      protocol: protocol!,
      privateRun: null,
    });
    const markup = renderToStaticMarkup(createElement(ProtocolTab, { experiment }));

    expect(markup).toContain("Measurement paths");
    expect(markup).toContain("How this can be measured");
    expect(markup).toContain("Photo privacy");
    expect(markup).toContain("Keep originals local and private");
    expect(markup.indexOf("Home skin scoring")).toBeLessThan(
      markup.indexOf("Home image analysis"),
    );
    expect(markup).toContain("/measurement-methods/home-image-analysis");
    expect(markup).toContain("/measurement-methods/clinic-imaging");
    expect(countOccurrences(markup, ">Optional</span>")).toBe(2);
    expect(countOccurrences(markup, "data-card=")).toBe(2);
  });

});

function createMeasurementPaths(): NonNullable<ReturnType<typeof resolveExperimentProjectionFixture>>["measurementPaths"] {
  return ([
    { label: "Home skin scoring", shortName: "Home skin score", routeId: "home-skin-score", tier: "default_home", required: true },
    { label: "Home image analysis", shortName: "Home image analysis", routeId: "home-image-analysis", tier: "optional_home", required: false },
    { label: "Clinic imaging upgrade", shortName: "Clinic imaging", routeId: "clinic-imaging", tier: "clinic", required: false },
  ] as const).map(({ label, shortName, routeId, tier, required }) => ({
    label, pathId: routeId, tier, required, isDefault: required,
    methodKeys: [`measurement_method:${routeId}`],
    notes: [], outcomeLabels: ["Skin texture"], safetyOutcomeLabels: [],
    methods: [{
      key: `measurement_method:${routeId}`, routeId, shortName, title: shortName,
      href: `/measurement-methods/${routeId}`, tier, modalities: [],
      privacy: { containsIdentifiableImages: true, localOnlyRecommended: true, notes: [] },
    }],
  }));
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
