#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: apps/web/sql/product-tests/import-plasticlist.sh [--schema-only] [--legacy-supplement-db] [--replace-source]

Imports PlasticList sample concentrations into product_tests.

Required env:
  MURPH_LABELS_DB_URL           Postgres URL for the labels database.
  PLASTICLIST_SAMPLES_TSV_PATH  Path to PlasticList samples.tsv.
                                Required unless --schema-only is set.

Optional env:
  PLASTICLIST_PRODUCT_MATCHES_TSV_PATH
    TSV with columns: plasticlist_sample_id, food_id, supplement_id,
    match_method. Exactly one of food_id or supplement_id must be set per
    mapped row. This is optional for later curated remaps; by default every
    sample links to a PlasticList-backed food row by exact source product id.
  PSQL_BIN                      psql binary to use. Defaults to psql.

Flags:
  --schema-only                 Apply schemas without importing samples.
  --legacy-supplement-db        With --schema-only, prepare a legacy
                                MURPH_SUPPLEMENT_DB_URL fallback database that
                                already has supplements but lacks foods.
  --replace-source              Prune PlasticList rows absent from the prepared
                                input after upserting current rows. Use only
                                with a complete source export.

The runner writes derived TSVs only under .plasticlist-work/product-tests/ in
this worktree. It never prints the database URL or passes it to psql argv.
USAGE
}

schema_only=false
legacy_supplement_db=false
replace_source=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --schema-only)
      schema_only=true
      ;;
    --legacy-supplement-db)
      legacy_supplement_db=true
      ;;
    --replace-source)
      replace_source=true
      ;;
    *)
      usage
      exit 64
      ;;
  esac
  shift
done

if [ "$legacy_supplement_db" = true ] && [ "$schema_only" = false ]; then
  echo "--legacy-supplement-db requires --schema-only" >&2
  exit 64
fi

if [ "$replace_source" = true ] && [ "$schema_only" = true ]; then
  echo "--replace-source cannot be used with --schema-only" >&2
  exit 64
fi

samples_path="${PLASTICLIST_SAMPLES_TSV_PATH:-}"
matches_path="${PLASTICLIST_PRODUCT_MATCHES_TSV_PATH:-}"

if [ "$schema_only" = false ] && [ -z "$samples_path" ]; then
  echo "PLASTICLIST_SAMPLES_TSV_PATH is required" >&2
  exit 64
fi

if [ "$schema_only" = false ] && [ ! -f "$samples_path" ]; then
  echo "PlasticList samples TSV not found" >&2
  exit 66
fi

if [ "$schema_only" = false ] && [ -n "$matches_path" ] && [ ! -f "$matches_path" ]; then
  echo "PlasticList product matches TSV not found" >&2
  exit 66
fi

replace_source_lock_dir=""

cleanup_import() {
  cleanup_labels_db_psql_env
  if [ -n "$replace_source_lock_dir" ]; then
    rmdir "$replace_source_lock_dir" 2>/dev/null || true
  fi
}

trap cleanup_import EXIT

script_dir_abs="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir_abs/../../../.." && pwd)"
script_dir="apps/web/sql/product-tests"

# shellcheck source=apps/web/sql/product-tests/labels-db-psql.sh
. "$script_dir_abs/labels-db-psql.sh"
prepare_labels_db_psql_env

cd "$repo_root"

apply_product_test_schemas() {
  echo "Applying product label and test schemas..."
  if [ "$legacy_supplement_db" = true ]; then
    run_labels_psql -v ON_ERROR_STOP=1 -f "$script_dir/legacy-supplement-foods-stub.sql"
  else
    run_labels_psql -v ON_ERROR_STOP=1 -f "apps/web/sql/foods/schema.sql"
    run_labels_psql -v ON_ERROR_STOP=1 -f "apps/web/sql/supplements/schema.sql"
  fi
  run_labels_psql -v ON_ERROR_STOP=1 -f "$script_dir/schema.sql"
}

if [ "$schema_only" = true ]; then
  apply_product_test_schemas
  echo "Applied product label and test schemas."
  exit 0
fi

work_dir=".plasticlist-work/product-tests"
mkdir -p "$work_dir"
run_work_dir="$(mktemp -d "$work_dir/run.XXXXXX")"
prepared_foods_tsv="$run_work_dir/plasticlist-foods.tsv"
prepared_tsv="$run_work_dir/plasticlist-product-tests.tsv"
empty_matches_tsv="$run_work_dir/empty-plasticlist-matches.tsv"

if [ "$replace_source" = true ]; then
  if ! mkdir "$work_dir/replace-source.lock" 2>/dev/null; then
    echo "Another PlasticList --replace-source import is already running." >&2
    exit 75
  fi
  replace_source_lock_dir="$work_dir/replace-source.lock"
fi

if [ -z "$matches_path" ]; then
  printf 'plasticlist_sample_id\tfood_id\tsupplement_id\tmatch_method\n' > "$empty_matches_tsv"
  matches_path="$empty_matches_tsv"
fi

PLASTICLIST_PREPARED_FOODS_TSV="$prepared_foods_tsv.tmp" awk -F '\t' -v OFS='\t' '
  function trim(value) {
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
    return value
  }

  function clean_field(value) {
    value = trim(value)
    gsub(/\r|\n|\t/, " ", value)
    return value
  }

  function csv_field(value) {
    value = clean_field(value)
    if (value ~ /"/) {
      gsub(/"/, "\"\"", value)
      return "\"" value "\""
    }
    return value
  }

  function clean_header(value) {
    value = clean_field(value)
    sub("^" sprintf("%c%c%c", 239, 187, 191), "", value)
    return value
  }

  function header_index(target, header, count, idx) {
    if (!(target in header)) {
      print "Missing required PlasticList column: " target > "/dev/stderr"
      exit 65
    }
    return header[target]
  }

  function add_contaminant(source_key, key, name, method_group) {
    contaminant_count += 1
    contaminant_source_key[contaminant_count] = source_key
    contaminant_key[contaminant_count] = key
    contaminant_name[contaminant_count] = name
    contaminant_method_group[contaminant_count] = method_group
  }

  function parse_result(raw) {
    raw = trim(raw)
    result_operator = ""
    result_value = ""
    normalized_value = ""
    normalized_unit = ""
    normalized_basis = ""

    if (raw == "" || raw == "NO RESULT") {
      return 0
    }

    if (raw == "<LOQ") {
      result_operator = "not_detected"
      return 1
    }

    if (raw ~ /^<[0-9]+([.][0-9]+)?$/) {
      result_operator = "lt"
      result_value = substr(raw, 2)
      return 1
    }

    if (raw ~ /^>[0-9]+([.][0-9]+)?$/) {
      result_operator = "gt"
      result_value = substr(raw, 2)
      normalized_value = result_value
      normalized_unit = "ng/g"
      normalized_basis = "product_mass"
      return 1
    }

    if (raw ~ /^[0-9]+([.][0-9]+)?$/) {
      result_operator = "eq"
      result_value = raw
      normalized_value = raw
      normalized_unit = "ng/g"
      normalized_basis = "product_mass"
      return 1
    }

    print "Unsupported PlasticList result value: " raw > "/dev/stderr"
    exit 65
  }

  BEGIN {
    add_contaminant("dehp_equivalents", "dehp_equivalents", "DEHP equivalents", "phthalates")
    add_contaminant("dehp", "di_2_ethylhexyl_phthalate_dehp", "Di(2-ethylhexyl) phthalate (DEHP)", "phthalates")
    add_contaminant("dbp", "di_n_butyl_phthalate_dbp", "Di-n-butyl phthalate (DBP)", "phthalates")
    add_contaminant("bbp", "butyl_benzyl_phthalate_bbp", "Benzyl butyl phthalate (BBP)", "phthalates")
    add_contaminant("dinp", "diisononyl_phthalate_dinp", "Diisononyl phthalate (DINP)", "phthalates")
    add_contaminant("didp", "di_isodecyl_phthalate_didp", "Diisodecyl phthalate (DIDP)", "phthalates")
    add_contaminant("dep", "diethyl_phthalate_dep", "Diethyl phthalate (DEP)", "phthalates")
    add_contaminant("dmp", "dimethyl_phthalate_dmp", "Dimethyl phthalate (DMP)", "phthalates")
    add_contaminant("dibp", "diisobutyl_phthalate_dibp", "Diisobutyl phthalate (DIBP)", "phthalates")
    add_contaminant("dnhp", "di_n_hexyl_phthalate_dnhp", "Di-n-hexyl phthalate (DNHP)", "phthalates")
    add_contaminant("dchp", "dicyclohexyl_phthalate_dchp", "Dicyclohexyl phthalate (DCHP)", "phthalates")
    add_contaminant("dnop", "di_n_octyl_phthalate_dnop", "Di-n-octyl phthalate (DNOP)", "phthalates")
    add_contaminant("bpa", "bisphenol_a_bpa", "Bisphenol A (BPA)", "bisphenols")
    add_contaminant("bps", "bisphenol_s_bps", "Bisphenol S (BPS)", "bisphenols")
    add_contaminant("bpf", "bisphenol_f_bpf", "Bisphenol F (BPF)", "bisphenols")
    add_contaminant("deht", "di_2_ethylhexyl_terephthalate_deht", "Di(2-ethylhexyl) terephthalate (DEHT)", "phthalates")
    add_contaminant("deha", "di_2_ethylhexyl_adipate", "Di(2-ethylhexyl) adipate (DEHA)", "phthalates")
    add_contaminant("dinch", "diisononyl_cyclohexane_1_2_dicarboxylate_dinch", "Diisononyl cyclohexane-1,2-dicarboxylate (DINCH)", "phthalates")
    add_contaminant("dida", "diisodecyl_adipate_dida", "Diisodecyl adipate (DIDA)", "phthalates")

    print "id", "food_id", "supplement_id", "source_key", "source_result_id", "source_name", "source_url", "source_report_title", "report_date", "tested_product_name", "tested_product_brand", "tested_product_upc", "tested_source_product_id", "match_method", "explicit_match", "contaminant_key", "contaminant_name", "result_operator", "result_value", "result_unit", "result_basis", "normalized_value", "normalized_unit", "normalized_basis", "lab_name", "test_method"
  }

  NR == FNR {
    if (FNR == 1) {
      for (i = 1; i <= NF; i += 1) {
        match_header[clean_header($i)] = i
      }
      match_sample_id_col = header_index("plasticlist_sample_id", match_header)
      match_food_id_col = header_index("food_id", match_header)
      match_supplement_id_col = header_index("supplement_id", match_header)
      match_method_col = header_index("match_method", match_header)
      next
    }

    sample_id = clean_field($match_sample_id_col)
    food_id = clean_field($match_food_id_col)
    supplement_id = clean_field($match_supplement_id_col)
    method = clean_field($match_method_col)

    if (sample_id == "") {
      print "PlasticList match row is missing plasticlist_sample_id" > "/dev/stderr"
      exit 65
    }

    if ((food_id == "") == (supplement_id == "")) {
      print "PlasticList match row must set exactly one product id for sample " sample_id > "/dev/stderr"
      exit 65
    }

    if (!(method == "exact_upc" || method == "exact_source_id" || method == "manual_confirmed")) {
      print "Unsupported PlasticList match_method for sample " sample_id > "/dev/stderr"
      exit 65
    }

    if (sample_id in match_method) {
      print "Duplicate PlasticList match row for sample " sample_id > "/dev/stderr"
      exit 65
    }

    match_food_id[sample_id] = food_id
    match_supplement_id[sample_id] = supplement_id
    match_method[sample_id] = method
    next
  }

  FNR == 1 {
    for (i = 1; i <= NF; i += 1) {
      sample_header[clean_header($i)] = i
    }

    sample_id_col = header_index("id", sample_header)
    source_product_id_col = header_index("product_id", sample_header)
    product_name_col = header_index("product", sample_header)
    tags_col = header_index("tags", sample_header)
    phthalates_method_col = header_index("analysis_method_phthalates", sample_header)
    bisphenols_method_col = header_index("analysis_method_bisphenols", sample_header)

    for (idx = 1; idx <= contaminant_count; idx += 1) {
      raw_key = contaminant_source_key[idx]
      column_key = raw_key
      if (raw_key == "dehp_equivalents") {
        column_key = "DEHP_equivalents"
      } else {
        column_key = toupper(raw_key)
      }
      contaminant_result_col[idx] = header_index(column_key "_ng_g", sample_header)
    }
    next
  }

  {
    sample_id = clean_field($sample_id_col)
    source_product_id = clean_field($source_product_id_col)
    product_name = clean_field($product_name_col)
    tags = clean_field($tags_col)
    phthalates_method = clean_field($phthalates_method_col)
    bisphenols_method = clean_field($bisphenols_method_col)

    if (sample_id == "") {
      print "PlasticList sample row is missing id" > "/dev/stderr"
      exit 65
    }

    if (source_product_id == "") {
      print "PlasticList sample row is missing product_id for sample " sample_id > "/dev/stderr"
      exit 65
    }

    seen_sample[sample_id] = 1

    if (!(source_product_id in product_name_by_id)) {
      product_name_by_id[source_product_id] = product_name
      product_tags_by_id[source_product_id] = tags
      product_sample_ids[source_product_id] = sample_id
      product_order[++product_count] = source_product_id
    } else {
      product_sample_ids[source_product_id] = product_sample_ids[source_product_id] "," sample_id
      if (product_tags_by_id[source_product_id] == "" && tags != "") {
        product_tags_by_id[source_product_id] = tags
      }
    }

    food_id = match_food_id[sample_id]
    supplement_id = match_supplement_id[sample_id]
    method = match_method[sample_id]
    explicit_match = "true"
    if (method == "") {
      food_id = "plasticlist_bay_area_2024:" source_product_id
      method = "exact_source_id"
      explicit_match = "false"
    }
    synthetic_food_id = "plasticlist_bay_area_2024:" source_product_id

    for (idx = 1; idx <= contaminant_count; idx += 1) {
      if (!parse_result($(contaminant_result_col[idx]))) {
        continue
      }

      if (food_id == synthetic_food_id && supplement_id == "") {
        product_has_synthetic_tests[source_product_id] = 1
      }

      test_method = phthalates_method
      if (contaminant_method_group[idx] == "bisphenols") {
        test_method = bisphenols_method
      }

      print \
        csv_field("plasticlist_bay_area_2024:" sample_id ":" contaminant_key[idx] ":ng_g"), \
        csv_field(food_id), \
        csv_field(supplement_id), \
        csv_field("plasticlist_bay_area_2024"), \
        csv_field(sample_id), \
        csv_field("PlasticList"), \
        csv_field("https://plasticlist.org"), \
        csv_field("Data on Plastic Chemicals in Bay Area Foods"), \
        csv_field(""), \
        csv_field(product_name), \
        csv_field(""), \
        csv_field(""), \
        csv_field(source_product_id), \
        csv_field(method), \
        csv_field(explicit_match), \
        csv_field(contaminant_key[idx]), \
        csv_field(contaminant_name[idx]), \
        csv_field(result_operator), \
        csv_field(result_value), \
        csv_field("ng/g"), \
        csv_field("product_mass"), \
        csv_field(normalized_value), \
        csv_field(normalized_unit), \
        csv_field(normalized_basis), \
        csv_field(""), \
        csv_field(test_method)
    }
  }
  END {
    for (sample_id in match_method) {
      if (!(sample_id in seen_sample)) {
        print "PlasticList match row references unknown sample " sample_id > "/dev/stderr"
        exit 65
      }
    }

    foods_path = ENVIRON["PLASTICLIST_PREPARED_FOODS_TSV"]
    if (foods_path == "") {
      print "PLASTICLIST_PREPARED_FOODS_TSV is required" > "/dev/stderr"
      exit 65
    }

    print "product_id", "product_name", "tags", "sample_ids", "search_text" > foods_path
    for (idx = 1; idx <= product_count; idx += 1) {
      product_id = product_order[idx]
      if (!(product_id in product_has_synthetic_tests)) {
        continue
      }
      print \
        csv_field(product_id), \
        csv_field(product_name_by_id[product_id]), \
        csv_field(product_tags_by_id[product_id]), \
        csv_field(product_sample_ids[product_id]), \
        csv_field(product_name_by_id[product_id] " " product_tags_by_id[product_id] " PlasticList " product_id " " product_sample_ids[product_id]) \
        >> foods_path
    }
  }
' "$matches_path" "$samples_path" > "$prepared_tsv.tmp"

mv "$prepared_foods_tsv.tmp" "$prepared_foods_tsv"
mv "$prepared_tsv.tmp" "$prepared_tsv"

prepared_product_test_rows=$(($(wc -l < "$prepared_tsv") - 1))
if [ "$prepared_product_test_rows" -le 0 ]; then
  echo "PlasticList import prepared zero product test rows; refusing to modify labels database." >&2
  exit 65
fi

prepared_food_rows=$(($(wc -l < "$prepared_foods_tsv") - 1))

apply_product_test_schemas

echo "Importing PlasticList product test rows..."
run_labels_psql \
  -v ON_ERROR_STOP=1 \
  -v replace_source="$replace_source" \
  -v foods_tsv="$prepared_foods_tsv" \
  -v product_tests_tsv="$prepared_tsv" \
  -f "$script_dir/import-plasticlist.sql"

echo "Imported $prepared_food_rows PlasticList food rows and $prepared_product_test_rows product test rows."
