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
    expect(markup).toContain("Canonical small RCT supporting the Norwegian 4x4 dose.");
    expect(markup).toContain('class="text-[13px]/5 text-foreground/85"');
    expect(markup).toContain('class="mt-0.5 text-[11px]/4 text-muted-foreground/70"');
    expect(markup).toContain(
      "J Helgerud · Medicine and Science in Sports and Exercise · Moderately trained men · 8-week training intervention",
    );
    expect(countOccurrences(markup, "2007")).toBe(1);
    expect(markup.indexOf("n=40")).toBeLessThan(markup.indexOf("2007"));
    expect(markup.indexOf("23 studies")).toBeGreaterThan(markup.indexOf("n=40"));
    expect(
      markup.indexOf("Canonical small RCT supporting the Norwegian 4x4 dose."),
    ).toBeLessThan(
      markup.indexOf(
        "J Helgerud · Medicine and Science in Sports and Exercise · Moderately trained men · 8-week training intervention",
      ),
    );
    expect(markup).not.toContain("Medicine and Science in Sports and Exercise · 2007");
    expect(markup).not.toContain("23 studies · n=40");
  });

  it("uses n= for approximate participant counts", () => {
    const markup = renderToStaticMarkup(
      createElement(StudyCard, {
        type: "MA",
        title: "Meta-analysis placeholder",
        authors: "A Researcher",
        journal: "Example Journal",
        participants: 2138,
        participantCountKind: "approximate",
        finding: "Approximate participant totals should still use the standard n= badge.",
        last: true,
      }),
    );

    expect(markup).toContain("n=2,138");
    expect(markup).not.toContain("n≈2,138");
  });
});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
