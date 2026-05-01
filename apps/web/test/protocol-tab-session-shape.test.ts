import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ProtocolTab,
  type ProtocolTabExperiment,
} from "@/src/components/experiments/experiment-detail/protocol-tab";

function buildExperiment(): ProtocolTabExperiment {
  return {
    baselineDays: 7,
    durationDays: 21,
    expectedSignals: [],
    experts: [],
    id: "cold-plunge",
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
    sessionShape: {
      label: "One session",
      segments: [
        {
          durationMinutes: 1,
          kind: "transition",
          label: "entry",
        },
        {
          durationMinutes: 3,
          kind: "stimulus",
          label: "cold exposure",
        },
        {
          durationMinutes: 1,
          kind: "recovery",
          label: "gentle rewarm",
        },
      ],
      ticks: [
        { label: "0", offsetMinutes: 0 },
        { label: "entry", offsetMinutes: 1 },
        { label: "1-3 min in water", offsetMinutes: 4 },
        { label: "rewarm", offsetMinutes: 5 },
      ],
    },
    whyItWorks: "",
  };
}

describe("ProtocolTab session shape", () => {
  it("positions structured tick labels by their real offsets", () => {
    const markup = renderToStaticMarkup(createElement(ProtocolTab, {
      experiment: buildExperiment(),
    }));

    expect(markup).toContain("entry");
    expect(markup).toContain("1-3 min in water");
    expect(markup).toContain("left:20%");
    expect(markup).toContain("left:80%");
  });
});
