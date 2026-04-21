import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StudyCard } from "@/src/components/experiments/experiment-detail/study-card";

describe("StudyCard", () => {
  it("uses the participant count as the leading badge and renders the year beside the title", () => {
    const markup = renderToStaticMarkup(
      createElement(StudyCard, {
        type: "RCT",
        title: "Aerobic high-intensity intervals improve VO2max more than moderate training",
        authors: "J Helgerud",
        journal: "Medicine and Science in Sports and Exercise",
        year: 2007,
        participants: 40,
        participantCountKind: "reported",
        includedStudyCount: 23,
        population: "Moderately trained men",
        duration: "8-week training intervention",
        designLabel: "Four-arm randomized training trial",
        finding: "Canonical small RCT supporting the Norwegian 4x4 dose.",
        last: true,
      }),
    );

    expect(markup).toContain(">2007<");
    expect(markup).toContain("n=40");
    expect(markup).toContain("23 studies");
    expect(markup).toContain(
      "J Helgerud · Medicine and Science in Sports and Exercise · Moderately trained men · 8-week training intervention",
    );
    expect(countOccurrences(markup, "2007")).toBe(1);
    expect(markup.indexOf("n=40")).toBeLessThan(markup.indexOf("2007"));
    expect(markup.indexOf("23 studies")).toBeGreaterThan(markup.indexOf("n=40"));
    expect(markup).not.toContain("Medicine and Science in Sports and Exercise · 2007");
    expect(markup).not.toContain("23 studies · n=40");
  });
});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
