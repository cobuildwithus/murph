import assert from "node:assert/strict";
import { test } from "vitest";

import {
  bindJunctionWorkoutJobsToSourceLifecycles,
  hasJunctionWorkoutSourceLifecycleAuthority,
  readJunctionWorkoutSourceLifecycleEpoch,
} from "../src/junction-workout-lifecycle.ts";

test("Junction workout lifecycle binding stamps the attributed source epoch and dedupe identity", () => {
  const original = {
    dedupeKey: "webhook-workout",
    kind: "resource",
    payload: {
      objectId: "workout-1",
      resource: "workout_stream",
      sourceLifecycleEpoch: 99,
      sourceProviderSlug: "garmin",
    },
  };

  const [bound] = bindJunctionWorkoutJobsToSourceLifecycles([original], [{
    lifecycleEpoch: 4,
    sourceProviderSlug: "garmin",
    status: "connected",
  }]);

  assert.equal(bound?.payload?.sourceLifecycleEpoch, 4);
  assert.equal(bound?.payload?.sourceLifecycleEpochs, undefined);
  assert.notEqual(bound?.dedupeKey, original.dedupeKey);
  assert.equal(hasJunctionWorkoutSourceLifecycleAuthority(bound?.payload ?? {}), true);
  assert.equal(readJunctionWorkoutSourceLifecycleEpoch(bound?.payload ?? {}, "garmin"), 4);
});

test("Junction source-less workout lifecycle binding carries a bounded canonical epoch set", () => {
  const [bound] = bindJunctionWorkoutJobsToSourceLifecycles([{
    kind: "resource",
    payload: {
      objectId: "workout-2",
      resource: "workout_stream",
    },
  }], [
    {
      lifecycleEpoch: 2,
      sourceProviderSlug: "fitbit",
      status: "connected",
    },
    {
      lifecycleEpoch: 3,
      sourceProviderSlug: "garmin",
      status: "connected",
    },
    {
      lastErrorCode: "SOURCE_USER_DISCONNECTED",
      lifecycleEpoch: 8,
      sourceProviderSlug: "whoop",
      status: "connected",
    },
  ]);

  assert.equal(bound?.payload?.sourceLifecycleEpochs, "fitbit:2,garmin:3");
  assert.equal(readJunctionWorkoutSourceLifecycleEpoch(bound?.payload ?? {}, "fitbit"), 2);
  assert.equal(readJunctionWorkoutSourceLifecycleEpoch(bound?.payload ?? {}, "garmin"), 3);
  assert.equal(readJunctionWorkoutSourceLifecycleEpoch(bound?.payload ?? {}, "whoop"), null);
});

test("Junction workout lifecycle binding fails closed without admitted source proof", () => {
  const [bound] = bindJunctionWorkoutJobsToSourceLifecycles([{
    kind: "resource",
    payload: {
      objectId: "workout-3",
      resource: "workout_stream",
      sourceProviderSlug: "garmin",
    },
  }], [{
    lifecycleEpoch: 2,
    sourceProviderSlug: "garmin",
    status: "disconnected",
  }]);

  assert.equal(bound?.payload?.sourceLifecycleEpoch, undefined);
  assert.equal(hasJunctionWorkoutSourceLifecycleAuthority(bound?.payload ?? {}), false);
});
