import assert from "node:assert/strict";

import { test } from "vitest";

import {
  DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE,
  DEVICE_SYNC_SOURCE_HISTORICAL_BACKFILL_COMPLETED_AT_KEY,
  isDeviceSyncConnectionSetupConfirmed,
  isDeviceSyncConnectionSetupPending,
  isDeviceSyncSourceHistoricalBackfillComplete,
  isDeviceSyncSourceResourceAvailabilityMetadataKey,
  isEstablishedDeviceSyncConnection,
  isJunctionHistoricalResetProviderSlug,
  redactPublicDeviceSyncMetadata,
  requiresHistoricalResetDeviceSyncSource,
  toRedactedPublicDeviceSyncAccount,
} from "../src/public-account.ts";

import type { PublicDeviceSyncAccount } from "../src/types.ts";

test("public-account helpers always drop metadata while preserving the public account shape", () => {
  const account: PublicDeviceSyncAccount = {
    id: "dsa_123",
    provider: "oura",
    externalAccountId: "oura-user-1",
    displayName: "Oura User",
    status: "active",
    setupPhase: null,
    setupExpiresAt: null,
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
  };

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

test("established connection status requires active source-confirmed setup", () => {
  assert.equal(isDeviceSyncConnectionSetupConfirmed({
    setupPhase: "source_confirmed",
  }), true);
  assert.equal(isEstablishedDeviceSyncConnection({
    setupPhase: "source_confirmed",
    status: "active",
  }), true);

  for (const setupPhase of ["pending_link", "link_returned", "failed", null]) {
    assert.equal(isDeviceSyncConnectionSetupConfirmed({ setupPhase }), false);
    assert.equal(isEstablishedDeviceSyncConnection({
      setupPhase,
      status: "active",
    }), false);
  }

  assert.equal(isEstablishedDeviceSyncConnection({
    setupPhase: "source_confirmed",
    status: "disconnected",
  }), false);

  assert.equal(isDeviceSyncConnectionSetupPending({ setupPhase: "pending_link" }), true);
  assert.equal(isDeviceSyncConnectionSetupPending({ setupPhase: "link_returned" }), true);
  assert.equal(isDeviceSyncConnectionSetupPending({ setupPhase: "source_confirmed" }), false);
  assert.equal(isDeviceSyncConnectionSetupPending({ setupPhase: null }), false);
});

test("historical connection reset recovery is limited to Garmin error sources", () => {
  assert.equal(isJunctionHistoricalResetProviderSlug("garmin"), true);
  assert.equal(isJunctionHistoricalResetProviderSlug(" Garmin "), true);
  assert.equal(isJunctionHistoricalResetProviderSlug("oura"), false);
  assert.equal(isJunctionHistoricalResetProviderSlug(null), false);

  assert.equal(requiresHistoricalResetDeviceSyncSource({
    lastErrorCode: DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE,
    sourceProviderSlug: "garmin",
    status: "error",
  }), true);
  assert.equal(requiresHistoricalResetDeviceSyncSource({
    lastErrorCode: DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE,
    sourceProviderSlug: "oura",
    status: "error",
  }), false);
  assert.equal(requiresHistoricalResetDeviceSyncSource({
    lastErrorCode: DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE,
    sourceProviderSlug: "garmin",
    status: "connected",
  }), false);
});

test("source history readiness requires a valid completion marker no older than the source", () => {
  assert.equal(isDeviceSyncSourceHistoricalBackfillComplete({
    firstSeenAt: "2026-08-11T10:00:00.000Z",
    resourceAvailabilitySummary: {
      [DEVICE_SYNC_SOURCE_HISTORICAL_BACKFILL_COMPLETED_AT_KEY]:
        "2026-08-11T12:00:00.000Z",
    },
  }), true);
  assert.equal(isDeviceSyncSourceHistoricalBackfillComplete({
    firstSeenAt: "2026-08-11T10:00:00.000Z",
    resourceAvailabilitySummary: {
      [DEVICE_SYNC_SOURCE_HISTORICAL_BACKFILL_COMPLETED_AT_KEY]:
        "2026-08-11T09:59:59.000Z",
    },
  }), false);
  assert.equal(isDeviceSyncSourceHistoricalBackfillComplete({
    firstSeenAt: "2026-08-11T10:00:00.000Z",
    resourceAvailabilitySummary: {
      [DEVICE_SYNC_SOURCE_HISTORICAL_BACKFILL_COMPLETED_AT_KEY]: "not-a-date",
    },
  }), false);
  assert.equal(isDeviceSyncSourceHistoricalBackfillComplete({
    firstSeenAt: "2026-08-11T10:00:00.000Z",
    resourceAvailabilitySummary: { sleep: true },
  }), false);
  assert.equal(
    isDeviceSyncSourceResourceAvailabilityMetadataKey(
      DEVICE_SYNC_SOURCE_HISTORICAL_BACKFILL_COMPLETED_AT_KEY,
    ),
    true,
  );
  assert.equal(isDeviceSyncSourceResourceAvailabilityMetadataKey("sleep"), false);
});
