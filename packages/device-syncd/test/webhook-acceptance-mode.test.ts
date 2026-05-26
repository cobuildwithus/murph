import assert from "node:assert/strict";
import { test } from "vitest";

import { classifyDeviceSyncWebhookAcceptanceMode } from "../src/types.ts";

test("webhook acceptance mode classifies only bounded broad dirty jobs as level hints", () => {
  assert.equal(classifyDeviceSyncWebhookAcceptanceMode([]), "durable_webhook_work");
  assert.equal(
    classifyDeviceSyncWebhookAcceptanceMode([
      {
        kind: "reconcile",
        payload: {},
      },
    ]),
    "durable_webhook_work",
  );
  assert.equal(
    classifyDeviceSyncWebhookAcceptanceMode([
      {
        kind: "reconcile",
        payload: {
          windowStart: "2026-05-25T00:00:00.000Z",
        },
      },
    ]),
    "durable_webhook_work",
  );
  assert.equal(
    classifyDeviceSyncWebhookAcceptanceMode([
      {
        kind: "reconcile",
        payload: {
          windowStart: "2026-05-25T00:00:00.000Z",
          windowEnd: "2026-05-26T00:00:00.000Z",
        },
      },
      {
        kind: "backfill",
        payload: {
          kind: "backfill",
          includePersonalInfo: true,
          windowStart: "2026-04-26T00:00:00.000Z",
          windowEnd: "2026-05-26T00:00:00.000Z",
        },
      },
    ]),
    "level_dirty_hint",
  );
});

test("webhook acceptance mode treats exact webhook work as durable", () => {
  assert.equal(
    classifyDeviceSyncWebhookAcceptanceMode([
      {
        kind: "resource",
        payload: {
          resourceId: "resource-1",
          windowStart: "2026-05-25T00:00:00.000Z",
          windowEnd: "2026-05-26T00:00:00.000Z",
        },
      },
    ]),
    "durable_webhook_work",
  );
  assert.equal(
    classifyDeviceSyncWebhookAcceptanceMode([
      {
        kind: "delete",
        payload: {
          resourceId: "resource-1",
        },
      },
    ]),
    "durable_webhook_work",
  );
});
