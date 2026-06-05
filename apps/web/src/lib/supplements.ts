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
  dataOrigin: string;
  dataOriginId: string;
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
      const id = input.id.trim();

      if (!isSupplementLookupId(id)) {
        return null;
      }

      const { rows } = await client.query<SupplementDetail>(
        `
        SELECT
          id,
          data_origin AS "dataOrigin",
          data_origin_id AS "dataOriginId",
          name,
          brand,
          upc,
          off_market AS "offMarket",
          label
        FROM supplements
        WHERE
          id = $1
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
        SELECT
          id,
          data_origin AS "dataOrigin",
          data_origin_id AS "dataOriginId",
          name,
          brand,
          upc,
          off_market AS "offMarket",
          label
        FROM supplements
        WHERE
          upc = ANY($1::text[])
          AND ($2::boolean OR off_market = false)
        ORDER BY
          off_market ASC,
          array_position($1::text[], upc) ASC,
          data_origin_priority ASC,
          name ASC,
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
            id,
            data_origin AS "dataOrigin",
            data_origin_id AS "dataOriginId",
            name,
            brand,
            upc,
            off_market AS "offMarket",
            ts_rank_cd(to_tsvector('simple', search_text), query.tsq) AS search_rank,
            data_origin_priority,
            row_number() OVER (
              PARTITION BY canonical_key
              ORDER BY
                ts_rank_cd(to_tsvector('simple', search_text), query.tsq) DESC,
                off_market ASC,
                data_origin_priority ASC,
                name ASC,
                id ASC
            ) AS dedupe_rank
          FROM supplements, query
          WHERE
            to_tsvector('simple', search_text) @@ query.tsq
            AND ($2::boolean OR off_market = false)
        )
        SELECT
          id,
          "dataOrigin",
          "dataOriginId",
          name,
          brand,
          upc,
          "offMarket"
        FROM ranked
        WHERE dedupe_rank = 1
        ORDER BY
          search_rank DESC,
          data_origin_priority ASC,
          name ASC
        LIMIT $3
        `,
        [q, input.includeOffMarket, input.limit],
      );

      return rows;
    },
  };
}

function isSupplementLookupId(id: string): boolean {
  if (id.length > 256) {
    return false;
  }

  return /^\d+$/u.test(id) || /^[a-z][a-z0-9_-]*:\S+$/u.test(id);
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
