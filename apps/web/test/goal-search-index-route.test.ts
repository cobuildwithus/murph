import assert from "node:assert/strict";

import { test } from "vitest";

import { GET } from "../app/api/goals/search-index/route";
import { isGoalSearchIndexPayload } from "../src/lib/goals/goal-search-index-contract";
import { listHealthCommonsGoalEntries } from "../src/lib/health-commons/goal-projections";

test("the goal search index route serves every public guide as a cacheable static payload", async () => {
  const response = GET();
  const payload: unknown = await response.json();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control") ?? "", /^public, /u);
  assert.ok(isGoalSearchIndexPayload(payload));
  assert.equal(payload.goals.length, listHealthCommonsGoalEntries().length);
  const sleepBetter = payload.goals.find((goal) => goal.routeId === "sleep-better");
  assert.ok(sleepBetter);
  assert.equal(sleepBetter.goalPhrase, "sleep better");
  assert.equal(sleepBetter.illustrationSrc, "/design-assets/goals/sleep-better.svg");
});

test("isGoalSearchIndexPayload rejects malformed payloads", () => {
  assert.equal(isGoalSearchIndexPayload(null), false);
  assert.equal(isGoalSearchIndexPayload({ goals: "nope" }), false);
  assert.equal(isGoalSearchIndexPayload({ goals: [{ routeId: 1 }] }), false);
  assert.equal(isGoalSearchIndexPayload({ goals: [] }), true);
});
