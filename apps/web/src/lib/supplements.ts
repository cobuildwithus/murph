import "server-only";

import pg, { type Pool as PgPool } from "pg";

const { Pool } = pg;

const SUPPLEMENT_DATABASE_ENV = "MURPH_SUPPLEMENT_DB_URL";
const DEFAULT_POOL_MAX = 3;

type SupplementsQueryClient = {
  query<T>(text: string, values: unknown[]): Promise<{ rows: T[] }>;
};

let defaultPool: PgPool | null = null;

export type SupplementSearchItem = {
  id: string;
  source: string;
  sourceId: string;
  name: string;
  brand: string | null;
  upc: string | null;
  offMarket: boolean;
};

export type SupplementDetail = SupplementSearchItem & {
  label: unknown;
};

export function createSupplementsQueries(client: SupplementsQueryClient): {
  getSupplementById: (input: {
    id: string;
    includeOffMarket: boolean;
  }) => Promise<SupplementDetail | null>;
  getSupplementByUpc: (input: {
    includeOffMarket: boolean;
    upc: string;
  }) => Promise<SupplementDetail | null>;
  searchSupplements: (input: {
    includeOffMarket: boolean;
    limit: number;
    q: string;
  }) => Promise<SupplementSearchItem[]>;
} {
  return {
    async getSupplementById(input) {
      const { id } = input;
      const externalId = parseExternalSupplementId(id);

      if (externalId) {
        const { rows } = await client.query<SupplementDetail>(
          `
          SELECT
            source || ':' || source_id AS id,
            source,
            source_id AS "sourceId",
            name,
            brand,
            upc,
            off_market AS "offMarket",
            label
          FROM supplement_external_labels
          WHERE
            source = $1
            AND source_id = $2
            AND ($3::boolean OR off_market = false)
          LIMIT 1
          `,
          [externalId.source, externalId.sourceId, input.includeOffMarket],
        );

        return rows[0] ?? null;
      }

      if (!/^\d+$/u.test(id)) {
        return null;
      }

      const { rows } = await client.query<SupplementDetail>(
        `
        SELECT
          dsld_id::text AS id,
          'dsld' AS source,
          dsld_id::text AS "sourceId",
          name,
          brand,
          upc,
          off_market AS "offMarket",
          label
        FROM supplements
        WHERE
          dsld_id = $1
          AND ($2::boolean OR off_market = false)
        LIMIT 1
        `,
        [id, input.includeOffMarket],
      );

      return rows[0] ?? null;
    },

    async getSupplementByUpc(input) {
      const normalizedUpc = input.upc.replace(/\D/gu, "");
      const upcVariants = buildUpcLookupVariants(normalizedUpc);

      if (upcVariants.length === 0) {
        return null;
      }

      const { rows } = await client.query<SupplementDetail>(
        `
        WITH ranked AS (
          SELECT
            dsld_id::text AS id,
            'dsld' AS source,
            dsld_id::text AS "sourceId",
            name,
            brand,
            upc,
            off_market AS "offMarket",
            label,
            array_position($1::text[], upc) AS upc_order,
            0 AS source_order
          FROM supplements
          WHERE
            upc = ANY($1::text[])
            AND ($2::boolean OR off_market = false)

          UNION ALL

          SELECT
            source || ':' || source_id AS id,
            source,
            source_id AS "sourceId",
            name,
            brand,
            upc,
            off_market AS "offMarket",
            label,
            array_position($1::text[], upc) AS upc_order,
            1 AS source_order
          FROM supplement_external_labels
          WHERE
            upc = ANY($1::text[])
            AND ($2::boolean OR off_market = false)
            AND (
              matched_dsld_id IS NULL
              OR NOT EXISTS (
                SELECT 1
                FROM supplements matched
                WHERE
                  matched.dsld_id = supplement_external_labels.matched_dsld_id
                  AND matched.upc = ANY($1::text[])
                  AND ($2::boolean OR matched.off_market = false)
              )
            )
        )
        SELECT
          id,
          source,
          "sourceId",
          name,
          brand,
          upc,
          "offMarket",
          label
        FROM ranked
        ORDER BY
          "offMarket" ASC,
          upc_order ASC,
          source_order ASC,
          id ASC
        LIMIT 1
        `,
        [upcVariants, input.includeOffMarket],
      );

      return rows[0] ?? null;
    },

    async searchSupplements(input) {
      const q = input.q.trim();

      if (!q) {
        return [];
      }

      const { rows } = await client.query<SupplementSearchItem>(
        `
        WITH query AS (
          SELECT websearch_to_tsquery('simple', $1) AS tsq
        ),
        ranked AS (
          SELECT
            dsld_id::text AS id,
            'dsld' AS source,
            dsld_id::text AS "sourceId",
            name,
            brand,
            upc,
            off_market AS "offMarket",
            ts_rank_cd(to_tsvector('simple', search_text), query.tsq) AS search_rank,
            0 AS source_order
          FROM supplements, query
          WHERE
            to_tsvector('simple', search_text) @@ query.tsq
            AND ($2::boolean OR off_market = false)

          UNION ALL

          SELECT
            source || ':' || source_id AS id,
            source,
            source_id AS "sourceId",
            name,
            brand,
            upc,
            off_market AS "offMarket",
            ts_rank_cd(to_tsvector('simple', search_text), query.tsq) AS search_rank,
            1 AS source_order
          FROM supplement_external_labels, query
          WHERE
            to_tsvector('simple', search_text) @@ query.tsq
            AND ($2::boolean OR off_market = false)
            AND (
              matched_dsld_id IS NULL
              OR NOT EXISTS (
                SELECT 1
                FROM supplements matched
                WHERE
                  matched.dsld_id = supplement_external_labels.matched_dsld_id
                  AND to_tsvector('simple', matched.search_text) @@ query.tsq
                  AND ($2::boolean OR matched.off_market = false)
              )
            )
        )
        SELECT
          id,
          source,
          "sourceId",
          name,
          brand,
          upc,
          "offMarket"
        FROM ranked
        ORDER BY
          search_rank DESC,
          source_order ASC,
          name ASC
        LIMIT $3
        `,
        [q, input.includeOffMarket, input.limit],
      );

      return rows;
    },
  };
}

function parseExternalSupplementId(id: string): { source: string; sourceId: string } | null {
  if (id.length > 256) {
    return null;
  }

  const match = /^([a-z][a-z0-9_-]*):(.+)$/u.exec(id);

  if (!match) {
    return null;
  }

  const [, source, sourceId] = match;

  if (!source || !sourceId.trim()) {
    return null;
  }

  return {
    source,
    sourceId: sourceId.trim(),
  };
}

function buildUpcLookupVariants(upc: string): string[] {
  if (!upc) {
    return [];
  }

  const variants = [upc];

  if (/^\d{12}$/u.test(upc)) {
    variants.push(`0${upc}`, `00${upc}`);
  } else if (/^0\d{12}$/u.test(upc)) {
    variants.push(upc.slice(1), `0${upc}`);
  } else if (/^00\d{12}$/u.test(upc)) {
    variants.push(upc.slice(2), upc.slice(1));
  }

  return [...new Set(variants)];
}

export async function searchSupplements(input: {
  q: string;
  limit: number;
  includeOffMarket: boolean;
}): Promise<SupplementSearchItem[]> {
  return await defaultQueries().searchSupplements(input);
}

export async function getSupplementById(input: {
  id: string;
  includeOffMarket: boolean;
}): Promise<SupplementDetail | null> {
  return await defaultQueries().getSupplementById(input);
}

export async function getSupplementByUpc(input: {
  includeOffMarket: boolean;
  upc: string;
}): Promise<SupplementDetail | null> {
  return await defaultQueries().getSupplementByUpc(input);
}

function defaultQueries(): ReturnType<typeof createSupplementsQueries> {
  return createSupplementsQueries(getDefaultPool());
}

function getDefaultPool(): PgPool {
  defaultPool ??= new Pool({
    connectionString: normalizeSupplementConnectionString(requireSupplementDatabaseUrl()),
    max: DEFAULT_POOL_MAX,
  });

  return defaultPool;
}

function requireSupplementDatabaseUrl(): string {
  const databaseUrl = process.env[SUPPLEMENT_DATABASE_ENV]?.trim();

  if (!databaseUrl) {
    throw new Error(`${SUPPLEMENT_DATABASE_ENV} is required`);
  }

  return databaseUrl;
}

export function normalizeSupplementConnectionString(databaseUrl: string): string {
  let parsed: URL;

  try {
    parsed = new URL(databaseUrl);
  } catch {
    return databaseUrl;
  }

  let changed = false;

  for (const key of ["sslcert", "sslkey", "sslrootcert"] as const) {
    if (parsed.searchParams.get(key) === "system") {
      parsed.searchParams.delete(key);
      changed = true;
    }
  }

  return changed ? parsed.toString() : databaseUrl;
}
