import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { composeExperimentDetail } from "@/src/lib/experiments/experiment-detail";
import { resolveHealthCommonsExperimentProtocol } from "@/src/lib/health-commons/experiment-detail";

vi.mock("@/src/components/experiments/experiment-detail/expected-signal-card", () => ({
  ExpectedSignalCard({ label }: { label: string }) {
    return createElement("div", { "data-card": label }, label);
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
    expect(markup).toContain('data-card="Resting Heart Rate"');
    expect(markup).not.toContain('data-card="Deep Sleep Minutes"');
    expect(markup).not.toContain('data-card="HRV / RMSSD"');
    expect(markup).not.toContain("Primary marker");
    expect(markup).not.toContain("Sleep context");
    expect(markup).not.toContain("Exploratory signal");
    expect(markup).toContain("Deep Sleep Minutes");
    expect(markup).toContain("HRV / RMSSD");
    expect(markup).toContain("Sleep Onset Latency");
    expect(markup).toContain("Can be noisy");
    expect(markup).toContain("May fall asleep sooner");
  });

});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
