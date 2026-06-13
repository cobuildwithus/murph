import "server-only";

import pg, { type Pool as PgPool } from "pg";

const { Pool } = pg;

const LABELS_DATABASE_ENV = "MURPH_LABELS_DB_URL";
const LEGACY_SUPPLEMENT_DATABASE_ENV = "MURPH_SUPPLEMENT_DB_URL";
const DEFAULT_POOL_MAX = 3;
const DEFAULT_POOL_STATEMENT_TIMEOUT_MS = 8_000;
const PRODUCT_LABEL_BRAND_INDEX_TTL_MS = 10 * 60 * 1000;
const MAX_PRODUCT_LABEL_BRAND_SCOPES = 12;

const PRODUCT_LABELS_TABLE_SQL = {
  supplements: "supplements",
  foods: "foods",
} as const;

export type ProductLabelsTable = keyof typeof PRODUCT_LABELS_TABLE_SQL;
type ProductLabelsTableSql =
  (typeof PRODUCT_LABELS_TABLE_SQL)[ProductLabelsTable];

export type ProductLabelsQueryClient = {
  query<T>(text: string, values: unknown[]): Promise<{ rows: T[] }>;
};

let defaultLabelsPool: PgPool | null = null;
let defaultLegacySupplementPool: PgPool | null = null;

type ProductLabelBrandIndexEntry = {
  brand: string;
  normalizedBrand: string;
};

type ProductLabelBrandIndexCache = {
  expiresAt: number;
  promise: Promise<ProductLabelBrandIndexEntry[]>;
};

export type ProductLabelSearchItem = {
  id: string;
  dataOrigin: string;
  dataOriginId: string;
  name: string;
  brand: string | null;
  upc: string | null;
  offMarket: boolean;
  label: unknown;
};

export type ProductLabelDetail = ProductLabelSearchItem;

export type ProductLabelsQueries = {
  getById: (input: {
    id: string;
    includeOffMarket: boolean;
  }) => Promise<ProductLabelDetail | null>;
  getByUpc: (input: {
    includeOffMarket: boolean;
    upc: string;
  }) => Promise<ProductLabelDetail | null>;
  search: (input: {
    includeOffMarket: boolean;
    limit: number;
    q: string;
  }) => Promise<ProductLabelSearchItem[]>;
};

export function createProductLabelsQueries(
  client: ProductLabelsQueryClient,
  table: ProductLabelsTable,
  options: { brandScoping?: boolean } = {},
): ProductLabelsQueries {
  const tableSql = productLabelsTableSql(table);
  // Brand scoping preloads every distinct brand into memory and narrows
  // matching queries to those brands exclusively. That is correct for the
  // supplement catalog but disabled by default: on the ~2M-row foods table the
  // brand preload is an unbounded cold-start cost, and exclusive scoping would
  // hide generic rows (brand IS NULL) whenever a query collides with a brand
  // name.
  const brandScoping = options.brandScoping ?? false;
  let brandIndexCache: ProductLabelBrandIndexCache | null = null;

  async function getBrandIndex(): Promise<ProductLabelBrandIndexEntry[]> {
    const now = Date.now();

    if (!brandIndexCache || brandIndexCache.expiresAt <= now) {
      brandIndexCache = {
        expiresAt: now + PRODUCT_LABEL_BRAND_INDEX_TTL_MS,
        promise: loadProductLabelBrandIndex(client, tableSql),
      };
    }

    const promise = brandIndexCache.promise;

    try {
      return await promise;
    } catch (error) {
      if (brandIndexCache?.promise === promise) {
        brandIndexCache = null;
      }
      throw error;
    }
  }

  return {
    async getById(input) {
      const id = input.id.trim();

      if (!isProductLabelLookupId(id)) {
        return null;
      }

      const { rows } = await client.query<ProductLabelDetail>(
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
        FROM ${tableSql}
        WHERE
          id = $1
          AND ($2::boolean OR off_market = false)
        LIMIT 1
        `,
        [id, input.includeOffMarket],
      );

      return rows[0] ?? null;
    },

    async getByUpc(input) {
      const normalizedUpc = input.upc.replace(/\D/gu, "");
      const upcVariants = buildUpcLookupVariants(normalizedUpc);

      if (upcVariants.length === 0) {
        return null;
      }

      const { rows } = await client.query<ProductLabelDetail>(
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
        FROM ${tableSql}
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

    async search(input) {
      const q = input.q.trim();

      if (!q) {
        return [];
      }

      if (brandScoping) {
        const brandScopes = findProductLabelBrandScopes(await getBrandIndex(), q);

        if (brandScopes.length > 0) {
          return await searchBrandScopedProductLabels(client, tableSql, {
            ...input,
            q,
            brandScopes,
          });
        }
      }

      return await searchGenericProductLabels(client, tableSql, {
        ...input,
        q,
      });
    },
  };
}

function productLabelsTableSql(
  table: ProductLabelsTable,
): ProductLabelsTableSql {
  switch (table) {
    case "supplements":
      return PRODUCT_LABELS_TABLE_SQL.supplements;
    case "foods":
      return PRODUCT_LABELS_TABLE_SQL.foods;
    default:
      throw new Error("unsupported product labels table");
  }
}

async function searchGenericProductLabels(
  client: ProductLabelsQueryClient,
  tableSql: ProductLabelsTableSql,
  input: {
    includeOffMarket: boolean;
    limit: number;
    q: string;
  },
): Promise<ProductLabelSearchItem[]> {
  const { rows } = await client.query<ProductLabelSearchItem>(
    `
        WITH query AS (
          SELECT
            $1::text AS raw_q,
            websearch_to_tsquery('simple', $1) AS tsq
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
            label,
            ts_rank_cd(to_tsvector('simple', search_text), query.tsq) AS search_rank,
            strict_word_similarity(name, query.raw_q) AS name_similarity,
            CASE
              WHEN strpos(lower(query.raw_q), lower(name)) > 0 THEN 1
              ELSE 0
            END AS name_phrase_match,
            CASE
              WHEN strpos(lower(query.raw_q), lower(name)) > 0 THEN char_length(name)
              ELSE 0
            END AS name_phrase_length,
            data_origin_priority,
            row_number() OVER (
              PARTITION BY canonical_key
              ORDER BY
                CASE
                  WHEN strpos(lower(query.raw_q), lower(name)) > 0 THEN 1
                  ELSE 0
                END DESC,
                CASE
                  WHEN strpos(lower(query.raw_q), lower(name)) > 0 THEN char_length(name)
                  ELSE 0
                END DESC,
                strict_word_similarity(name, query.raw_q) DESC,
                ts_rank_cd(to_tsvector('simple', search_text), query.tsq) DESC,
                off_market ASC,
                data_origin_priority ASC,
                name ASC,
                id ASC
            ) AS dedupe_rank
          FROM ${tableSql}, query
          WHERE
            (
              to_tsvector('simple', search_text) @@ query.tsq
              OR name % query.raw_q
            )
            AND ($2::boolean OR off_market = false)
        )
        SELECT
          id,
          "dataOrigin",
          "dataOriginId",
          name,
          brand,
          upc,
          "offMarket",
          label
        FROM ranked
        WHERE dedupe_rank = 1
        ORDER BY
          name_phrase_match DESC,
          name_phrase_length DESC,
          name_similarity DESC,
          search_rank DESC,
          data_origin_priority ASC,
          name ASC
        LIMIT $3
        `,
    [input.q, input.includeOffMarket, input.limit],
  );

  return rows;
}

async function searchBrandScopedProductLabels(
  client: ProductLabelsQueryClient,
  tableSql: ProductLabelsTableSql,
  input: {
    brandScopes: ProductLabelBrandIndexEntry[];
    includeOffMarket: boolean;
    limit: number;
    q: string;
  },
): Promise<ProductLabelSearchItem[]> {
  const { rows } = await client.query<ProductLabelSearchItem>(
    `
    WITH query AS (
      SELECT
        $1::text AS raw_q,
        btrim(regexp_replace(replace(lower($1::text), '''', ''), '[^a-z0-9]+', ' ', 'g')) AS normalized_q,
        websearch_to_tsquery('simple', $1) AS tsq
    ),
    brand_candidates AS MATERIALIZED (
      SELECT
        id,
        canonical_key,
        data_origin AS "dataOrigin",
        data_origin_id AS "dataOriginId",
        name,
        brand,
        upc,
        off_market AS "offMarket",
        label,
        data_origin_priority,
        search_text,
        btrim(regexp_replace(replace(lower(name), '''', ''), '[^a-z0-9]+', ' ', 'g')) AS normalized_name,
        btrim(regexp_replace(replace(lower(brand), '''', ''), '[^a-z0-9]+', ' ', 'g')) AS normalized_brand
      FROM ${tableSql}
      WHERE
        brand = ANY($4::text[])
        AND ($2::boolean OR off_market = false)
    ),
    scored AS (
      SELECT
        brand_candidates.*,
        query.raw_q,
        query.normalized_q,
        query.tsq,
        btrim(replace(' ' || normalized_q || ' ', ' ' || normalized_brand || ' ', ' ')) AS product_q
      FROM brand_candidates, query
    ),
    product_scored AS (
      SELECT
        *,
        CASE
          WHEN product_q = '' THEN ts_rank_cd(to_tsvector('simple', search_text), tsq)
          ELSE ts_rank_cd(to_tsvector('simple', search_text), websearch_to_tsquery('simple', product_q))
        END AS search_rank,
        CASE
          WHEN product_q = '' THEN strict_word_similarity(name, raw_q)
          ELSE strict_word_similarity(name, product_q)
        END AS name_similarity,
        CASE
          WHEN strpos(' ' || product_q || ' ', ' ' || normalized_name || ' ') > 0 THEN 1
          ELSE 0
        END AS name_phrase_match,
        CASE
          WHEN strpos(' ' || product_q || ' ', ' ' || normalized_name || ' ') > 0 THEN char_length(normalized_name)
          ELSE 0
        END AS name_phrase_length,
        CASE
          WHEN product_q = '' THEN 1
          WHEN strpos(normalized_name, product_q) > 0 THEN 1
          WHEN strpos(product_q, normalized_name) > 0 THEN 1
          WHEN strict_word_similarity(name, product_q) >= 0.55 THEN 1
          WHEN similarity(name, product_q) >= 0.30 THEN 1
          ELSE 0
        END AS product_identity_match
      FROM scored
    ),
    ranked AS (
      SELECT
        *,
        row_number() OVER (
          PARTITION BY canonical_key
          ORDER BY
            name_phrase_match DESC,
            name_phrase_length DESC,
            "offMarket" ASC,
            data_origin_priority ASC,
            name_similarity DESC,
            search_rank DESC,
            name ASC,
            id ASC
        ) AS dedupe_rank
      FROM product_scored
      WHERE product_identity_match = 1
    )
    SELECT
      id,
      "dataOrigin",
      "dataOriginId",
      name,
      brand,
      upc,
      "offMarket",
      label
    FROM ranked
    WHERE dedupe_rank = 1
    ORDER BY
      name_phrase_match DESC,
      name_phrase_length DESC,
      data_origin_priority ASC,
      name_similarity DESC,
      search_rank DESC,
      name ASC
    LIMIT $3
    `,
    [
      input.q,
      input.includeOffMarket,
      input.limit,
      input.brandScopes.map((scope) => scope.brand),
    ],
  );

  return rows;
}

async function loadProductLabelBrandIndex(
  client: ProductLabelsQueryClient,
  tableSql: ProductLabelsTableSql,
): Promise<ProductLabelBrandIndexEntry[]> {
  const { rows } = await client.query<{ brand: string | null }>(
    `
    SELECT brand
    FROM ${tableSql}
    WHERE brand IS NOT NULL AND brand <> ''
    GROUP BY brand
    `,
    [],
  );

  return rows.flatMap((row) => {
    const brand = row.brand ?? "";
    const normalizedBrand = normalizeProductLabelSearchPhrase(brand);

    if (!normalizedBrand) {
      return [];
    }

    return [
      {
        brand,
        normalizedBrand,
      },
    ];
  });
}

function findProductLabelBrandScopes(
  brandIndex: ProductLabelBrandIndexEntry[],
  q: string,
): ProductLabelBrandIndexEntry[] {
  const normalizedQ = normalizeProductLabelSearchPhrase(q);

  if (!normalizedQ) {
    return [];
  }

  const matches = brandIndex
    .filter((entry) => containsNormalizedPhrase(normalizedQ, entry.normalizedBrand))
    .sort(
      (left, right) =>
        right.normalizedBrand.length - left.normalizedBrand.length ||
        left.brand.localeCompare(right.brand),
    );

  const directScopes = matches.filter((entry) => {
    const isSingleWordBrand = !entry.normalizedBrand.includes(" ");

    if (
      isSingleWordBrand &&
      (normalizedQ === entry.normalizedBrand ||
        !containsNormalizedEdgePhrase(normalizedQ, entry.normalizedBrand))
    ) {
      return false;
    }

    return (
      !isSingleWordBrand ||
      !matches.some(
        (other) =>
          other !== entry &&
          containsNormalizedPhrase(other.normalizedBrand, entry.normalizedBrand),
      )
    );
  });

  // Queries often name the parent brand while products are stored under a
  // sub-brand line (e.g. "Garden of Life Organics ..." rows live under
  // "Garden of Life MyKind Organics"). Scope those lines in too, preferring
  // lines whose extra words overlap the query.
  const queryTokens = new Set(normalizedQ.split(" "));
  const scopedBrands = new Set(directScopes.map((entry) => entry.brand));
  const lineScopes = brandIndex
    .filter(
      (entry) =>
        !scopedBrands.has(entry.brand) &&
        directScopes.some((scope) =>
          entry.normalizedBrand.startsWith(`${scope.normalizedBrand} `),
        ),
    )
    .sort(
      (left, right) =>
        countQueryTokenOverlap(right, queryTokens) -
          countQueryTokenOverlap(left, queryTokens) ||
        left.normalizedBrand.length - right.normalizedBrand.length ||
        left.brand.localeCompare(right.brand),
    );

  return [...directScopes, ...lineScopes].slice(
    0,
    MAX_PRODUCT_LABEL_BRAND_SCOPES,
  );
}

function countQueryTokenOverlap(
  entry: ProductLabelBrandIndexEntry,
  queryTokens: Set<string>,
): number {
  let count = 0;

  for (const token of entry.normalizedBrand.split(" ")) {
    if (queryTokens.has(token)) {
      count += 1;
    }
  }

  return count;
}

function containsNormalizedPhrase(haystack: string, needle: string): boolean {
  return needle.length > 0 && ` ${haystack} `.includes(` ${needle} `);
}

function containsNormalizedEdgePhrase(haystack: string, needle: string): boolean {
  return (
    needle.length > 0 &&
    (haystack.startsWith(`${needle} `) || haystack.endsWith(` ${needle}`))
  );
}

function normalizeProductLabelSearchPhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/'/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function isProductLabelLookupId(id: string): boolean {
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
  } else if (/^0\d{13}$/u.test(upc)) {
    variants.push(upc.slice(1));
  }

  return [...new Set(variants)];
}

export function getDefaultProductLabelsPool(): PgPool {
  defaultLabelsPool ??= createProductLabelsPool(requireLabelsDatabaseUrl());

  return defaultLabelsPool;
}

export function getDefaultSupplementProductLabelsPool(): PgPool {
  const labelsDatabaseUrl = process.env[LABELS_DATABASE_ENV]?.trim();

  if (labelsDatabaseUrl) {
    return getDefaultProductLabelsPool();
  }

  defaultLegacySupplementPool ??= createProductLabelsPool(
    requireLegacySupplementDatabaseUrl(),
  );

  return defaultLegacySupplementPool;
}

function requireLabelsDatabaseUrl(): string {
  const databaseUrl = process.env[LABELS_DATABASE_ENV]?.trim();

  if (!databaseUrl) {
    throw new Error(`${LABELS_DATABASE_ENV} is required`);
  }

  return databaseUrl;
}

function requireLegacySupplementDatabaseUrl(): string {
  const databaseUrl = process.env[LEGACY_SUPPLEMENT_DATABASE_ENV]?.trim();

  if (!databaseUrl) {
    throw new Error(
      `${LABELS_DATABASE_ENV} or ${LEGACY_SUPPLEMENT_DATABASE_ENV} is required`,
    );
  }

  return databaseUrl;
}

function createProductLabelsPool(databaseUrl: string): PgPool {
  return new Pool({
    connectionString: normalizeProductLabelsConnectionString(databaseUrl),
    max: DEFAULT_POOL_MAX,
    statement_timeout: DEFAULT_POOL_STATEMENT_TIMEOUT_MS,
  });
}

export function normalizeProductLabelsConnectionString(
  databaseUrl: string,
): string {
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
