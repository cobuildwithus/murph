import type { DatabaseSync } from "node:sqlite";

import { withImmediateTransaction } from "@murphai/runtime-state/node";

import { maybeParseJsonObject, stringifyJson } from "../shared.ts";

import type { ConsumeOAuthStateResult, OAuthStateRecord } from "../types.ts";

interface OAuthStateRow {
  state: string;
  provider: string;
  owner_id: string | null;
  return_to: string | null;
  metadata_json: string | null;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

function mapOAuthStateRow(row: OAuthStateRow | undefined): OAuthStateRecord | null {
  if (!row) {
    return null;
  }

  return {
    state: row.state,
    provider: row.provider,
    ...(row.owner_id ? { ownerId: row.owner_id } : {}),
    returnTo: row.return_to,
    metadata: maybeParseJsonObject(row.metadata_json),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export function createOAuthState(database: DatabaseSync, input: OAuthStateRecord): OAuthStateRecord {
  database.prepare(`
    insert into oauth_state (state, provider, owner_id, return_to, metadata_json, created_at, expires_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.state,
    input.provider,
    input.ownerId ?? null,
    input.returnTo,
    stringifyJson(input.metadata ?? {}),
    input.createdAt,
    input.expiresAt,
  );

  return input;
}

export function deleteExpiredOAuthStates(database: DatabaseSync, now: string): number {
  const result = database.prepare("delete from oauth_state where expires_at <= ?").run(now) as { changes: number };
  return result.changes ?? 0;
}

export function consumeOAuthState(
  database: DatabaseSync,
  state: string,
  now: string,
  expectedProvider?: string,
  expectedOwnerId?: string,
): ConsumeOAuthStateResult {
  return withImmediateTransaction(database, () => {
    const row = database.prepare(`
      select state, provider, owner_id, return_to, metadata_json, created_at, expires_at, consumed_at
      from oauth_state
      where state = ?
    `).get(state) as OAuthStateRow | undefined;

    if (!row) {
      return {
        status: "missing",
      };
    }

    if (Date.parse(row.expires_at) <= Date.parse(now)) {
      database.prepare("delete from oauth_state where state = ?").run(state);
      return {
        status: "missing",
      };
    }

    if (expectedProvider && row.provider !== expectedProvider) {
      return {
        status: "provider_mismatch",
        provider: row.provider,
      };
    }

    if (expectedOwnerId && row.owner_id !== expectedOwnerId) {
      return {
        status: "owner_mismatch",
      };
    }

    if (row.consumed_at !== null) {
      return {
        status: "replayed",
        record: mapOAuthStateRow(row)!,
      };
    }

    // Mark instead of delete so a redelivered callback stays distinguishable
    // from an unknown state until the row expires; duplicate or concurrent
    // consumers resolve to "replayed" instead of doing the work again.
    const consumeResult = database.prepare(
      "update oauth_state set consumed_at = ? where state = ? and consumed_at is null",
    ).run(now, state) as { changes: number };

    if ((consumeResult.changes ?? 0) !== 1) {
      return {
        status: "replayed",
        record: mapOAuthStateRow(row)!,
      };
    }

    return {
      status: "consumed",
      record: mapOAuthStateRow(row)!,
    };
  });
}
