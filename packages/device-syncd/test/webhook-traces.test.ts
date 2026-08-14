import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { ensureDeviceSyncStoreSchema } from "../src/store/schema.ts";
import {
  claimDeviceSyncWebhookTrace,
  completeDeviceSyncWebhookTrace,
} from "../src/store/webhook-traces.ts";

const MINIMIZED_WEBHOOK_TRACE_EXTERNAL_ACCOUNT_ID = "_minimized_";

function createDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  ensureDeviceSyncStoreSchema(database);
  return database;
}

describe("claimDeviceSyncWebhookTrace", () => {
  let database: DatabaseSync | null = null;

  afterEach(() => {
    database?.close();
    database = null;
  });

  it("stores a minimized external account placeholder", () => {
    database = createDatabase();

    const result = claimDeviceSyncWebhookTrace(database, {
      eventType: "sleep.updated",
      externalAccountId: "external-account-123",
      claimedAt: "2026-04-12T00:00:00.000Z",
      claimToken: "claim-1",
      processingExpiresAt: "2026-04-12T00:05:00.000Z",
      provider: "oura",
      receivedAt: "2026-04-12T00:00:00.000Z",
      traceId: "trace-1",
    });

    expect(result).toBe("claimed");
    expect(
      database
        .prepare(
          `
            select external_account_id
            from webhook_trace
            where provider = ?
              and trace_id = ?
          `,
        )
        .get("oura", "trace-1"),
    ).toEqual({
      external_account_id: MINIMIZED_WEBHOOK_TRACE_EXTERNAL_ACCOUNT_ID,
    });
  });

  it("prunes processed traces older than the retention window before new claims", () => {
    database = createDatabase();

    database.prepare(`
      insert into webhook_trace (
        provider,
        trace_id,
        external_account_id,
        event_type,
        received_at,
        payload_json,
        status,
        processing_expires_at
      ) values (?, ?, ?, ?, ?, ?, 'processed', null)
    `).run(
      "oura",
      "stale-trace",
      "legacy-account",
      "sleep.updated",
      "2026-02-01T00:00:00.000Z",
      "{}",
    );

    const result = claimDeviceSyncWebhookTrace(database, {
      eventType: "sleep.updated",
      externalAccountId: "external-account-456",
      claimedAt: "2026-04-12T00:00:00.000Z",
      claimToken: "claim-2",
      processingExpiresAt: "2026-04-12T00:05:00.000Z",
      provider: "oura",
      receivedAt: "2026-04-12T00:00:00.000Z",
      traceId: "fresh-trace",
    });

    expect(result).toBe("claimed");
    expect(
      database
        .prepare(`select trace_id from webhook_trace where provider = ? order by trace_id asc`)
        .all("oura"),
    ).toEqual([
      {
        trace_id: "fresh-trace",
      },
    ]);
  });

  it("ignores stale completion attempts after a newer claim takes over", () => {
    database = createDatabase();

    expect(claimDeviceSyncWebhookTrace(database, {
      eventType: "sleep.updated",
      externalAccountId: "external-account-123",
      claimedAt: "2026-04-12T00:00:00.000Z",
      claimToken: "claim-old",
      processingExpiresAt: "2026-04-12T00:05:00.000Z",
      provider: "oura",
      receivedAt: "2026-04-12T00:00:00.000Z",
      traceId: "trace-lease",
    })).toBe("claimed");
    expect(claimDeviceSyncWebhookTrace(database, {
      eventType: "sleep.updated",
      externalAccountId: "external-account-123",
      claimedAt: "2026-04-12T00:06:00.000Z",
      claimToken: "claim-new",
      processingExpiresAt: "2026-04-12T00:11:00.000Z",
      provider: "oura",
      receivedAt: "2026-04-12T00:06:00.000Z",
      traceId: "trace-lease",
    })).toBe("claimed");

    completeDeviceSyncWebhookTrace(database, "oura", "trace-lease", "claim-old");

    expect(
      database
        .prepare(
          `
            select claim_token, status
            from webhook_trace
            where provider = ?
              and trace_id = ?
          `,
        )
        .get("oura", "trace-lease"),
    ).toEqual({
      claim_token: "claim-new",
      status: "processing",
    });
  });

  it("uses claim time for delayed receipt lease takeover", () => {
    database = createDatabase();
    expect(claimDeviceSyncWebhookTrace(database, {
      claimedAt: "2026-04-12T12:00:00.000Z",
      claimToken: "claim-old",
      eventType: "sleep.updated",
      externalAccountId: "external-account-123",
      processingExpiresAt: "2026-04-12T12:03:00.000Z",
      provider: "oura",
      receivedAt: "2026-04-12T11:00:00.000Z",
      traceId: "trace-delayed",
    })).toBe("claimed");
    expect(claimDeviceSyncWebhookTrace(database, {
      claimedAt: "2026-04-12T12:02:00.000Z",
      claimToken: "claim-too-early",
      eventType: "sleep.updated",
      externalAccountId: "external-account-123",
      processingExpiresAt: "2026-04-12T12:07:00.000Z",
      provider: "oura",
      receivedAt: "2026-04-12T13:00:00.000Z",
      traceId: "trace-delayed",
    })).toBe("processing");
    expect(claimDeviceSyncWebhookTrace(database, {
      claimedAt: "2026-04-12T12:04:00.000Z",
      claimToken: "claim-new",
      eventType: "sleep.updated",
      externalAccountId: "external-account-123",
      processingExpiresAt: "2026-04-12T12:09:00.000Z",
      provider: "oura",
      receivedAt: "2026-04-12T11:00:00.000Z",
      traceId: "trace-delayed",
    })).toBe("claimed");
  });
});
