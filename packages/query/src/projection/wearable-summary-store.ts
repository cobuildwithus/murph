import {
  assertQueryProjectionTables,
  expectEnumString,
  expectNullableString,
  expectNumber,
  expectString,
  openQueryProjectionDatabase,
  type DatabaseSync,
  type QueryProjectionLocation,
  type SqliteRow,
} from "./schema.ts";
import {
  normalizeWearableProviders,
  wearableProviderRowKeys,
} from "./provider-scope.ts";

export const QUERY_WEARABLE_SUMMARY_KINDS = [
  "activity",
  "body_state",
  "recovery",
  "sleep",
  "source_health",
] as const;

export type QueryWearableSummaryKind = typeof QUERY_WEARABLE_SUMMARY_KINDS[number];

export interface QueryWearableSummaryRow {
  id: string;
  providerScopeJson: string;
  providerScopeKey: string;
  sortRank: number;
  summaryDate: string | null;
  summaryJson: string;
  summaryKind: QueryWearableSummaryKind;
}

export interface QueryWearableSummaryRowSet {
  providerFilterWasProvided: boolean;
  providers: string[];
  rows: QueryWearableSummaryRow[];
}

export function insertWearableSummaryRows(
  database: DatabaseSync,
  wearableSummaries: readonly QueryWearableSummaryRow[],
): void {
  const insertWearableSummary = database.prepare(`
    INSERT INTO query_wearable_summaries (
      id,
      provider_scope_key,
      provider_scope_json,
      summary_kind,
      summary_date,
      sort_rank,
      summary_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  wearableSummaries.forEach((row) => {
    insertWearableSummary.run(
      row.id,
      row.providerScopeKey,
      row.providerScopeJson,
      row.summaryKind,
      row.summaryDate,
      row.sortRank,
      row.summaryJson,
    );
  });
}

export function readWearableSummaryRows(
  location: QueryProjectionLocation,
  providerFilter: readonly string[] | undefined,
): QueryWearableSummaryRowSet {
  const providerFilterWasProvided = providerFilter !== undefined;
  const providers = normalizeWearableProviders(providerFilter);

  if (providerFilterWasProvided && providers.length === 0) {
    return {
      providerFilterWasProvided,
      providers,
      rows: [],
    };
  }

  const database = openQueryProjectionDatabase(location, {
    create: false,
    readOnly: true,
  });

  try {
    assertQueryProjectionTables(database, location);

    return {
      providerFilterWasProvided,
      providers,
      rows: readRows(database, providers.length > 0 ? wearableProviderRowKeys(providers) : null),
    };
  } finally {
    database.close();
  }
}

function readRows(
  database: DatabaseSync,
  providerRowKeys: readonly string[] | null,
): QueryWearableSummaryRow[] {
  const parameters = providerRowKeys ? [...providerRowKeys] : [];
  const whereSql = providerRowKeys
    ? `WHERE provider_scope_key IN (${providerRowKeys.map(() => "?").join(", ")})`
    : "";

  return database.prepare(`
    SELECT
      id,
      provider_scope_key AS providerScopeKey,
      provider_scope_json AS providerScopeJson,
      summary_kind AS summaryKind,
      summary_date AS summaryDate,
      sort_rank AS sortRank,
      summary_json AS summaryJson
    FROM query_wearable_summaries
    ${whereSql}
    ORDER BY summary_kind ASC, summary_date DESC, sort_rank ASC
  `).all(...parameters).map(decodeQueryWearableSummaryRow);
}

function decodeQueryWearableSummaryRow(row: SqliteRow): QueryWearableSummaryRow {
  return {
    id: expectString(row.id, "query_wearable_summaries.id"),
    providerScopeJson: expectString(
      row.providerScopeJson,
      "query_wearable_summaries.provider_scope_json",
    ),
    providerScopeKey: expectString(
      row.providerScopeKey,
      "query_wearable_summaries.provider_scope_key",
    ),
    sortRank: expectNumber(row.sortRank, "query_wearable_summaries.sort_rank"),
    summaryDate: expectNullableString(row.summaryDate, "query_wearable_summaries.summary_date"),
    summaryJson: expectString(row.summaryJson, "query_wearable_summaries.summary_json"),
    summaryKind: expectEnumString(
      row.summaryKind,
      "query_wearable_summaries.summary_kind",
      QUERY_WEARABLE_SUMMARY_KINDS,
    ),
  };
}
