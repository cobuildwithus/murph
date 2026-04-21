import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StudyCard } from "@/src/components/experiments/experiment-detail/study-card";

describe("StudyCard", () => {
  it("uses the study year as the badge and renders the sample chip beside the title", () => {
    const markup = renderToStaticMarkup(
      createElement(StudyCard, {
        type: "SRC",
        title: "Aerobic high-intensity intervals improve VO2max more than moderate training",
        authors: "J Helgerud",
        journal: "Medicine and Science in Sports and Exercise",
        year: 2007,
        participants: 40,
        finding: "Canonical small RCT supporting the Norwegian 4x4 dose.",
        last: true,
      }),
    );

    expect(markup).toContain(">2007<");
    expect(markup).toContain("n=40");
    expect(markup).toContain("J Helgerud · Medicine and Science in Sports and Exercise");
    expect(markup).not.toContain("Medicine and Science in Sports and Exercise · 2007");
    expect(countOccurrences(markup, "2007")).toBe(1);
  });
});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
