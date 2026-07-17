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

export interface ReadWearableSummaryRowsFilters {
  from?: string;
  providers?: readonly string[];
  summaryKinds?: readonly QueryWearableSummaryKind[];
  to?: string;
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
  filters: ReadWearableSummaryRowsFilters = {},
): QueryWearableSummaryRowSet {
  const providerFilterWasProvided = filters.providers !== undefined;
  const providers = normalizeWearableProviders(filters.providers);
  const summaryKinds = filters.summaryKinds === undefined
    ? null
    : [...new Set(filters.summaryKinds)];

  if (
    (providerFilterWasProvided && providers.length === 0)
    || (summaryKinds !== null && summaryKinds.length === 0)
  ) {
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
      rows: readRows(database, {
        from: filters.from,
        providerRowKeys: providers.length > 0 ? wearableProviderRowKeys(providers) : null,
        summaryKinds,
        to: filters.to,
      }),
    };
  } finally {
    database.close();
  }
}

function readRows(
  database: DatabaseSync,
  filters: {
    from?: string;
    providerRowKeys: readonly string[] | null;
    summaryKinds: readonly QueryWearableSummaryKind[] | null;
    to?: string;
  },
): QueryWearableSummaryRow[] {
  const clauses: string[] = [];
  const parameters: string[] = [];

  if (filters.providerRowKeys) {
    clauses.push(`provider_scope_key IN (${filters.providerRowKeys.map(() => "?").join(", ")})`);
    parameters.push(...filters.providerRowKeys);
  }

  if (filters.summaryKinds) {
    clauses.push(`summary_kind IN (${filters.summaryKinds.map(() => "?").join(", ")})`);
    parameters.push(...filters.summaryKinds);
  }

  const dateClauses: string[] = [];
  if (filters.from) {
    dateClauses.push("summary_date >= ?");
    parameters.push(filters.from);
  }
  if (filters.to) {
    dateClauses.push("summary_date <= ?");
    parameters.push(filters.to);
  }
  if (dateClauses.length > 0) {
    const preserveSourceHealth = filters.summaryKinds === null
      || filters.summaryKinds.includes("source_health");
    clauses.push(
      preserveSourceHealth
        ? `(summary_kind = 'source_health' OR (${dateClauses.join(" AND ")}))`
        : `(${dateClauses.join(" AND ")})`,
    );
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

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
