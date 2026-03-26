import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildOverviewCompass,
  filterActiveExperiments,
} from "../src/lib/overview-compass";
import type { ReadyOverview } from "../src/lib/overview";

function buildReadyOverview(
  overrides: Partial<ReadyOverview> = {},
): ReadyOverview {
  return {
    currentProfile: null,
    experiments: [],
    generatedAt: "2026-03-12T15:00:00Z",
    metrics: [],
    recentJournals: [],
    sampleSummaries: [],
    search: null,
    status: "ready",
    timeline: [],
    weeklyStats: [],
    ...overrides,
  };
}

test("buildOverviewCompass does not reuse the same modest shift as both changed and steady", () => {
  const overview = buildReadyOverview({
    weeklyStats: [
      {
        currentWeekAvg: 7.5,
        deltaPercent: 4,
        previousWeekAvg: 7.2,
        stream: "sleep",
        unit: "hrs",
      },
    ],
  });

  const rows = buildOverviewCompass(overview);

  assert.match(rows[0]?.text ?? "", /Sleep averaged 7\.5 hrs this week, up 4\.0% versus last week/u);
  assert.equal(
    rows[1]?.text,
    "Let another week fill in before looking for stable baselines.",
  );
});

test("buildOverviewCompass preserves acronym casing in goal titles", () => {
  const overview = buildReadyOverview({
    currentProfile: {
      id: "profile_01",
      recordedAt: "2026-03-12T14:00:00Z",
      summary: null,
      title: "Current Profile",
      topGoals: [
        {
          id: "goal_ldl_01",
          title: "Lower LDL",
        },
      ],
    },
  });

  const rows = buildOverviewCompass(overview);

  assert.equal(
    rows.find((row) => row.label === "Worth trying")?.text,
    "Keep Lower LDL as the main anchor instead of browsing for extra protocols.",
  );
});

test("filterActiveExperiments keeps only active investigations", () => {
  const activeExperiments = filterActiveExperiments([
    {
      id: "exp_active_01",
      slug: "zone-2-reset",
      startedOn: "2026-03-08",
      status: "active",
      summary: null,
      tags: [],
      title: "Zone 2 Reset",
    },
    {
      id: "exp_done_01",
      slug: "sleep-reset",
      startedOn: "2026-03-01",
      status: "completed",
      summary: null,
      tags: [],
      title: "Sleep Reset",
    },
  ]);

  assert.deepEqual(activeExperiments.map((experiment) => experiment.title), [
    "Zone 2 Reset",
  ]);
});
