import assert from "node:assert/strict";

import { test } from "vitest";

import { shapeHostedDeviceSyncJobHintPayload } from "../src/hosted-hints.ts";

test("hosted job hint payload shaping keeps only the provider-specific job-definition fields", () => {
  assert.deepEqual(
    shapeHostedDeviceSyncJobHintPayload("junction", {
      kind: "backfill",
      payload: {
        emptyBackfillAttempts: 2,
        windowEnd: "2026-04-07T01:00:00.000Z",
        windowStart: 123,
        ignored: "discarded",
      },
    }),
    {
      emptyBackfillAttempts: 2,
      windowEnd: "2026-04-07T01:00:00.000Z",
    },
  );

  assert.deepEqual(
    shapeHostedDeviceSyncJobHintPayload("oura", {
      kind: "delete",
      payload: {
        dataType: "sleep",
        objectId: "sleep_123",
        occurredAt: "2026-04-07T00:00:00.000Z",
        sourceEventType: "sleep.deleted",
        ignored: "discarded",
      },
    }),
    {
      dataType: "sleep",
      objectId: "sleep_123",
      occurredAt: "2026-04-07T00:00:00.000Z",
      sourceEventType: "sleep.deleted",
    },
  );

  assert.deepEqual(
    shapeHostedDeviceSyncJobHintPayload("whoop", {
      kind: "resource",
      payload: {
        eventType: "sleep.updated",
        occurredAt: "2026-04-07T00:00:00.000Z",
        resourceId: "sleep_456",
        resourceType: "sleep",
        unexpected: false,
      },
    }),
    {
      eventType: "sleep.updated",
      occurredAt: "2026-04-07T00:00:00.000Z",
      resourceId: "sleep_456",
      resourceType: "sleep",
    },
  );

  assert.deepEqual(
    shapeHostedDeviceSyncJobHintPayload("demo", {
      kind: "reconcile",
      payload: {
        windowStart: "2026-04-07T00:00:00.000Z",
      },
    }),
    {},
  );
});

test("hosted job hint payload shaping ignores unsupported kinds and empty nested webhook payloads", () => {
  assert.deepEqual(
    shapeHostedDeviceSyncJobHintPayload("junction", {
      kind: "delete",
      payload: {
        windowStart: "2026-04-07T00:00:00.000Z",
      },
    }),
    {},
  );

  assert.deepEqual(
    shapeHostedDeviceSyncJobHintPayload("oura", {
      kind: "resource",
      payload: {
        dataType: "sleep",
        includePersonalInfo: true,
        objectId: "sleep_123",
        occurredAt: "2026-04-07T00:00:00.000Z",
        windowEnd: "2026-04-07T01:00:00.000Z",
        windowStart: "2026-04-07T00:00:00.000Z",
      },
    }),
    {
      dataType: "sleep",
      includePersonalInfo: true,
      objectId: "sleep_123",
      occurredAt: "2026-04-07T00:00:00.000Z",
      windowEnd: "2026-04-07T01:00:00.000Z",
      windowStart: "2026-04-07T00:00:00.000Z",
    },
  );

  assert.deepEqual(
    shapeHostedDeviceSyncJobHintPayload("junction", {
      kind: "resource",
      payload: {
        eventType: "daily.data.heartrate.created",
        objectId: "",
        occurredAt: "2026-04-07T00:00:00.000Z",
        resource: "heartrate",
        resourceCategory: "timeseries",
        sourceProviderSlug: "",
        windowEnd: "2026-04-07T01:00:00.000Z",
        windowStart: "2026-04-07T00:00:00.000Z",
      },
    }),
    {
      eventType: "daily.data.heartrate.created",
      occurredAt: "2026-04-07T00:00:00.000Z",
      resource: "heartrate",
      resourceCategory: "timeseries",
      windowEnd: "2026-04-07T01:00:00.000Z",
      windowStart: "2026-04-07T00:00:00.000Z",
    },
  );

  assert.deepEqual(
    shapeHostedDeviceSyncJobHintPayload("oura", {
      kind: "delete",
      payload: {
        dataType: "sleep",
        webhookPayload: [],
      },
    }),
    {
      dataType: "sleep",
    },
  );

  assert.deepEqual(
    shapeHostedDeviceSyncJobHintPayload("whoop", {
      kind: "backfill",
      payload: {
        windowEnd: "2026-04-07T01:00:00.000Z",
        windowStart: "2026-04-07T00:00:00.000Z",
      },
    }),
    {
      windowEnd: "2026-04-07T01:00:00.000Z",
      windowStart: "2026-04-07T00:00:00.000Z",
    },
  );

  assert.deepEqual(
    shapeHostedDeviceSyncJobHintPayload("whoop", {
      kind: "noop",
      payload: {},
    }),
    {},
  );
});

test("hosted job hint payload shaping covers Strava job hints and deauthorization payloads", () => {
  assert.deepEqual(
    shapeHostedDeviceSyncJobHintPayload("strava", {
      kind: "reconcile",
      payload: {
        windowEnd: "2026-04-07T01:00:00.000Z",
        windowStart: "2026-04-07T00:00:00.000Z",
        ignored: true,
      },
    }),
    {
      windowEnd: "2026-04-07T01:00:00.000Z",
      windowStart: "2026-04-07T00:00:00.000Z",
    },
  );

  assert.deepEqual(
    shapeHostedDeviceSyncJobHintPayload("strava", {
      kind: "resource",
      payload: {
        eventType: "activity.update",
        occurredAt: "2026-04-07T00:00:00.000Z",
        resourceId: "activity-123",
        resourceType: "activity",
        unexpected: "discarded",
      },
    }),
    {
      eventType: "activity.update",
      occurredAt: "2026-04-07T00:00:00.000Z",
      resourceId: "activity-123",
      resourceType: "activity",
    },
  );

  assert.deepEqual(
    shapeHostedDeviceSyncJobHintPayload("strava", {
      kind: "deauthorize",
      payload: {
        eventType: "athlete.deauthorized",
        occurredAt: "2026-04-07T00:00:00.000Z",
        resourceId: "athlete-123",
        resourceType: "athlete",
      },
    }),
    {
      eventType: "athlete.deauthorized",
      occurredAt: "2026-04-07T00:00:00.000Z",
      resourceId: "athlete-123",
      resourceType: "athlete",
    },
  );

  assert.deepEqual(
    shapeHostedDeviceSyncJobHintPayload("strava", {
      kind: "noop",
      payload: {
        resourceId: "ignored",
      },
    }),
    {},
  );
});
