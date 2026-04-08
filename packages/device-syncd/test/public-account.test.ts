import assert from "node:assert/strict";

import { test } from "vitest";

import {
  redactPublicDeviceSyncMetadata,
  toRedactedPublicDeviceSyncAccount,
} from "../src/public-account.ts";

test("public-account helpers always drop metadata while preserving the public account shape", () => {
  const account = {
    id: "dsa_123",
    provider: "oura",
    externalAccountId: "oura-user-1",
    displayName: "Oura User",
    status: "active",
    scopes: ["daily", "personal"],
    accessTokenExpiresAt: "2026-04-07T01:00:00.000Z",
    metadata: {
      bodyMass: 70,
      rawProfile: {
        id: "sensitive",
      },
    },
    connectedAt: "2026-04-07T00:00:00.000Z",
    lastWebhookAt: null,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextReconcileAt: "2026-04-07T02:00:00.000Z",
    createdAt: "2026-04-07T00:00:00.000Z",
    updatedAt: "2026-04-07T00:00:00.000Z",
  } as const;

  const redacted = toRedactedPublicDeviceSyncAccount(account);

  assert.deepEqual(redactPublicDeviceSyncMetadata(account.metadata), {});
  assert.deepEqual(redactPublicDeviceSyncMetadata(null), {});
  assert.deepEqual(redactPublicDeviceSyncMetadata(undefined), {});
  assert.deepEqual(redacted, {
    ...account,
    metadata: {},
  });
  assert.notStrictEqual(redacted.metadata, account.metadata);
  assert.deepEqual(account.metadata, {
    bodyMass: 70,
    rawProfile: {
      id: "sensitive",
    },
  });
});
