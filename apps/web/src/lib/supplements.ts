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
  name: string;
  brand: string | null;
  upc: string | null;
  offMarket: boolean;
};

export type SupplementDetail = SupplementSearchItem & {
  label: unknown;
};

export function createSupplementsQueries(client: SupplementsQueryClient): {
  getSupplementById: (id: string) => Promise<SupplementDetail | null>;
  getSupplementByUpc: (upc: string) => Promise<SupplementDetail | null>;
  searchSupplements: (input: {
    includeOffMarket: boolean;
    limit: number;
    q: string;
  }) => Promise<SupplementSearchItem[]>;
} {
  return {
    async getSupplementById(id) {
      if (!/^\d+$/u.test(id)) {
        return null;
      }

      const { rows } = await client.query<SupplementDetail>(
        `
        SELECT
          dsld_id::text AS id,
          name,
          brand,
          upc,
          off_market AS "offMarket",
          label
        FROM supplements
        WHERE dsld_id = $1
        LIMIT 1
        `,
        [id],
      );

      return rows[0] ?? null;
    },

    async getSupplementByUpc(upc) {
      const normalizedUpc = upc.replace(/\D/gu, "");

      if (!normalizedUpc) {
        return null;
      }

      const { rows } = await client.query<SupplementDetail>(
        `
        SELECT
          dsld_id::text AS id,
          name,
          brand,
          upc,
          off_market AS "offMarket",
          label
        FROM supplements
        WHERE upc = $1
        LIMIT 1
        `,
        [normalizedUpc],
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
        )
        SELECT
          dsld_id::text AS id,
          name,
          brand,
          upc,
          off_market AS "offMarket"
        FROM supplements, query
        WHERE
          to_tsvector('simple', search_text) @@ query.tsq
          AND ($2::boolean OR off_market = false)
        ORDER BY
          ts_rank_cd(to_tsvector('simple', search_text), query.tsq) DESC,
          name ASC
        LIMIT $3
        `,
        [q, input.includeOffMarket, input.limit],
      );

      return rows;
    },
  };
}

export async function searchSupplements(input: {
  q: string;
  limit: number;
  includeOffMarket: boolean;
}): Promise<SupplementSearchItem[]> {
  return await defaultQueries().searchSupplements(input);
}

export async function getSupplementById(id: string): Promise<SupplementDetail | null> {
  return await defaultQueries().getSupplementById(id);
}

export async function getSupplementByUpc(upc: string): Promise<SupplementDetail | null> {
  return await defaultQueries().getSupplementByUpc(upc);
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
