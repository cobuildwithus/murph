#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import {
  SEARCH_TEXT_MAX_LENGTH,
  getDbUrl,
  runPsql,
} from "./supplement-db-brand-site-labels.mjs";

const DEFAULT_STATEMENT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CANDIDATE_IDS = 500;

const REQUIRED_COLUMNS = [
  [1, "id", "text", true, false],
  [2, "canonical_key", "text", true, false],
  [3, "data_origin", "text", true, false],
  [4, "data_origin_id", "text", true, false],
  [5, "data_origin_url", "text", false, false],
  [6, "data_origin_priority", "smallint", true, true],
  [7, "name", "text", true, false],
  [8, "brand", "text", false, false],
  [9, "upc", "text", false, false],
  [10, "off_market", "boolean", true, true],
  [11, "search_text", "text", true, false],
  [12, "label", "jsonb", true, false],
  [13, "serving_grams", "numeric", false, false],
  [14, "imported_at", "timestamp with time zone", true, true],
];

const REQUIRED_CONSTRAINTS = [
  [1, "supplements_pkey", "primary_key"],
  [2, "supplements_data_origin_data_origin_id_key", "origin_identity_unique"],
  [3, "supplements_id_check", "id_nonblank"],
  [4, "supplements_canonical_key_check", "canonical_key_nonblank"],
  [5, "supplements_data_origin_check", "data_origin_format"],
  [6, "supplements_data_origin_id_check", "data_origin_id_nonblank"],
  [7, "supplements_data_origin_priority_check", "priority_nonnegative"],
  [8, "supplements_payload_format_check", "payload_format"],
  [9, "supplements_serving_grams_check", "serving_grams_positive"],
];

const REQUIRED_INDEXES = [
  [1, "supplements_search_idx", "simple_full_text"],
  [2, "supplements_search_english_idx", "english_full_text"],
  [3, "supplements_name_trgm_idx", "name_trigram"],
  [4, "supplements_brand_idx", "brand_lookup"],
  [5, "supplements_upc_idx", "upc_lookup"],
  [6, "supplements_canonical_key_idx", "canonical_key_lookup"],
];

function parseArgs(argv) {
  const options = {
    candidateLimit: 0,
    statementTimeoutMs: DEFAULT_STATEMENT_TIMEOUT_MS,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--candidate-limit") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isInteger(value) || value < 1 || value > MAX_CANDIDATE_IDS) {
        throw new Error(`--candidate-limit requires an integer from 1 to ${MAX_CANDIDATE_IDS}`);
      }
      options.candidateLimit = value;
      index += 1;
    } else if (arg === "--statement-timeout-ms") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isInteger(value) || value < 1000 || value > DEFAULT_STATEMENT_TIMEOUT_MS) {
        throw new Error(`--statement-timeout-ms requires an integer from 1000 to ${DEFAULT_STATEMENT_TIMEOUT_MS}`);
      }
      options.statementTimeoutMs = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node .agents/skills/research-supplements/scripts/supplement-db-audit.mjs [options]

Run a deterministic, whole-table audit of the supplements database and print a
stable JSON summary. The audit uses PostgreSQL READ ONLY transactions, executes
no DDL or DML, and never prints the database URL or raw label payloads.

Options:
  --candidate-limit <n>       Include at most n selected drilldown issue/id pairs (1-${MAX_CANDIDATE_IDS}).
                              Aggregate classifications remain comprehensive;
                              candidate IDs are a bounded subset and omitted by default.
  --statement-timeout-ms <n>  Per-query timeout from 1000-${DEFAULT_STATEMENT_TIMEOUT_MS}.
                              Default: ${DEFAULT_STATEMENT_TIMEOUT_MS}.
  -h, --help                  Show this help.

MURPH_LABELS_DB_URL is read through the existing secret-safe database helper.
This command is read-only and never changes database state.
`);
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function valuesSql(rows) {
  return rows
    .map((row) => `(${row.map((value) => typeof value === "string" ? sqlLiteral(value) : String(value)).join(", ")})`)
    .join(",\n    ");
}

function readOnlySql(body, statementTimeoutMs) {
  return `
begin transaction read only;
set local statement_timeout = ${sqlLiteral(`${statementTimeoutMs}ms`)};
${body.trim()}
rollback;
`;
}

function buildSchemaAuditSql(statementTimeoutMs = DEFAULT_STATEMENT_TIMEOUT_MS) {
  const columns = valuesSql(REQUIRED_COLUMNS);
  const constraints = valuesSql(REQUIRED_CONSTRAINTS);
  const indexes = valuesSql(REQUIRED_INDEXES);

  return readOnlySql(`
with
supplements_table as (
  select to_regclass('supplements') as relation_id
),
required_columns(ordinal, name, expected_type, expected_not_null, expected_has_default) as (
  values
    ${columns}
),
column_audit as (
  select
    required.ordinal,
    required.name,
    required.expected_type,
    required.expected_not_null,
    required.expected_has_default,
    attribute.attname is not null as present,
    format_type(attribute.atttypid, attribute.atttypmod) as actual_type,
    attribute.attnotnull as actual_not_null,
    attribute_default.adbin is not null as actual_has_default
  from required_columns required
  cross join supplements_table
  left join pg_attribute attribute
    on attribute.attrelid = supplements_table.relation_id
    and attribute.attname = required.name
    and attribute.attnum > 0
    and not attribute.attisdropped
  left join pg_attrdef attribute_default
    on attribute_default.adrelid = attribute.attrelid
    and attribute_default.adnum = attribute.attnum
),
required_constraints(ordinal, name, purpose) as (
  values
    ${constraints}
),
constraint_audit as (
  select
    required.ordinal,
    required.name,
    required.purpose,
    constraint_row.oid is not null as present,
    constraint_row.convalidated as validated,
    case constraint_row.contype
      when 'p' then 'primary_key'
      when 'u' then 'unique'
      when 'c' then 'check'
      when 'f' then 'foreign_key'
      else constraint_row.contype::text
    end as actual_type
  from required_constraints required
  cross join supplements_table
  left join pg_constraint constraint_row
    on constraint_row.conrelid = supplements_table.relation_id
    and constraint_row.conname = required.name
),
required_indexes(ordinal, name, purpose) as (
  values
    ${indexes}
),
index_audit as (
  select
    required.ordinal,
    required.name,
    required.purpose,
    index_row.indexrelid is not null as present,
    index_row.indisvalid as valid,
    index_row.indisready as ready
  from required_indexes required
  cross join supplements_table
  left join pg_class index_class
    on index_class.relname = required.name
    and index_class.relnamespace = coalesce(
      (select relnamespace from pg_class where oid = supplements_table.relation_id),
      current_schema()::regnamespace
    )
  left join pg_index index_row
    on index_row.indexrelid = index_class.oid
    and index_row.indrelid = supplements_table.relation_id
),
related_tables as (
  select
    to_regclass('product_tests') is not null as product_tests_present,
    exists (
      select 1
      from pg_attribute
      where attrelid = to_regclass('product_tests')
        and attname = 'supplement_id'
        and attnum > 0
        and not attisdropped
    ) as product_tests_supplement_id_present,
    exists (
      select 1
      from pg_constraint
      where conrelid = to_regclass('product_tests')
        and conname = 'product_tests_supplement_id_fkey'
        and contype = 'f'
    ) as product_tests_supplement_fk_present,
    exists (
      select 1
      from pg_class index_class
      join pg_index index_row on index_row.indexrelid = index_class.oid
      where index_row.indrelid = to_regclass('product_tests')
        and index_class.relname = 'product_tests_supplement_idx'
        and index_row.indisvalid
        and index_row.indisready
    ) as product_tests_supplement_index_present
)
select jsonb_build_object(
  'table', jsonb_build_object(
    'name', 'supplements',
    'present', (select relation_id is not null from supplements_table)
  ),
  'columns', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'name', name,
        'present', present,
        'expectedType', expected_type,
        'actualType', actual_type,
        'expectedNotNull', expected_not_null,
        'actualNotNull', actual_not_null,
        'expectedHasDefault', expected_has_default,
        'actualHasDefault', actual_has_default,
        'matchesExpected', present
          and actual_type = expected_type
          and actual_not_null = expected_not_null
          and actual_has_default = expected_has_default
      )
      order by ordinal
    )
    from column_audit
  ), '[]'::jsonb),
  'constraints', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'name', name,
        'purpose', purpose,
        'present', present,
        'validated', validated,
        'actualType', actual_type
      )
      order by ordinal
    )
    from constraint_audit
  ), '[]'::jsonb),
  'indexes', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'name', name,
        'purpose', purpose,
        'present', present,
        'valid', valid,
        'ready', ready
      )
      order by ordinal
    )
    from index_audit
  ), '[]'::jsonb),
  'relatedProductTests', (
    select to_jsonb(related_tables)
    from related_tables
  ),
  'dataAuditReady',
    (select relation_id is not null from supplements_table)
    and not exists (
      select 1
      from column_audit
      where not present
        or actual_type is distinct from expected_type
        or actual_not_null is distinct from expected_not_null
    )
)::text as audit;
`, statementTimeoutMs);
}

function productTestSummarySql(includeProductTests) {
  if (!includeProductTests) {
    return `
product_test_summary as (
  select
    'skipped_schema_missing'::text as status,
    null::bigint as linked_rows,
    null::bigint as orphan_supplement_references
)`;
  }

  return `
product_test_summary as (
  select
    'completed'::text as status,
    count(*) filter (where tests.supplement_id is not null) as linked_rows,
    count(*) filter (
      where tests.supplement_id is not null
        and supplements.id is null
    ) as orphan_supplement_references
  from product_tests tests
  left join supplements on supplements.id = tests.supplement_id
)`;
}

function buildDataAuditSql({
  includeProductTests = false,
  statementTimeoutMs = DEFAULT_STATEMENT_TIMEOUT_MS,
} = {}) {
  return readOnlySql(`
with
base as materialized (
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
    serving_grams,
    imported_at,
    lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')) as normalized_name,
    lower(regexp_replace(btrim(coalesce(brand, '')), '[[:space:]]+', ' ', 'g')) as normalized_brand,
    lower(btrim(coalesce(upc, ''))) as normalized_upc
  from supplements
),
origin_summary as (
  select
    data_origin,
    count(*) as row_count,
    count(*) filter (where off_market) as off_market_rows,
    count(*) filter (where brand is null) as null_brand_rows,
    count(*) filter (where upc is not null and btrim(upc) <> '') as populated_upc_rows,
    count(*) filter (where serving_grams is not null) as populated_serving_grams_rows,
    count(*) filter (
      where data_origin_priority is distinct from case data_origin
        when 'brand_site' then 5
        when 'dsld' then 10
        when 'dailymed' then 30
        else data_origin_priority
      end
    ) as unexpected_priority_rows
  from base
  group by data_origin
),
identity_summary as (
  select
    count(*) as total_rows,
    count(*) filter (where btrim(id) = '') as blank_id_rows,
    count(*) filter (where btrim(canonical_key) = '') as blank_canonical_key_rows,
    count(*) filter (where btrim(data_origin) = '') as blank_data_origin_rows,
    count(*) filter (where data_origin !~ '^[a-z][a-z0-9_]*$') as malformed_data_origin_rows,
    count(*) filter (where data_origin not in ('brand_site', 'dailymed', 'dsld')) as unexpected_origin_rows,
    count(*) filter (where btrim(data_origin_id) = '') as blank_data_origin_id_rows,
    count(*) filter (
      where data_origin = 'brand_site'
        and id <> data_origin_id
    ) as brand_site_id_origin_id_mismatch_rows,
    count(*) filter (
      where data_origin = 'brand_site'
        and position(':' in data_origin_id) = 0
    ) as brand_site_origin_id_without_source_rows,
    count(*) filter (
      where data_origin = 'dsld'
        and data_origin_id !~ '^[0-9]+$'
    ) as dsld_nonnumeric_origin_id_rows,
    count(*) filter (where btrim(name) = '') as blank_name_rows,
    count(*) filter (where brand is not null and btrim(brand) = '') as blank_brand_rows,
    count(*) filter (where upc is not null and btrim(upc) = '') as blank_upc_rows,
    count(*) filter (where data_origin_url is not null and btrim(data_origin_url) = '') as blank_data_origin_url_rows,
    count(*) filter (
      where data_origin_url is not null
        and btrim(data_origin_url) <> ''
        and data_origin_url !~* '^https?://'
    ) as non_http_data_origin_url_rows,
    count(*) filter (where data_origin_priority < 0) as negative_priority_rows,
    count(*) filter (where serving_grams is not null and serving_grams <= 0) as nonpositive_serving_grams_rows,
    count(*) filter (where jsonb_typeof(label) <> 'object') as non_object_label_rows
  from base
),
canonical_summary as (
  select
    count(*) filter (
      where row.canonical_key like 'dsld:%'
        and not exists (
          select 1
          from supplements target
          where target.data_origin = 'dsld'
            and target.data_origin_id = substring(row.canonical_key from 6)
        )
    ) as missing_dsld_canonical_target_rows,
    count(*) filter (
      where row.data_origin = 'brand_site'
        and nullif(btrim(row.upc), '') is null
        and row.canonical_key <> row.id
    ) as brand_site_no_upc_nonself_rows,
    count(*) filter (
      where row.data_origin = 'brand_site'
        and nullif(btrim(row.upc), '') is not null
        and row.canonical_key like 'dsld:%'
        and exists (
          select 1
          from supplements target
          where target.data_origin = 'dsld'
            and target.data_origin_id = substring(row.canonical_key from 6)
            and target.upc is distinct from row.upc
        )
    ) as brand_site_dsld_canonical_upc_mismatch_rows,
    count(*) filter (
      where row.data_origin = 'brand_site'
        and nullif(btrim(row.upc), '') is not null
        and exists (
          select 1
          from supplements target
          where target.data_origin = 'dsld'
            and target.upc = row.upc
        )
        and not exists (
          select 1
          from supplements target
          where target.data_origin = 'dsld'
            and target.upc = row.upc
            and target.canonical_key = row.canonical_key
        )
    ) as brand_site_exact_dsld_upc_not_canonicalized_rows
  from base row
),
label_array_summary as (
  select
    data_origin,
    count(*) as row_count,
    count(*) filter (where jsonb_typeof(label) = 'object') as object_label_rows,
    count(*) filter (
      where jsonb_typeof(label) = 'object'
        and (not (label ? 'ingredientRows') or jsonb_typeof(label->'ingredientRows') = 'null')
    ) as missing_ingredient_rows,
    count(*) filter (
      where jsonb_typeof(label) = 'object'
        and label ? 'ingredientRows'
        and jsonb_typeof(label->'ingredientRows') not in ('array', 'null')
    ) as nonarray_ingredient_rows,
    count(*) filter (
      where case
        when jsonb_typeof(label->'ingredientRows') = 'array'
        then jsonb_array_length(label->'ingredientRows') = 0
        else false
      end
    ) as empty_ingredient_rows,
    count(*) filter (
      where case
        when jsonb_typeof(label->'ingredientRows') = 'array'
        then jsonb_array_length(label->'ingredientRows') > 0
        else false
      end
    ) as populated_ingredient_rows,
    count(*) filter (
      where jsonb_typeof(label) = 'object'
        and (not (label ? 'servingSizes') or jsonb_typeof(label->'servingSizes') = 'null')
    ) as missing_serving_sizes,
    count(*) filter (
      where jsonb_typeof(label) = 'object'
        and label ? 'servingSizes'
        and jsonb_typeof(label->'servingSizes') not in ('array', 'null')
    ) as nonarray_serving_sizes,
    count(*) filter (
      where case
        when jsonb_typeof(label->'servingSizes') = 'array'
        then jsonb_array_length(label->'servingSizes') = 0
        else false
      end
    ) as empty_serving_sizes,
    count(*) filter (
      where case
        when jsonb_typeof(label->'servingSizes') = 'array'
        then jsonb_array_length(label->'servingSizes') > 0
        else false
      end
    ) as populated_serving_sizes
  from base
  group by data_origin
),
upc_distribution as (
  select
    data_origin,
    case
      when upc is null then 'null'
      when btrim(upc) = '' then 'blank'
      when upc ~ '^[0-9]+$' then 'digits'
      else 'non_digits'
    end as value_kind,
    case when upc ~ '^[0-9]+$' then char_length(upc) end as digit_length,
    count(*) as row_count
  from base
  group by
    data_origin,
    case
      when upc is null then 'null'
      when btrim(upc) = '' then 'blank'
      when upc ~ '^[0-9]+$' then 'digits'
      else 'non_digits'
    end,
    case when upc ~ '^[0-9]+$' then char_length(upc) end
),
search_summary as (
  select
    data_origin,
    count(*) filter (where btrim(search_text) = '') as blank_rows,
    count(*) filter (where char_length(search_text) > ${SEARCH_TEXT_MAX_LENGTH}) as oversized_rows,
    count(*) filter (
      where search_text <> regexp_replace(btrim(search_text), '[[:space:]]+', ' ', 'g')
    ) as noncompact_whitespace_rows,
    count(*) filter (
      where btrim(name) <> ''
        and strpos(lower(search_text), lower(btrim(name))) = 0
    ) as name_omitted_rows,
    count(*) filter (
      where brand is not null
        and btrim(brand) <> ''
        and strpos(lower(search_text), lower(btrim(brand))) = 0
    ) as brand_omitted_rows,
    count(*) filter (
      where upc is not null
        and btrim(upc) <> ''
        and strpos(lower(search_text), lower(btrim(upc))) = 0
    ) as upc_omitted_rows,
    max(char_length(search_text)) as max_length
  from base
  group by data_origin
),
exact_identity_duplicate_groups as (
  select
    data_origin,
    normalized_name,
    normalized_brand,
    normalized_upc,
    count(*) as group_size
  from base
  group by data_origin, normalized_name, normalized_brand, normalized_upc
  having count(*) > 1
),
exact_identity_duplicate_summary as (
  select
    data_origin,
    count(*) as group_count,
    sum(group_size) as candidate_row_count,
    sum(group_size - 1) as excess_row_count,
    max(group_size) as largest_group_size
  from exact_identity_duplicate_groups
  group by data_origin
),
upc_duplicate_groups as (
  select
    data_origin,
    normalized_upc,
    count(*) as group_size
  from base
  where normalized_upc <> ''
  group by data_origin, normalized_upc
  having count(*) > 1
),
upc_duplicate_summary as (
  select
    data_origin,
    count(*) as group_count,
    sum(group_size) as candidate_row_count,
    sum(group_size - 1) as excess_row_count,
    max(group_size) as largest_group_size
  from upc_duplicate_groups
  group by data_origin
),
brand_site_provenance as (
  select
    count(*) as row_count,
    count(*) filter (
      where not (label ? 'source')
        or jsonb_typeof(label->'source') = 'null'
        or (jsonb_typeof(label->'source') = 'string' and btrim(label->>'source') = '')
    ) as missing_source_rows,
    count(*) filter (
      where label ? 'source'
        and jsonb_typeof(label->'source') not in ('string', 'null')
    ) as wrong_type_source_rows,
    count(*) filter (
      where not (label ? 'sourceId')
        or jsonb_typeof(label->'sourceId') = 'null'
        or (jsonb_typeof(label->'sourceId') = 'string' and btrim(label->>'sourceId') = '')
    ) as missing_source_id_rows,
    count(*) filter (
      where label ? 'sourceId'
        and jsonb_typeof(label->'sourceId') not in ('string', 'null')
    ) as wrong_type_source_id_rows,
    count(*) filter (
      where not (label ? 'sourceFetchedAt')
        or jsonb_typeof(label->'sourceFetchedAt') = 'null'
        or (jsonb_typeof(label->'sourceFetchedAt') = 'string' and btrim(label->>'sourceFetchedAt') = '')
    ) as missing_source_fetched_at_rows,
    count(*) filter (
      where label ? 'sourceFetchedAt'
        and jsonb_typeof(label->'sourceFetchedAt') not in ('string', 'null')
    ) as wrong_type_source_fetched_at_rows,
    count(*) filter (
      where jsonb_typeof(label->'sourceFetchedAt') = 'string'
        and btrim(label->>'sourceFetchedAt') <> ''
        and not pg_input_is_valid(label->>'sourceFetchedAt', 'timestamptz')
    ) as invalid_source_fetched_at_rows,
    count(*) filter (
      where case
        when jsonb_typeof(label->'sourceFetchedAt') = 'string'
          and pg_input_is_valid(label->>'sourceFetchedAt', 'timestamptz')
        then (label->>'sourceFetchedAt')::timestamptz > transaction_timestamp() + interval '5 minutes'
        else false
      end
    ) as future_source_fetched_at_rows,
    count(*) filter (
      where not (label ? 'sourceUrl')
        or jsonb_typeof(label->'sourceUrl') = 'null'
        or (jsonb_typeof(label->'sourceUrl') = 'string' and btrim(label->>'sourceUrl') = '')
    ) as missing_source_url_rows,
    count(*) filter (
      where label ? 'sourceUrl'
        and jsonb_typeof(label->'sourceUrl') not in ('string', 'null')
    ) as wrong_type_source_url_rows,
    count(*) filter (
      where not (label ? 'schemaVersion') or jsonb_typeof(label->'schemaVersion') = 'null'
    ) as missing_schema_version_rows,
    count(*) filter (
      where label ? 'schemaVersion'
        and jsonb_typeof(label->'schemaVersion') not in ('number', 'null')
    ) as wrong_type_schema_version_rows,
    count(*) filter (
      where not (label ? 'evidenceStatus')
        or jsonb_typeof(label->'evidenceStatus') = 'null'
        or (jsonb_typeof(label->'evidenceStatus') = 'string' and btrim(label->>'evidenceStatus') = '')
    ) as missing_evidence_status_rows,
    count(*) filter (
      where label ? 'evidenceStatus'
        and jsonb_typeof(label->'evidenceStatus') not in ('string', 'null')
    ) as wrong_type_evidence_status_rows,
    count(*) filter (
      where label ? 'needsManualReview'
        and jsonb_typeof(label->'needsManualReview') not in ('boolean', 'null')
    ) as wrong_type_needs_manual_review_rows,
    count(*) filter (
      where jsonb_typeof(label->'source') = 'string'
        and btrim(label->>'source') <> ''
        and jsonb_typeof(label->'sourceId') = 'string'
        and btrim(label->>'sourceId') <> ''
        and data_origin_id <> (label->>'source') || ':' || (label->>'sourceId')
    ) as source_identity_mismatch_rows,
    count(*) filter (
      where data_origin_url is not null
        and btrim(data_origin_url) <> ''
        and jsonb_typeof(label->'sourceUrl') = 'string'
        and btrim(label->>'sourceUrl') <> ''
        and data_origin_url <> label->>'sourceUrl'
    ) as source_url_differs_from_data_origin_url_rows
  from base
  where data_origin = 'brand_site'
),
timestamp_summary as (
  select
    count(*) filter (
      where imported_at > transaction_timestamp() + interval '5 minutes'
    ) as future_imported_at_rows
  from base
),
${productTestSummarySql(includeProductTests)}
select jsonb_build_object(
  'status', 'completed',
  'totalRows', (select total_rows from identity_summary),
  'byOrigin', coalesce((
    select jsonb_agg(to_jsonb(origin_summary) order by data_origin)
    from origin_summary
  ), '[]'::jsonb),
  'identity', (select to_jsonb(identity_summary) - 'total_rows' from identity_summary),
  'canonical', (select to_jsonb(canonical_summary) from canonical_summary),
  'labelArrays', jsonb_build_object(
    'classification', 'per_origin_review_candidates_not_automatic_corruption_or_deletion',
    'byOrigin', coalesce((
      select jsonb_agg(to_jsonb(label_array_summary) order by data_origin)
      from label_array_summary
    ), '[]'::jsonb)
  ),
  'upcDistribution', jsonb_build_object(
    'classification', 'observed_values_only_no_gs1_width_assumption',
    'byOriginAndLength', coalesce((
      select jsonb_agg(
        to_jsonb(upc_distribution)
        order by data_origin, value_kind, digit_length nulls first
      )
      from upc_distribution
    ), '[]'::jsonb)
  ),
  'searchText', jsonb_build_object(
    'maxExpectedLength', ${SEARCH_TEXT_MAX_LENGTH},
    'byOrigin', coalesce((
      select jsonb_agg(to_jsonb(search_summary) order by data_origin)
      from search_summary
    ), '[]'::jsonb)
  ),
  'duplicateReviewCandidates', jsonb_build_object(
    'classification', 'review_candidates_not_deletion_candidates',
    'exactNormalizedIdentityByOrigin', coalesce((
      select jsonb_agg(to_jsonb(exact_identity_duplicate_summary) order by data_origin)
      from exact_identity_duplicate_summary
    ), '[]'::jsonb),
    'sameOriginExactUpcByOrigin', coalesce((
      select jsonb_agg(to_jsonb(upc_duplicate_summary) order by data_origin)
      from upc_duplicate_summary
    ), '[]'::jsonb)
  ),
  'brandSiteProvenance', (select to_jsonb(brand_site_provenance) from brand_site_provenance),
  'timestamps', (select to_jsonb(timestamp_summary) from timestamp_summary),
  'relatedProductTests', (select to_jsonb(product_test_summary) from product_test_summary)
)::text as audit;
`, statementTimeoutMs);
}

function buildCandidateAuditSql({
  candidateLimit,
  statementTimeoutMs = DEFAULT_STATEMENT_TIMEOUT_MS,
}) {
  if (!Number.isInteger(candidateLimit) || candidateLimit < 1 || candidateLimit > MAX_CANDIDATE_IDS) {
    throw new Error(`candidateLimit must be an integer from 1 to ${MAX_CANDIDATE_IDS}`);
  }

  return readOnlySql(`
with
base as materialized (
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
    search_text,
    label,
    serving_grams,
    imported_at,
    lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')) as normalized_name,
    lower(regexp_replace(btrim(coalesce(brand, '')), '[[:space:]]+', ' ', 'g')) as normalized_brand,
    lower(btrim(coalesce(upc, ''))) as normalized_upc
  from supplements
),
duplicate_identity_rows as (
  select id, data_origin
  from (
    select
      id,
      data_origin,
      count(*) over (
        partition by data_origin, normalized_name, normalized_brand, normalized_upc
      ) as group_size
    from base
  ) grouped
  where group_size > 1
),
duplicate_upc_rows as (
  select id, data_origin
  from (
    select
      id,
      data_origin,
      normalized_upc,
      count(*) over (partition by data_origin, normalized_upc) as group_size
    from base
    where normalized_upc <> ''
  ) grouped
  where group_size > 1
),
candidate_pairs as materialized (
  select 'blank_id'::text as issue, id, data_origin from base where btrim(id) = ''
  union all
  select 'blank_canonical_key', id, data_origin from base where btrim(canonical_key) = ''
  union all
  select 'blank_data_origin_id', id, data_origin from base where btrim(data_origin_id) = ''
  union all
  select 'blank_name'::text as issue, id, data_origin from base where btrim(name) = ''
  union all
  select 'blank_brand', id, data_origin from base where brand is not null and btrim(brand) = ''
  union all
  select 'blank_upc', id, data_origin from base where upc is not null and btrim(upc) = ''
  union all
  select 'malformed_data_origin', id, data_origin from base where data_origin !~ '^[a-z][a-z0-9_]*$'
  union all
  select 'unexpected_data_origin', id, data_origin
    from base
    where data_origin not in ('brand_site', 'dailymed', 'dsld')
  union all
  select 'brand_site_id_origin_id_mismatch', id, data_origin
    from base
    where data_origin = 'brand_site' and id <> data_origin_id
  union all
  select 'brand_site_origin_id_without_source', id, data_origin
    from base
    where data_origin = 'brand_site' and position(':' in data_origin_id) = 0
  union all
  select 'dsld_nonnumeric_origin_id', id, data_origin
    from base
    where data_origin = 'dsld' and data_origin_id !~ '^[0-9]+$'
  union all
  select 'blank_data_origin_url', id, data_origin
    from base
    where data_origin_url is not null and btrim(data_origin_url) = ''
  union all
  select 'non_http_data_origin_url', id, data_origin
    from base
    where data_origin_url is not null
      and btrim(data_origin_url) <> ''
      and data_origin_url !~* '^https?://'
  union all
  select 'negative_data_origin_priority', id, data_origin from base where data_origin_priority < 0
  union all
  select 'nonpositive_serving_grams', id, data_origin from base where serving_grams is not null and serving_grams <= 0
  union all
  select 'non_object_label', id, data_origin from base where jsonb_typeof(label) <> 'object'
  union all
  select 'missing_ingredient_rows', id, data_origin
    from base
    where jsonb_typeof(label) = 'object'
      and (not (label ? 'ingredientRows') or jsonb_typeof(label->'ingredientRows') = 'null')
  union all
  select 'nonarray_ingredient_rows', id, data_origin
    from base
    where jsonb_typeof(label) = 'object'
      and label ? 'ingredientRows'
      and jsonb_typeof(label->'ingredientRows') not in ('array', 'null')
  union all
  select 'empty_ingredient_rows', id, data_origin
    from base
    where case
      when jsonb_typeof(label->'ingredientRows') = 'array'
      then jsonb_array_length(label->'ingredientRows') = 0
      else false
    end
  union all
  select 'missing_serving_sizes', id, data_origin
    from base
    where jsonb_typeof(label) = 'object'
      and (not (label ? 'servingSizes') or jsonb_typeof(label->'servingSizes') = 'null')
  union all
  select 'nonarray_serving_sizes', id, data_origin
    from base
    where jsonb_typeof(label) = 'object'
      and label ? 'servingSizes'
      and jsonb_typeof(label->'servingSizes') not in ('array', 'null')
  union all
  select 'empty_serving_sizes', id, data_origin
    from base
    where case
      when jsonb_typeof(label->'servingSizes') = 'array'
      then jsonb_array_length(label->'servingSizes') = 0
      else false
    end
  union all
  select 'blank_search_text', id, data_origin from base where btrim(search_text) = ''
  union all
  select 'oversized_search_text', id, data_origin from base where char_length(search_text) > ${SEARCH_TEXT_MAX_LENGTH}
  union all
  select 'noncompact_search_text', id, data_origin
    from base
    where search_text <> regexp_replace(btrim(search_text), '[[:space:]]+', ' ', 'g')
  union all
  select 'search_text_omits_name', id, data_origin
    from base
    where btrim(name) <> '' and strpos(lower(search_text), lower(btrim(name))) = 0
  union all
  select 'search_text_omits_brand', id, data_origin
    from base
    where brand is not null
      and btrim(brand) <> ''
      and strpos(lower(search_text), lower(btrim(brand))) = 0
  union all
  select 'search_text_omits_upc', id, data_origin
    from base
    where upc is not null
      and btrim(upc) <> ''
      and strpos(lower(search_text), lower(btrim(upc))) = 0
  union all
  select 'future_imported_at', id, data_origin
    from base
    where imported_at > transaction_timestamp() + interval '5 minutes'
  union all
  select 'missing_dsld_canonical_target', row.id, row.data_origin
    from base row
    where row.canonical_key like 'dsld:%'
      and not exists (
        select 1
        from supplements target
        where target.data_origin = 'dsld'
          and target.data_origin_id = substring(row.canonical_key from 6)
      )
  union all
  select 'brand_site_no_upc_nonself', id, data_origin
    from base
    where data_origin = 'brand_site'
      and nullif(btrim(upc), '') is null
      and canonical_key <> id
  union all
  select 'brand_site_dsld_canonical_upc_mismatch', row.id, row.data_origin
    from base row
    where row.data_origin = 'brand_site'
      and nullif(btrim(row.upc), '') is not null
      and row.canonical_key like 'dsld:%'
      and exists (
        select 1
        from supplements target
        where target.data_origin = 'dsld'
          and target.data_origin_id = substring(row.canonical_key from 6)
          and target.upc is distinct from row.upc
      )
  union all
  select 'brand_site_missing_source', id, data_origin
    from base
    where data_origin = 'brand_site'
      and (
        not (label ? 'source')
        or jsonb_typeof(label->'source') = 'null'
        or (jsonb_typeof(label->'source') = 'string' and btrim(label->>'source') = '')
      )
  union all
  select 'brand_site_wrong_type_source', id, data_origin
    from base
    where data_origin = 'brand_site'
      and label ? 'source'
      and jsonb_typeof(label->'source') not in ('string', 'null')
  union all
  select 'brand_site_missing_source_id', id, data_origin
    from base
    where data_origin = 'brand_site'
      and (
        not (label ? 'sourceId')
        or jsonb_typeof(label->'sourceId') = 'null'
        or (jsonb_typeof(label->'sourceId') = 'string' and btrim(label->>'sourceId') = '')
      )
  union all
  select 'brand_site_wrong_type_source_id', id, data_origin
    from base
    where data_origin = 'brand_site'
      and label ? 'sourceId'
      and jsonb_typeof(label->'sourceId') not in ('string', 'null')
  union all
  select 'brand_site_missing_source_fetched_at', id, data_origin
    from base
    where data_origin = 'brand_site'
      and (
        not (label ? 'sourceFetchedAt')
        or jsonb_typeof(label->'sourceFetchedAt') = 'null'
        or (jsonb_typeof(label->'sourceFetchedAt') = 'string' and btrim(label->>'sourceFetchedAt') = '')
      )
  union all
  select 'brand_site_invalid_source_fetched_at', id, data_origin
    from base
    where data_origin = 'brand_site'
      and jsonb_typeof(label->'sourceFetchedAt') = 'string'
      and btrim(label->>'sourceFetchedAt') <> ''
      and not pg_input_is_valid(label->>'sourceFetchedAt', 'timestamptz')
  union all
  select 'brand_site_future_source_fetched_at', id, data_origin
    from base
    where data_origin = 'brand_site'
      and case
        when jsonb_typeof(label->'sourceFetchedAt') = 'string'
          and pg_input_is_valid(label->>'sourceFetchedAt', 'timestamptz')
        then (label->>'sourceFetchedAt')::timestamptz > transaction_timestamp() + interval '5 minutes'
        else false
      end
  union all
  select 'brand_site_missing_source_url', id, data_origin
    from base
    where data_origin = 'brand_site'
      and (
        not (label ? 'sourceUrl')
        or jsonb_typeof(label->'sourceUrl') = 'null'
        or (jsonb_typeof(label->'sourceUrl') = 'string' and btrim(label->>'sourceUrl') = '')
      )
  union all
  select 'brand_site_missing_schema_version', id, data_origin
    from base
    where data_origin = 'brand_site'
      and (not (label ? 'schemaVersion') or jsonb_typeof(label->'schemaVersion') = 'null')
  union all
  select 'brand_site_wrong_type_schema_version', id, data_origin
    from base
    where data_origin = 'brand_site'
      and label ? 'schemaVersion'
      and jsonb_typeof(label->'schemaVersion') not in ('number', 'null')
  union all
  select 'brand_site_missing_evidence_status', id, data_origin
    from base
    where data_origin = 'brand_site'
      and (
        not (label ? 'evidenceStatus')
        or jsonb_typeof(label->'evidenceStatus') = 'null'
        or (jsonb_typeof(label->'evidenceStatus') = 'string' and btrim(label->>'evidenceStatus') = '')
      )
  union all
  select 'brand_site_wrong_type_evidence_status', id, data_origin
    from base
    where data_origin = 'brand_site'
      and label ? 'evidenceStatus'
      and jsonb_typeof(label->'evidenceStatus') not in ('string', 'null')
  union all
  select 'duplicate_exact_identity', id, data_origin from duplicate_identity_rows
  union all
  select 'duplicate_exact_upc', id, data_origin from duplicate_upc_rows
),
ranked_candidates as (
  select
    issue,
    id,
    data_origin,
    row_number() over (partition by issue order by id, data_origin) as issue_rank
  from candidate_pairs
),
limited as (
  select issue, id, data_origin, issue_rank
  from ranked_candidates
  order by issue_rank, issue, id, data_origin
  limit ${candidateLimit}
),
candidate_count as (
  select count(*) as total_candidate_issue_rows from candidate_pairs
)
select jsonb_build_object(
  'scope', 'selected_drilldowns',
  'limit', ${candidateLimit},
  'totalCandidateIssueRows', (select total_candidate_issue_rows from candidate_count),
  'truncated', (select total_candidate_issue_rows > ${candidateLimit} from candidate_count),
  'items', coalesce((
    select jsonb_agg(
      jsonb_build_object('issue', issue, 'id', id, 'dataOrigin', data_origin)
      order by issue_rank, issue, id, data_origin
    )
    from limited
  ), '[]'::jsonb)
)::text as audit;
`, statementTimeoutMs);
}

function extractJsonPayload(psqlOutput) {
  const payload = psqlOutput
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.startsWith("{"));
  if (!payload) throw new Error("Expected a JSON audit payload from psql.");
  return JSON.parse(payload);
}

function schemaAllowsDataAudit(schemaAudit) {
  return schemaAudit?.dataAuditReady === true;
}

function productTestsCanBeAudited(schemaAudit) {
  const related = schemaAudit?.relatedProductTests;
  return related?.product_tests_present === true
    && related?.product_tests_supplement_id_present === true;
}

function runAudit({
  dbUrl = getDbUrl(),
  candidateLimit = 0,
  statementTimeoutMs = DEFAULT_STATEMENT_TIMEOUT_MS,
  executeSql = runPsql,
} = {}) {
  const schema = extractJsonPayload(executeSql(dbUrl, buildSchemaAuditSql(statementTimeoutMs)));
  if (!schemaAllowsDataAudit(schema)) {
    return {
      auditVersion: 1,
      readOnly: true,
      schema,
      data: {
        status: "skipped_schema_mismatch",
      },
      candidates: {
        status: candidateLimit > 0 ? "skipped_schema_mismatch" : "omitted",
      },
    };
  }

  const data = extractJsonPayload(executeSql(dbUrl, buildDataAuditSql({
    includeProductTests: productTestsCanBeAudited(schema),
    statementTimeoutMs,
  })));
  const candidates = candidateLimit > 0
    ? extractJsonPayload(executeSql(dbUrl, buildCandidateAuditSql({ candidateLimit, statementTimeoutMs })))
    : {
        status: "omitted",
        scope: "selected_drilldowns",
        reason: "use_--candidate-limit_to_include_bounded_ids",
      };

  return {
    auditVersion: 1,
    readOnly: true,
    schema,
    data,
    candidates,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  process.stdout.write(`${JSON.stringify(runAudit(options), null, 2)}\n`);
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
  DEFAULT_STATEMENT_TIMEOUT_MS,
  MAX_CANDIDATE_IDS,
  SEARCH_TEXT_MAX_LENGTH,
  buildCandidateAuditSql,
  buildDataAuditSql,
  buildSchemaAuditSql,
  extractJsonPayload,
  parseArgs,
  productTestsCanBeAudited,
  readOnlySql,
  runAudit,
  schemaAllowsDataAudit,
};
