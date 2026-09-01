import { describe, expect, it } from "vitest";

import {
  isGoalGuideSafetySection,
  isGoalGuideSourcesSection,
  splitGoalGuideBody,
} from "@/src/lib/goals/goal-guide-sections";

const BODY = `Intro paragraph one.

Intro paragraph two.

## What to do

Do the thing.

### A sub-heading stays inside its section

More detail.

## A quick note

Seek care for red flags.

## What to do

Repeated heading.

## Sources

- [Source](https://example.com/source)`;

describe("splitGoalGuideBody", () => {
  it("separates the intro from level-two sections and keeps sub-headings inline", () => {
    const outline = splitGoalGuideBody(BODY);

    expect(outline.intro).toBe("Intro paragraph one.\n\nIntro paragraph two.");
    expect(outline.sections.map((section) => section.title)).toEqual([
      "What to do",
      "A quick note",
      "What to do",
      "Sources",
    ]);
    expect(outline.sections[0]?.body).toBe(
      "Do the thing.\n\n### A sub-heading stays inside its section\n\nMore detail.",
    );
    expect(outline.sections[3]?.body).toBe("- [Source](https://example.com/source)");
  });

  it("assigns stable, unique anchor ids", () => {
    const outline = splitGoalGuideBody(BODY);

    expect(outline.sections.map((section) => section.id)).toEqual([
      "what-to-do",
      "a-quick-note",
      "what-to-do-2",
      "sources",
    ]);
  });

  it("recognizes the safety note and sources sections by title", () => {
    const outline = splitGoalGuideBody(BODY);

    expect(outline.sections.filter(isGoalGuideSafetySection).map((s) => s.id))
      .toEqual(["a-quick-note"]);
    expect(outline.sections.filter(isGoalGuideSourcesSection).map((s) => s.id))
      .toEqual(["sources"]);
  });

  it("handles a body without headings", () => {
    expect(splitGoalGuideBody("Just a paragraph.")).toEqual({
      intro: "Just a paragraph.",
      sections: [],
    });
  });
});
