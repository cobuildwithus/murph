import assert from "node:assert/strict";

import { test } from "vitest";

import { shapeHostedDeviceSyncJobHintPayload } from "../src/hosted-hints.ts";

test("hosted job hint payload shaping keeps only the provider-specific allowlists", () => {
  assert.deepEqual(
    shapeHostedDeviceSyncJobHintPayload("garmin", {
      kind: "backfill",
      payload: {
        includeProfile: true,
        windowEnd: "2026-04-07T01:00:00.000Z",
        windowStart: 123,
        ignored: "discarded",
      },
    }),
    {
      includeProfile: true,
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
        webhookPayload: {
          id: "evt_123",
          object_id: "sleep_123",
          traceId: "trace_123",
          user_id: "user_123",
          nested: {
            secret: "discarded",
          },
          attempts: 2,
        },
      },
    }),
    {
      dataType: "sleep",
      objectId: "sleep_123",
      occurredAt: "2026-04-07T00:00:00.000Z",
      sourceEventType: "sleep.deleted",
      webhookPayload: {
        id: "evt_123",
        object_id: "sleep_123",
        traceId: "trace_123",
        user_id: "user_123",
      },
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
    shapeHostedDeviceSyncJobHintPayload("garmin", {
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
