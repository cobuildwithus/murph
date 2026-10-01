import { describe, expect, it } from "vitest";

import { SqliteDeviceSyncStore } from "../src/store.ts";

describe("bounded sync-result metadata", () => {
  it.each(["success", "failure"] as const)(
    "preserves historical progress across %s and a subsequent diagnostic patch",
    (outcome) => {
      const store = new SqliteDeviceSyncStore(":memory:");
      const progress = {
        junctionReconcileProofV1: "synthetic-proof",
        junctionTemporalSweepV1: "synthetic-sweep",
        junctionProfileSummaryCheckedAt: "2025-04-01T00:00:00.000Z",
        junctionProfileSummaryNormalizationRevision: 2,
        junctionHistoricalBackfillStatus: "coverage_v3_complete",
        junctionHistoricalBackfillEmptyAttempts: 0,
        junctionHistoricalBackfillLastEmptyAt: null,
        junctionHistoricalBackfillWindowStart: "2025-01-01",
        junctionHistoricalBackfillWindowEnd: "2025-04-01",
      };
      const metadata = {
        ...Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`diagnostic${index}`, index])),
        ...progress,
      };
      try {
        const account = store.upsertAccount({
          provider: "junction",
          externalAccountId: "synthetic-progress-account",
          credential: { kind: "provider_config", providerConfigKey: "junction", credentialMetadata: {} },
          scopes: [],
          metadata,
          connectedAt: "2025-04-01T00:00:00.000Z",
        });
        const metadataPatch = {
          junctionProfileSummaryCheckedAt: "2025-04-02T00:00:00.000Z",
          junctionProfileSummaryNormalizationRevision: 2,
        };
        const applied = outcome === "success"
          ? store.markSyncSucceeded(account.id, "2025-04-02T00:00:00.000Z", account.disconnectGeneration, {
              metadataPatch,
            })
          : store.markSyncFailed(account.id, "2025-04-02T00:00:00.000Z", "RETRY", "Retry later.", "active", {
              metadataPatch,
            });
        expect(applied).toBe(true);
        const after = store.getAccountById(account.id);
        expect(after?.metadata).toMatchObject({ ...progress, ...metadataPatch });
        expect(Object.keys(after?.metadata ?? {})).toHaveLength(16);

        const diagnostics = { metadataPatch: Object.fromEntries(
          Array.from({ length: 16 }, (_, index) => [`newDiagnostic${index}`, index]),
        ) };
        if (outcome === "success") {
          store.markSyncSucceeded(account.id, "2025-04-03T00:00:00.000Z", account.disconnectGeneration, diagnostics);
        } else {
          store.markSyncFailed(account.id, "2025-04-03T00:00:00.000Z", "RETRY", "Retry later.", "active", diagnostics);
        }
        expect(store.getAccountById(account.id)?.metadata).toMatchObject({ ...progress, ...metadataPatch });
        expect(Object.keys(store.getAccountById(account.id)?.metadata ?? {})).toHaveLength(16);
      } finally {
        store.close();
      }
    },
  );
});
