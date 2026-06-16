#!/usr/bin/env node

import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const BRAND_SITE_ORIGIN = "brand_site";
const BRAND_SITE_PRIORITY = 5;
const RESERVED_DATA_ORIGINS = new Set([BRAND_SITE_ORIGIN, "dailymed", "dsld"]);
const SEARCH_TEXT_MAX_LENGTH = 6000;
const BODY_TEXT_MAX_LENGTH = 1200;
const INGREDIENT_TEXT_MAX_LENGTH = 1200;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { input: null, limit: 25, deleteOrigin: null };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--input") {
      const value = rest[index + 1];
      if (!value) throw new Error("--input requires a value");
      options.input = value;
      index += 1;
    } else if (arg === "--limit") {
      const value = Number.parseInt(rest[index + 1] ?? "", 10);
      if (!Number.isInteger(value) || value < 1) throw new Error("--limit requires a positive integer");
      options.limit = value;
      index += 1;
    } else if (arg === "--delete-origin") {
      const value = rest[index + 1];
      if (!value) throw new Error("--delete-origin requires a value");
      if (!/^[a-z][a-z0-9_]*$/u.test(value)) {
        throw new Error("--delete-origin must match ^[a-z][a-z0-9_]*$");
      }
      if (RESERVED_DATA_ORIGINS.has(value)) {
        throw new Error(`--delete-origin cannot be reserved origin ${value}`);
      }
      options.deleteOrigin = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!command || !["inspect", "dry-run", "upsert"].includes(command)) {
    printHelp();
    process.exit(command ? 1 : 0);
  }

  return { command, options };
}

function printHelp() {
  console.log(`Usage: node scripts/supplement-db-brand-site-labels.mjs <command> [options]

Commands:
  inspect                    Print supplement DB table/column/index summary.
  dry-run                    Load a label batch and report duplicate/match outcomes without writing.
  upsert                     Upsert the label batch into supplements as data_origin=brand_site.

Options:
  --input <file>             JSON batch file. Use "-" for stdin. Required for dry-run/upsert.
  --limit <n>                Number of preview rows for dry-run. Default: 25.
  --delete-origin <origin>   Delete stale rows for another data_origin in the same upsert transaction.

The script reads MURPH_SUPPLEMENT_DB_URL, falling back to MURPH_LABELS_DB_URL,
from the environment or from .env.local, but it never prints the URL.
`);
}

function findEnvFile() {
  let current = process.cwd();
  while (true) {
    const candidate = join(current, ".env.local");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function parseEnvValue(line, key) {
  if (!line.startsWith(`${key}=`)) return null;
  let value = line.slice(key.length + 1).trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value;
}

function getDbUrl() {
  if (process.env.MURPH_SUPPLEMENT_DB_URL) return process.env.MURPH_SUPPLEMENT_DB_URL;
  if (process.env.MURPH_LABELS_DB_URL) return process.env.MURPH_LABELS_DB_URL;
  const envFile = findEnvFile();
  if (!envFile) throw new Error("MURPH_SUPPLEMENT_DB_URL or MURPH_LABELS_DB_URL is missing and .env.local was not found.");
  let supplementDbUrl = null;
  let labelsDbUrl = null;
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/u)) {
    supplementDbUrl ??= parseEnvValue(line, "MURPH_SUPPLEMENT_DB_URL");
    labelsDbUrl ??= parseEnvValue(line, "MURPH_LABELS_DB_URL");
  }
  if (supplementDbUrl) return supplementDbUrl;
  if (labelsDbUrl) return labelsDbUrl;
  throw new Error("MURPH_SUPPLEMENT_DB_URL or MURPH_LABELS_DB_URL is missing from the environment and .env.local.");
}

function buildPsqlConnection(dbUrl) {
  let parsed;
  try {
    parsed = new URL(dbUrl);
  } catch {
    throw new Error("database URL is not a valid Postgres URL.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("database URL must use postgres:// or postgresql://.");
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/u, ""));
  if (!parsed.hostname || !database || !parsed.username) {
    throw new Error("database URL must include host, database, and user.");
  }

  const host = parsed.hostname;
  const port = parsed.port || "5432";
  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const env = {
    PGHOST: host,
    PGPORT: port,
    PGDATABASE: database,
    PGUSER: user,
  };
  const sslMode = parsed.searchParams.get("sslmode");
  if (sslMode) env.PGSSLMODE = sslMode;
  const sslRootCert = parsed.searchParams.get("sslrootcert");
  if (sslRootCert === "system") {
    const rootCertPath = systemRootCertPath();
    if (rootCertPath) env.PGSSLROOTCERT = rootCertPath;
  } else if (sslRootCert) {
    env.PGSSLROOTCERT = sslRootCert;
  }
  const sslCert = parsed.searchParams.get("sslcert");
  if (sslCert && sslCert !== "system") env.PGSSLCERT = sslCert;
  const sslKey = parsed.searchParams.get("sslkey");
  if (sslKey && sslKey !== "system") env.PGSSLKEY = sslKey;
  const connectTimeout = parsed.searchParams.get("connect_timeout");
  if (connectTimeout) env.PGCONNECT_TIMEOUT = connectTimeout;
  const applicationName = parsed.searchParams.get("application_name");
  if (applicationName) env.PGAPPNAME = applicationName;

  let tempDir = null;
  if (password) {
    tempDir = mkdtempSync(join(tmpdir(), "supplement-db-psql-"));
    const passfile = join(tempDir, "pgpass");
    writeFileSync(passfile, `${escapePgpass(host)}:${escapePgpass(port)}:${escapePgpass(database)}:${escapePgpass(user)}:${escapePgpass(password)}\n`, {
      mode: 0o600,
    });
    chmodSync(passfile, 0o600);
    env.PGPASSFILE = passfile;
  }

  return {
    env,
    redactions: [dbUrl, password, user].filter(Boolean),
    cleanup() {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function escapePgpass(value) {
  return String(value).replace(/\\/gu, "\\\\").replace(/:/gu, "\\:");
}

function systemRootCertPath() {
  const candidates = [
    "/etc/ssl/cert.pem",
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/ca-bundle.pem",
    "/opt/homebrew/etc/ca-certificates/cert.pem",
    "/opt/homebrew/etc/openssl@3/cert.pem",
    "/usr/local/etc/openssl@3/cert.pem",
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function childEnv(connectionEnv) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("PG")) delete env[key];
  }
  delete env.MURPH_SUPPLEMENT_DB_URL;
  delete env.MURPH_LABELS_DB_URL;
  return { ...env, ...connectionEnv };
}

function redactOutput(value, redactions) {
  let output = value;
  for (const redaction of redactions) {
    output = output.replaceAll(redaction, "<redacted>");
  }
  return output;
}

function runPsql(dbUrl, script) {
  const connection = buildPsqlConnection(dbUrl);
  let result;
  try {
    result = spawnSync("psql", [
      "-v",
      "ON_ERROR_STOP=1",
      "-P",
      "pager=off",
      "-F",
      "\t",
      "-A",
    ], {
      encoding: "utf8",
      env: childEnv(connection.env),
      input: script,
      maxBuffer: 20 * 1024 * 1024,
    });
  } finally {
    connection.cleanup();
  }

  if (result.status !== 0) {
    const stderr = redactOutput(result.stderr, connection.redactions);
    const stdout = redactOutput(result.stdout, connection.redactions);
    const spawnError = result.error instanceof Error ? redactOutput(result.error.message, connection.redactions) : "";
    throw new Error([stdout, stderr, spawnError].filter(Boolean).join("\n").trim() || `psql exited ${result.status}`);
  }

  return result.stdout;
}

function readJsonInput(inputPath) {
  if (!inputPath) throw new Error("--input is required for dry-run/upsert");
  const text = inputPath === "-"
    ? readFileSync(0, "utf8")
    : readFileSync(inputPath, "utf8");
  const parsed = JSON.parse(text);
  const items = Array.isArray(parsed) ? parsed : parsed.items;
  if (!Array.isArray(items)) throw new Error("Input JSON must be an array or an object with an items array.");
  return items.map(normalizeItem);
}

function assertUniqueOriginRows(items) {
  const seen = new Set();
  const duplicates = new Set();
  for (const item of items) {
    const key = `${item.dataOrigin}\t${item.dataOriginId}`;
    if (seen.has(key)) duplicates.add(`${item.dataOrigin}/${item.dataOriginId}`);
    seen.add(key);
  }
  if (duplicates.size > 0) {
    throw new Error(`Input contains duplicate brand_site rows: ${[...duplicates].sort().join(", ")}`);
  }
}

function validateDeleteOrigin(deleteOrigin, items) {
  if (!deleteOrigin) return;
  if (RESERVED_DATA_ORIGINS.has(deleteOrigin)) {
    throw new Error(`--delete-origin cannot be reserved origin ${deleteOrigin}`);
  }
  const sourceOrigins = new Set(items.map((item) => item.source.replaceAll("-", "_")));
  if (sourceOrigins.size !== 1) {
    throw new Error("--delete-origin requires a batch with exactly one source.");
  }
  const [sourceOrigin] = sourceOrigins;
  if (deleteOrigin !== sourceOrigin) {
    throw new Error(`--delete-origin ${deleteOrigin} must match input source ${sourceOrigin}`);
  }
}

function normalizeItem(item) {
  const source = requireString(item.source, "source");
  const sourceId = requireString(item.sourceId ?? item.source_id, "sourceId");
  if (!/^[a-z][a-z0-9_-]*$/u.test(source)) {
    throw new Error(`Invalid source slug ${source}. Expected ^[a-z][a-z0-9_-]*$`);
  }
  const dataOrigin = nullableString(item.dataOrigin ?? item.data_origin) ?? BRAND_SITE_ORIGIN;
  if (dataOrigin !== BRAND_SITE_ORIGIN) {
    throw new Error(`Brand web rows must use data_origin=${BRAND_SITE_ORIGIN}`);
  }
  const dataOriginId = requireString(
    item.dataOriginId ?? item.data_origin_id ?? `${source}:${sourceId}`,
    "dataOriginId",
  );
  const id = requireString(item.id ?? dataOriginId, "id");
  if (id !== dataOriginId) {
    throw new Error(`Brand-site row id must equal dataOriginId for ${dataOriginId}`);
  }
  if (!dataOriginId.startsWith(`${source}:`)) {
    throw new Error(`dataOriginId must start with ${source}: for brand-site rows`);
  }
  const name = requireString(item.name, "name");
  const label = item.label && typeof item.label === "object" ? item.label : item;
  const brand = nullableString(item.brand);
  const upc = nullableUpc(item.upc);
  const dataOriginUrl = nullableString(item.dataOriginUrl ?? item.data_origin_url ?? item.sourceUrl ?? item.source_url ?? label.sourceUrl ?? label.source_url);
  const offMarket = Boolean(item.offMarket ?? item.off_market ?? false);
  const searchText = buildSearchText({
    source,
    sourceId,
    dataOrigin,
    dataOriginId,
    name,
    brand,
    upc,
    dataOriginUrl,
    label,
  });
  const reviewIssues = findProductionReviewIssues({
    sourceId,
    dataOriginId,
    dataOriginUrl,
    name,
    searchText,
    label,
  });

  return {
    id,
    source,
    sourceId,
    dataOrigin,
    dataOriginId,
    dataOriginPriority: BRAND_SITE_PRIORITY,
    name,
    brand,
    upc,
    offMarket,
    searchText,
    label,
    dataOriginUrl,
    reviewIssues,
  };
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required field ${field}`);
  }
  return value.trim();
}

function nullableString(value) {
  if (value === null || value === undefined) return null;
  const stringValue = String(value).trim();
  return stringValue === "" ? null : stringValue;
}

function nullableUpc(value) {
  const stringValue = nullableString(value);
  if (!stringValue) return null;
  const digits = stringValue.replace(/\D/gu, "");
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}

function buildSearchText(item) {
  const parts = [];
  appendSearchValue(parts, item.name);
  appendSearchValue(parts, item.brand);
  appendSearchValue(parts, item.upc);

  const label = item.label && typeof item.label === "object" ? item.label : {};
  appendIngredientNames(parts, label.ingredientRows);
  appendIngredientNames(parts, label.otherIngredients);
  appendIngredientNames(parts, label.otheringredients?.ingredients);
  appendVariantSummary(parts, label.variant);

  return compactSearchText(parts.join(" "));
}

function compactSearchText(value) {
  return String(value)
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, SEARCH_TEXT_MAX_LENGTH);
}

function appendSearchValue(parts, value, maxLength = 240) {
  if (value === null || value === undefined) return;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value).trim();
    if (text) parts.push(text.slice(0, maxLength));
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 80)) {
      appendSearchValue(parts, entry, maxLength);
    }
    return;
  }
  if (typeof value === "object") {
    for (const key of ["name", "title", "sku", "barcode", "upc"]) {
      appendSearchValue(parts, value[key], maxLength);
    }
  }
}

const RAW_INGREDIENT_TEXT_LABEL_PATTERN = /^\s*(?:other\s+)?ingredients?\s*:\s*/iu;
const PARENTHETICAL_AMOUNT_PATTERN = /\s*\([^()]*\d[^()]*(?:mg|mcg|µg|ug|g|iu|ml|kcal|kj|cfu|%)[^()]*\)/giu;

function cleanRawIngredientText(value) {
  return String(value)
    .replace(RAW_INGREDIENT_TEXT_LABEL_PATTERN, "")
    .replace(PARENTHETICAL_AMOUNT_PATTERN, "")
    .replace(/\.\s*$/u, "");
}

function appendIngredientNames(parts, value) {
  if (value === null || value === undefined) return;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    appendSearchValue(parts, cleanRawIngredientText(value));
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 160)) {
      appendIngredientNames(parts, entry);
    }
    return;
  }

  if (typeof value === "object") {
    for (const key of ["name", "ingredient", "title"]) {
      appendSearchValue(parts, value[key]);
    }
    appendIngredientNames(parts, value.nestedRows);
    appendIngredientNames(parts, value.ingredients);
    appendIngredientNames(parts, value.children);
  }
}

function appendVariantSummary(parts, variant) {
  if (!variant || typeof variant !== "object" || Array.isArray(variant)) return;
  for (const key of ["title", "name", "sku", "barcode", "upc"]) {
    // Shopify's placeholder variant title is noise, not identity.
    if ((key === "title" || key === "name") && String(variant[key] ?? "").trim().toLowerCase() === "default title") continue;
    appendSearchValue(parts, variant[key]);
  }
}

function findProductionReviewIssues(item) {
  const issues = [];
  const label = item.label && typeof item.label === "object" ? item.label : {};
  if (!hasNonEmptyArray(label.ingredientRows)) issues.push("missing_ingredient_rows");
  if (!hasNonEmptyArray(label.servingSizes)) issues.push("missing_serving_sizes");
  if (label.needsManualReview === true) issues.push("needs_manual_review");
  if (isLikelyNonStandaloneProduct(item, label)) issues.push("non_standalone_product");
  if (isLikelyFoodOrNonSupplement(item, label)) issues.push("likely_food_or_non_supplement");
  if (typeof label.bodyText === "string" && label.bodyText.trim().length > BODY_TEXT_MAX_LENGTH) {
    issues.push("page_body_text_too_large");
  }
  if (typeof label.rawPageText === "string" && label.rawPageText.trim().length > 0) {
    issues.push("raw_page_text_present");
  }
  if (item.searchText.length > SEARCH_TEXT_MAX_LENGTH) issues.push("search_text_too_large");
  return issues;
}

function hasNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function isLikelyNonStandaloneProduct(item, label) {
  const haystack = [
    item.sourceId,
    item.dataOriginId,
    item.dataOriginUrl,
    item.name,
    label.productType,
    label.productKind,
    label.classification,
    label.itemType,
    Array.isArray(label.tags) ? label.tags.join(" ") : label.tags,
  ].filter(Boolean).join(" ").toLowerCase();
  return /\b(bundle|kit|regimen|combo pack|variety pack|support plan|supplement plan|multi[-\s]?pack)\b/u.test(haystack)
    || /\b(sample|promo)\b/u.test(haystack)
    || /\b[2-9]\s*[- ]?\s*pack\b/u.test(haystack)
    || /\b[2-9]\s+(?:bottles?|jars?|containers?|boxes?)\b/u.test(haystack);
}

function isLikelyFoodOrNonSupplement(item, label) {
  const haystack = [
    item.sourceId,
    item.dataOriginId,
    item.dataOriginUrl,
    item.name,
    label.productType,
    label.productKind,
    label.classification,
    label.itemType,
    Array.isArray(label.tags) ? label.tags.join(" ") : label.tags,
  ].filter(Boolean).join(" ").toLowerCase();
  return /\b(?:snacks?|protein\s+bars?|nutrition\s+bars?|energy\s+bars?|meal\s+(?:replacement\s+)?bars?|ready[-\s]?to[-\s]?(?:eat|drink)|rtd\s+(?:drink|shake|beverage)|protein\s+cookies?|cookies?|brownies?|chips?|crisps?|candy|oil\s+spray|flavou?r\s+drops?|chunky\s+flavou?r|seed\s+mix|table[-\s]?top\s+sweeteners?|stevia\s+(?:powder|sweetener)|cacao\s+powder|cocoa\s+powder|breakfast\s+(?:mix|cereal|porridge)|(?:protein\s+)?oatmeal(?:\s+\d|\s*[-–]\s*\d|\s*$)|muesli|granola)\b/u.test(haystack);
}

function assertProductionReady(items) {
  const blocked = items.filter((item) => item.reviewIssues.length > 0);
  if (blocked.length === 0) return;
  const preview = blocked.slice(0, 12)
    .map((item) => `${item.dataOriginId} [${item.reviewIssues.join(", ")}]`)
    .join("; ");
  const suffix = blocked.length > 12 ? `; ... ${blocked.length - 12} more` : "";
  throw new Error(`Production upsert blocked for ${blocked.length} brand_site row(s): ${preview}${suffix}`);
}

function copyField(value) {
  if (value === null || value === undefined) return "\\N";
  return String(value)
    .replace(/\\/gu, "\\\\")
    .replace(/\t/gu, "\\t")
    .replace(/\n/gu, "\\n")
    .replace(/\r/gu, "\\r");
}

function copyRows(items) {
  return items.map((item) => [
    item.id,
    item.dataOrigin,
    item.dataOriginId,
    item.dataOriginUrl,
    item.dataOriginPriority,
    item.name,
    item.brand,
    item.upc,
    item.offMarket ? "true" : "false",
    item.searchText,
    JSON.stringify(item.label),
    JSON.stringify(item.reviewIssues),
  ].map(copyField).join("\t")).join("\n");
}

function loadInputSql(items) {
  return `create temp table input_labels (
  id text not null,
  data_origin text not null,
  data_origin_id text not null,
  data_origin_url text,
  data_origin_priority smallint not null,
  name text not null,
  brand text,
  upc text,
  off_market boolean not null,
  search_text text not null,
  label jsonb not null,
  review_issues jsonb not null
);
copy input_labels from stdin;
${copyRows(items)}
\\.
`;
}

function preparedLabelsSql() {
  return `create temp table prepared_labels as
  select i.*, coalesce(dsld.canonical_key, i.id) as canonical_key, dsld.canonical_key as dsld_canonical_key,
    e.data_origin_id is not null as existing
  from input_labels i
  left join lateral (
    select s.canonical_key
    from supplements s
    where s.data_origin = 'dsld'
      and i.upc is not null
      and s.upc = i.upc
    order by s.imported_at desc, s.id
    limit 1
  ) dsld on true
  left join supplements e on e.id = i.id;`;
}

function inspectSql() {
  return `
select table_schema || '.' || table_name as table_name
from information_schema.tables
where table_schema not in ('pg_catalog','information_schema')
  and table_type = 'BASE TABLE'
order by table_schema, table_name;

select table_name, ordinal_position, column_name, data_type, is_nullable, coalesce(column_default, '') as column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('supplements', 'supplement_external_labels_legacy', 'supplements_dsld_legacy')
order by table_name, ordinal_position;

select conrelid::regclass::text as table_name, conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace = 'public'::regnamespace
order by conrelid::regclass::text, conname;

select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;

select data_origin, count(*) as rows, count(upc) as upc_rows, min(imported_at)::date as oldest_imported, max(imported_at)::date as newest_imported
from supplements
group by data_origin
order by data_origin;

select split_part(data_origin_id, ':', 1) as brand_slug, count(*) as rows
from supplements
where data_origin = 'brand_site'
group by brand_slug
order by brand_slug;
`;
}

function dryRunSql(items, limit) {
  return `${loadInputSql(items)}
${preparedLabelsSql()}

select jsonb_pretty(jsonb_build_object(
  'dataOrigin', '${BRAND_SITE_ORIGIN}',
  'inputRows', count(*),
  'distinctOriginRows', count(distinct (data_origin, data_origin_id)),
  'existingRows', count(*) filter (where existing),
  'newRows', count(*) filter (where not existing),
  'dsldCanonicalMatchedRows', count(*) filter (where dsld_canonical_key is not null),
  'missingUpcRows', count(*) filter (where upc is null),
  'duplicateInputRows', count(*) - count(distinct (data_origin, data_origin_id)),
  'productionBlockedRows', count(*) filter (where jsonb_array_length(review_issues) > 0),
  'missingIngredientRows', count(*) filter (where review_issues ? 'missing_ingredient_rows'),
  'missingServingSizes', count(*) filter (where review_issues ? 'missing_serving_sizes'),
  'nonStandaloneRows', count(*) filter (where review_issues ? 'non_standalone_product'),
  'pageBodyRows', count(*) filter (where review_issues ? 'page_body_text_too_large' or review_issues ? 'raw_page_text_present'),
  'manualReviewRows', count(*) filter (where review_issues ? 'needs_manual_review'),
  'oversizedSearchTextRows', count(*) filter (where review_issues ? 'search_text_too_large')
)) as summary
from prepared_labels;

select data_origin, data_origin_id, name, coalesce(upc, '') as upc, canonical_key,
  review_issues::text as review_issues,
  case when existing then 'update' else 'insert' end as action
from prepared_labels
order by data_origin, data_origin_id
limit ${Number(limit)};
`;
}

function upsertSql(items, deleteOrigin) {
  const cleanupSql = deleteOrigin
    ? `delete from supplements where data_origin = '${deleteOrigin}';`
    : "";
  return `begin;
${loadInputSql(items)}
${cleanupSql}
${preparedLabelsSql()}

with upserted as (
  insert into supplements (
    id,
    canonical_key,
    data_origin,
    data_origin_id,
    data_origin_url,
    data_origin_priority,
    name,
    brand,
    upc,
    off_market,
    search_text,
    label,
    imported_at
  )
  select
    id,
    canonical_key,
    data_origin,
    data_origin_id,
    data_origin_url,
    data_origin_priority,
    name,
    brand,
    upc,
    off_market,
    search_text,
    label,
    now()
  from prepared_labels
  on conflict (id) do update set
    id = excluded.id,
    canonical_key = excluded.canonical_key,
    data_origin = excluded.data_origin,
    data_origin_id = excluded.data_origin_id,
    data_origin_url = excluded.data_origin_url,
    data_origin_priority = excluded.data_origin_priority,
    name = excluded.name,
    brand = excluded.brand,
    upc = excluded.upc,
    off_market = excluded.off_market,
    search_text = excluded.search_text,
    label = excluded.label,
    imported_at = excluded.imported_at
  returning data_origin, data_origin_id, canonical_key
)
select jsonb_pretty(jsonb_build_object(
  'dataOrigin', '${BRAND_SITE_ORIGIN}',
  'deletedOrigin', ${deleteOrigin ? `'${deleteOrigin}'` : "null"},
  'upsertedRows', count(*),
  'dsldCanonicalMatchedRows', count(*) filter (where canonical_key like 'dsld:%')
)) as summary
from upserted;
commit;
`;
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const dbUrl = getDbUrl();
  if (command === "inspect") {
    process.stdout.write(runPsql(dbUrl, inspectSql()));
  } else {
    const items = readJsonInput(options.input);
    if (items.length === 0) throw new Error("Input contains no label rows.");
    assertUniqueOriginRows(items);
    if (command === "upsert") {
      validateDeleteOrigin(options.deleteOrigin, items);
      assertProductionReady(items);
    }
    const sql = command === "dry-run" ? dryRunSql(items, options.limit) : upsertSql(items, options.deleteOrigin);
    process.stdout.write(runPsql(dbUrl, sql));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export {
  BODY_TEXT_MAX_LENGTH,
  INGREDIENT_TEXT_MAX_LENGTH,
  SEARCH_TEXT_MAX_LENGTH,
  assertProductionReady,
  buildSearchText,
  findProductionReviewIssues,
  getDbUrl,
  normalizeItem,
  runPsql,
};
