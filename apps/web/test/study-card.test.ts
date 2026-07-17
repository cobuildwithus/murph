import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { resolveHealthCommonsExperimentProtocol } from "@/src/lib/health-commons/experiment-detail";
import { StudyCard } from "@/src/components/experiments/experiment-detail/study-card";

describe("StudyCard", () => {
  it("keeps the study type visible while showing participant counts, study facts, and the year beside the title", () => {
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
        url: "https://example.com/study",
        finding: "Canonical small RCT supporting the Norwegian 4x4 dose.",
        last: true,
      }),
    );

    expect(markup).toContain(">2007<");
    expect(markup).toContain(">Randomized<");
    expect(markup).toContain("n=40");
    expect(markup).toContain("23 studies");
    expect(markup).toContain('data-slot="collapsible"');
    expect(markup).toContain('data-slot="study-card-trigger"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('class="mt-1 flex flex-col gap-0.5 text-[11px]/4 text-muted-foreground/70"');
    expect(markup).toContain(">J Helgerud<");
    expect(markup).toContain(">Medicine and Science in Sports and Exercise<");
    expect(markup).toContain('href="https://example.com/study"');
    expect(markup).toContain(">Source ↗<");
    expect(markup).toContain(">People<");
    expect(markup).toContain(">Timeframe<");
    expect(markup).toContain("Four-arm randomized training trial");
    expect(markup).not.toContain(">Design<");
    expect(markup).toContain("Moderately trained men");
    expect(markup).toContain("8-week training intervention");
    expect(countOccurrences(markup, "2007")).toBe(2);
    expect(markup.indexOf("n=40")).toBeLessThan(markup.indexOf("2007"));
    expect(markup.indexOf("23 studies")).toBeGreaterThan(markup.indexOf("n=40"));
    expect(markup.indexOf("J Helgerud")).toBeLessThan(markup.indexOf("Source ↗"));
    expect(markup.indexOf("Source ↗")).toBeGreaterThan(markup.indexOf("J Helgerud"));
    expect(markup).not.toContain("line-clamp-1");
    expect(markup).not.toContain("Canonical small RCT supporting the Norwegian 4x4 dose.");
  });

  it("uses n≈ for approximate participant counts", () => {
    const markup = renderToStaticMarkup(
      createElement(StudyCard, {
        type: "MA",
        title: "Meta-analysis placeholder",
        authors: "A Researcher",
        journal: "Example Journal",
        participants: 2138,
        participantCountKind: "approximate",
        finding: "Approximate participant totals should render an approximate badge.",
        last: true,
      }),
    );

    expect(markup).toContain("n≈2,138");
    expect(markup).not.toContain("n=2,138");
    expect(markup).toContain(">Meta-analysis<");
  });

  it("resolves the fallback study copy when a source has no Findings block", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("walking-after-every-meal");
    expect(protocol).toBeTruthy();

    const study = protocol?.studies.find(
      (entry) =>
        entry.title === "Two bouts of exercise before meals, but not after meals, lower fasting blood glucose",
    );

    expect(study).toEqual(expect.objectContaining({
      caveat: "Dose and timing evidence varies by population, meal, comparator, and endpoint; keep implementation claims practical and bounded.",
      finding:
        "It preserves a negative/contrary finding: after-meal exercise is not always superior when the endpoint is fasting glucose rather than immediate post-meal excursions.",
      findingKind: "why_it_matters",
      headline: "Two bouts of exercise before meals, but not after meals, lower fasting blood glucose",
      implication: "Use as timing-boundary context: after-meal activity may target postprandial excursions, not necessarily fasting glucose.",
    }));
  });

  it("renders evidence pills for grouped research metadata", () => {
    const markup = renderToStaticMarkup(
      createElement(StudyCard, {
        type: "RCT",
        title: "Grouped research placeholder",
        authors: "A Researcher",
        journal: "Example Journal",
        result: "positive",
        scope: "direct_protocol",
        stance: "supports",
        headline: "A grouped evidence headline",
        implication: "A protocol-specific implication.",
        caveat: "A protocol-specific caveat.",
        last: true,
      }),
    );

    expect(markup).toContain(">Positive signal<");
    expect(markup).toContain(">Exact protocol match<");
    expect(markup).toContain(">Supports<");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("A grouped evidence headline");
    expect(markup).not.toContain("A protocol-specific implication.");
    expect(markup).not.toContain("A protocol-specific caveat.");
  });

  it("keeps shared null-result labels neutral across experiment families", () => {
    const markup = renderToStaticMarkup(
      createElement(StudyCard, {
        type: "RCT",
        title: "Neutral grouped research placeholder",
        authors: "A Researcher",
        journal: "Example Journal",
        result: "no_clear_advantage",
        scope: "same_mechanism",
        stance: "does_not_confirm",
        last: true,
      }),
    );

    expect(markup).toContain(">No clear advantage<");
    expect(markup).toContain(">Similar, not exact<");
    expect(markup).toContain("Doesn&#x27;t confirm");
    expect(markup).not.toContain("No clear objective gain");
    expect(markup).not.toContain("Does not confirm benefit");
  });

  it("renders the author label and study facts without the removed metadata strip", () => {
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

    expect(markup).toContain("> Bryan Johnson <");
    expect(markup).toContain(">People<");
    expect(markup).toContain(">Timeframe<");
    expect(markup).toContain("n=1");
    expect(markup).toContain("bryan johnson");
    expect(markup).toContain("14-day intervention window");
    expect(markup).toContain(">Substack Post<");
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
    expect(markup).toContain(">A Cohort Team<");
    expect(markup).toContain(">People<");
    expect(markup).toContain(">Timeframe<");
    expect(markup).toContain("n=1,688");
    expect(markup).toContain(">Example Journal<");
    expect(markup).toContain("Adults");
    expect(markup).toContain("Long-term follow-up");
  });
});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
