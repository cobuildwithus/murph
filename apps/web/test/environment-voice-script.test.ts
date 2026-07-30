import { describe, expect, it } from "vitest";

import type { CategoryNote } from "../app/(dashboard)/environment/category-notes";
import { buildEnvironmentVoiceScript } from "../app/(dashboard)/environment/environment-voice-script";

describe("environment voice script", () => {
  it("uses the complete five-topic walkthrough when coverage is zero", () => {
    const script = buildEnvironmentVoiceScript([], 0);

    expect(script.flow).toBe("walkthrough");
    expect(script.topics).toHaveLength(5);
    expect(script.topics.map((topic) => topic.id)).toEqual([
      "sleep",
      "air",
      "light",
      "recovery",
      "workspace",
    ]);
  });

  it.each([10, 30, 70, 94])(
    "asks only about unknown, non-skipped details at %i%% coverage",
    (coverage) => {
      const script = buildEnvironmentVoiceScript(
        [
          categoryNote({
            id: "sleep",
            skipped: ["Phone by bed"],
            title: "Sleep",
            unknown: ["Night temperature", "Darkness"],
          }),
          categoryNote({
            id: "air",
            title: "Air & water",
            unknown: [],
          }),
          categoryNote({
            id: "workspace",
            title: "Workspace",
            unknown: ["Breaks"],
          }),
        ],
        coverage,
      );

      expect(script.flow).toBe("fill-gaps");
      expect(script.topics.map((topic) => topic.id)).toEqual([
        "sleep",
        "workspace",
      ]);
      expect(script.topics[0].focus).toEqual([
        "Night temperature",
        "Darkness",
      ]);
      expect(script.topics[0].focus).not.toContain("Phone by bed");
      expect(script.topics[1].focus).toEqual(["Breaks"]);
    },
  );

  it.each([95, 100])(
    "switches to one open update prompt at %i%% coverage",
    (coverage) => {
      const script = buildEnvironmentVoiceScript(
        [
          categoryNote({
            id: "sleep",
            title: "Sleep",
            unknown: coverage === 95 ? ["Mattress age"] : [],
          }),
        ],
        coverage,
      );

      expect(script.flow).toBe("update");
      expect(script.dialogTitle).toBe("Update your environment");
      expect(script.topics).toHaveLength(1);
      expect(script.topics[0].id).toBe("update");
    },
  );
});

function categoryNote({
  id,
  skipped = [],
  title,
  unknown,
}: {
  id: string;
  skipped?: string[];
  title: string;
  unknown: string[];
}): CategoryNote {
  return {
    grade: {
      eligible: 0,
      graded: 0,
      letter: null,
      met: 0,
      pct: null,
      redFlags: 0,
    },
    id,
    known: 0,
    rows: [],
    skippedFacts: skipped.map((label, index) => ({
      indicatorId: `skipped-${index}`,
      label,
    })),
    title,
    total: unknown.length,
    unknownFacts: unknown.map((label, index) => ({
      indicatorId: `unknown-${index}`,
      label,
    })),
  };
}
