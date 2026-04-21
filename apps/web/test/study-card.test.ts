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
    expect(markup).toContain('class="max-w-[34ch] line-clamp-1 pt-1 text-[11px]/4 text-muted-foreground/85"');
    expect(markup).toContain('data-slot="collapsible"');
    expect(markup).toContain('data-slot="collapsible-trigger"');
    expect(markup).toContain('aria-expanded="false"');
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

  it("dedupes repeated metadata labels such as a single-person author's name matching the population", () => {
    const markup = renderToStaticMarkup(
      createElement(StudyCard, {
        type: "N1",
        title: "31 brutal minutes to saunamaxx",
        authors: " Bryan Johnson ",
        journal: "Substack Post",
        participants: 1,
        population: "bryan johnson",
        duration: "14-day intervention window",
        finding: "Single-person Substack report backing the protocol update.",
        last: true,
      }),
    );

    expect(markup).toContain(
      "Bryan Johnson · Substack Post · 14-day intervention window",
    );
    expect(markup).not.toContain(
      "Bryan Johnson · Substack Post · Bryan Johnson",
    );
    expect(countOccurrences(markup, "Bryan Johnson")).toBe(1);
  });

  it("renders no summary line when a study has no summary", () => {
    const markup = renderToStaticMarkup(
      createElement(StudyCard, {
        type: "OBS",
        title: "Prospective cohort placeholder",
        authors: "A Cohort Team",
        journal: "Example Journal",
        year: 2024,
        participants: 1688,
        population: "Adults",
        duration: "Long-term follow-up",
        last: true,
      }),
    );

    expect(markup).not.toContain("line-clamp-1");
    expect(markup).not.toContain('data-slot="collapsible-content"');
    expect(markup).toContain(
      "A Cohort Team · Example Journal · Adults · Long-term follow-up",
    );
  });
});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
