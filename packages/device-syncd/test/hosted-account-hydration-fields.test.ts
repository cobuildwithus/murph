import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";

import { test } from "vitest";

import { SqliteDeviceSyncStore } from "../src/store.ts";
import type { HostedAccountHydrationInput } from "../src/store/hosted-account-hydration.ts";
import { makeTempDirectory } from "./helpers.ts";

test.each(["stale", "replayed"] as const)(
  "%s hosted connection preserves empty fields and legacy nullable fallbacks",
  async (revision) => {
    const tempDir = await makeTempDirectory("murph-hosted-hydration-fields");
    const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));
    const input: HostedAccountHydrationInput = {
      credential: { kind: "none" },
      connection: {
        connectedAt: "2026-09-01T00:00:00.000Z",
        displayName: null,
        externalAccountId: "synthetic-hydration-account",
        metadata: {},
        provider: "demo",
        scopes: [],
        setupExpiresAt: null,
        setupPhase: null,
        status: "active",
        updatedAt: "2026-09-01T02:00:00.000Z",
      },
      hostedObservedTokenVersion: null,
      hostedObservedUpdatedAt: "2026-09-01T02:00:00.000Z",
      localState: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: null,
        lastSyncErrorAt: null,
        lastSyncStartedAt: null,
        lastWebhookAt: null,
        nextReconcileAt: null,
      },
    };

    try {
      const initial = store.hydrateHostedAccount(input);
      assert.ok(initial);
      const current = revision === "replayed"
        ? store.patchAccount(initial.id, { metadata: {} })
        : initial;

      const observedAt = revision === "stale"
        ? "2026-09-01T01:00:00.000Z"
        : input.hostedObservedUpdatedAt;
      const rejected = store.hydrateHostedAccount({
        ...input,
        hostedObservedUpdatedAt: observedAt,
        connection: {
          ...input.connection,
          connectedAt: "2026-09-01T01:00:00.000Z",
          displayName: "Synthetic setup",
          metadata: { incoming: true },
          scopes: ["sleep"],
          setupExpiresAt: "2026-09-01T04:00:00.000Z",
          setupPhase: "pending_link",
          status: "disconnected",
          updatedAt: "2026-09-01T01:00:00.000Z",
        },
        localState: {
          ...input.localState,
          lastSyncCompletedAt: "2026-09-01T03:00:00.000Z",
        },
      });

      assert.ok(rejected);
      assert.equal(rejected.id, initial.id);
      assert.equal(rejected.status, "active");
      assert.equal(rejected.connectedAt, initial.connectedAt);
      assert.equal(rejected.updatedAt, current.updatedAt);
      assert.equal(rejected.disconnectGeneration, initial.disconnectGeneration);
      assert.deepEqual(rejected.scopes, []);
      assert.deepEqual(rejected.metadata, {});
      assert.equal(rejected.displayName, "Synthetic setup");
      assert.equal(rejected.setupPhase, "pending_link");
      assert.equal(rejected.setupExpiresAt, "2026-09-01T04:00:00.000Z");
      assert.equal(rejected.lastSyncCompletedAt, "2026-09-01T03:00:00.000Z");
      assert.equal(rejected.hostedObservedUpdatedAt, initial.hostedObservedUpdatedAt);
      assert.equal(rejected.hostedObservedConnectionRevision, initial.hostedObservedConnectionRevision);

      const accepted = store.hydrateHostedAccount({
        ...input,
        hostedObservedUpdatedAt: "2026-09-01T05:00:00.000Z",
        connection: {
          ...input.connection,
          updatedAt: "2026-09-01T05:00:00.000Z",
        },
      });
      assert.ok(accepted);
      assert.equal(accepted.displayName, null);
      assert.equal(accepted.setupPhase, null);
      assert.equal(accepted.setupExpiresAt, null);
      assert.equal(accepted.hostedObservedConnectionRevision, accepted.localConnectionRevision);
    } finally {
      store.close();
      await rm(tempDir, { force: true, recursive: true });
    }
  },
);
