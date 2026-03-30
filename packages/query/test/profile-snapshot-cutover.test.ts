import assert from "node:assert/strict";
import { test } from "vitest";

import {
  extractProfileSummary,
  extractProfileTopGoalIds,
  projectProfileSnapshotEntity,
} from "../src/health/projectors/profile.ts";
import { profileSnapshotRecordFromEntity } from "../src/health/projections.ts";

test("profile snapshot query projections keep nested typed summary and goal fields", () => {
  const entity = projectProfileSnapshotEntity(
    {
      id: "psnap_01",
      recordedAt: "2026-03-12T13:55:00Z",
      source: "manual",
      profile: {
        narrative: {
          summary: "Sleep steadier and the evening routine is holding.",
        },
        goals: {
          topGoalIds: ["goal_sleep_01"],
        },
      },
    },
    "ledger/profile-snapshots/2026/2026-03.jsonl",
  );

  assert.ok(entity);
  assert.equal(entity.title, "Sleep steadier and the evening routine is holding.");
  assert.equal(entity.body, "Sleep steadier and the evening routine is holding.");
  assert.deepEqual(extractProfileTopGoalIds(entity.attributes.profile), ["goal_sleep_01"]);
  assert.equal(extractProfileSummary(entity.attributes.profile), "Sleep steadier and the evening routine is holding.");
  assert.equal(
    profileSnapshotRecordFromEntity(entity)?.summary,
    "Sleep steadier and the evening routine is holding.",
  );
});

test("profile snapshot query projections ignore legacy flat profile fields after the cutover", () => {
  const entity = projectProfileSnapshotEntity(
    {
      id: "psnap_legacy_01",
      recordedAt: "2026-03-12T13:55:00Z",
      source: "manual",
      profile: {
        summary: "Legacy flat summary",
        topGoalIds: ["goal_sleep_legacy"],
      },
    },
    "ledger/profile-snapshots/2026/2026-03.jsonl",
  );

  assert.ok(entity);
  assert.equal(entity.title, "psnap_legacy_01");
  assert.equal(entity.body, null);
  assert.deepEqual(extractProfileTopGoalIds(entity.attributes.profile), []);
  assert.equal(extractProfileSummary(entity.attributes.profile), null);
  assert.equal(profileSnapshotRecordFromEntity(entity)?.summary, null);
});
