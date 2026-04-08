import type { DatabaseSync } from "node:sqlite";

import { withImmediateTransaction } from "@murphai/runtime-state/node";

import { maybeParseJsonObject, stringifyJson } from "../shared.ts";

import type { OAuthStateRecord } from "../types.ts";

interface OAuthStateRow {
  state: string;
  provider: string;
  return_to: string | null;
  metadata_json: string | null;
  created_at: string;
  expires_at: string;
}

function mapOAuthStateRow(row: OAuthStateRow | undefined): OAuthStateRecord | null {
  if (!row) {
    return null;
  }

  return {
    state: row.state,
    provider: row.provider,
    returnTo: row.return_to,
    metadata: maybeParseJsonObject(row.metadata_json),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export function createOAuthState(database: DatabaseSync, input: OAuthStateRecord): OAuthStateRecord {
  database.prepare(`
    insert into oauth_state (state, provider, return_to, metadata_json, created_at, expires_at)
    values (?, ?, ?, ?, ?, ?)
  `).run(
    input.state,
    input.provider,
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

export function consumeOAuthState(database: DatabaseSync, state: string, now: string): OAuthStateRecord | null {
  return withImmediateTransaction(database, () => {
    const row = database.prepare(`
      select state, provider, return_to, metadata_json, created_at, expires_at
      from oauth_state
      where state = ?
    `).get(state) as OAuthStateRow | undefined;

    if (!row || Date.parse(row.expires_at) <= Date.parse(now)) {
      database.prepare("delete from oauth_state where state = ?").run(state);
      return null;
    }

    database.prepare("delete from oauth_state where state = ?").run(state);
    return mapOAuthStateRow(row);
  });
}
