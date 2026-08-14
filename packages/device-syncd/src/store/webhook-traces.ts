/**
 * Webhook-trace persistence owns claim/release/complete semantics for ingress
 * dedupe while keeping non-canonical residue bounded and narrow.
 */

import type { DatabaseSync } from "node:sqlite";

import { withImmediateTransaction } from "@murphai/runtime-state/node";

import { stringifyJson, subtractDays } from "../shared.ts";

import type {
  ClaimDeviceSyncWebhookTraceInput,
  DeviceSyncWebhookTraceClaimResult,
} from "../types.ts";

interface StoredWebhookTraceRow {
  provider: string;
  trace_id: string;
  status: string | null;
  processing_expires_at: string | null;
}

const DEVICE_SYNC_PROCESSED_WEBHOOK_TRACE_RETENTION_DAYS = 30;
// Webhook dedupe never queries trace rows by external account id, so keep only
// a fixed placeholder instead of any user-linked identifier.
const MINIMIZED_WEBHOOK_TRACE_EXTERNAL_ACCOUNT_ID = "_minimized_";
const MINIMIZED_WEBHOOK_TRACE_PAYLOAD_JSON = stringifyJson({});

export function claimDeviceSyncWebhookTrace(
  database: DatabaseSync,
  input: ClaimDeviceSyncWebhookTraceInput,
): DeviceSyncWebhookTraceClaimResult {
  return withImmediateTransaction(database, () => {
    pruneProcessedDeviceSyncWebhookTraces(database, new Date().toISOString());

    const existing = database.prepare(`
      select provider, trace_id, status, processing_expires_at
      from webhook_trace
      where provider = ?
        and trace_id = ?
    `).get(input.provider, input.traceId) as StoredWebhookTraceRow | undefined;

    if (!existing) {
      database.prepare(`
        insert into webhook_trace (
          provider,
          trace_id,
          external_account_id,
          event_type,
          received_at,
          payload_json,
          status,
          processing_expires_at,
          claim_token
        ) values (?, ?, ?, ?, ?, ?, 'processing', ?, ?)
      `).run(
        input.provider,
        input.traceId,
        MINIMIZED_WEBHOOK_TRACE_EXTERNAL_ACCOUNT_ID,
        input.eventType,
        input.receivedAt,
        MINIMIZED_WEBHOOK_TRACE_PAYLOAD_JSON,
        input.processingExpiresAt,
        input.claimToken,
      );

      return "claimed";
    }

    if ((existing.status ?? "processed") === "processed") {
      return "processed";
    }

    if (
      existing.processing_expires_at
      && Date.parse(existing.processing_expires_at) > Date.parse(input.claimedAt)
    ) {
      return "processing";
    }

    const result = database.prepare(`
      update webhook_trace
      set external_account_id = ?,
          event_type = ?,
          received_at = ?,
          payload_json = ?,
          status = 'processing',
          processing_expires_at = ?,
          claim_token = ?
      where provider = ?
        and trace_id = ?
        and coalesce(status, 'processed') = 'processing'
        and (
          processing_expires_at is null
          or processing_expires_at <= ?
        )
    `).run(
      MINIMIZED_WEBHOOK_TRACE_EXTERNAL_ACCOUNT_ID,
      input.eventType,
      input.receivedAt,
      MINIMIZED_WEBHOOK_TRACE_PAYLOAD_JSON,
      input.processingExpiresAt,
      input.claimToken,
      input.provider,
      input.traceId,
      input.claimedAt,
    ) as { changes: number };

    return (result.changes ?? 0) > 0 ? "claimed" : "processing";
  });
}

export function completeDeviceSyncWebhookTrace(
  database: DatabaseSync,
  provider: string,
  traceId: string,
  claimToken: string,
): boolean {
  const result = database.prepare(`
    update webhook_trace
    set payload_json = ?,
        status = 'processed',
        processing_expires_at = null,
        claim_token = null
    where provider = ?
      and trace_id = ?
      and claim_token = ?
      and coalesce(status, 'processed') = 'processing'
  `).run(MINIMIZED_WEBHOOK_TRACE_PAYLOAD_JSON, provider, traceId, claimToken);

  pruneProcessedDeviceSyncWebhookTraces(database, new Date().toISOString());
  return (result.changes ?? 0) > 0;
}

export function releaseDeviceSyncWebhookTrace(
  database: DatabaseSync,
  provider: string,
  traceId: string,
  claimToken: string,
): void {
  database.prepare(`
    delete from webhook_trace
    where provider = ?
      and trace_id = ?
      and claim_token = ?
      and coalesce(status, 'processed') = 'processing'
  `).run(provider, traceId, claimToken);

  pruneProcessedDeviceSyncWebhookTraces(database, new Date().toISOString());
}

function pruneProcessedDeviceSyncWebhookTraces(
  database: DatabaseSync,
  referenceTimestamp: string,
): void {
  database.prepare(`
    delete from webhook_trace
    where coalesce(status, 'processed') = 'processed'
      and received_at < ?
  `).run(
    subtractDays(
      referenceTimestamp,
      DEVICE_SYNC_PROCESSED_WEBHOOK_TRACE_RETENTION_DAYS,
    ),
  );
}
