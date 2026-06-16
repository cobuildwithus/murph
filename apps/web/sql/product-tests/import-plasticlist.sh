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
  PLASTICLIST_REPLACE_SOURCE_EXPECTED_PRODUCT_TEST_ROWS
    Required with --replace-source. Must equal the prepared complete export row
    count before the import can prune PlasticList rows absent from the input.
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
replace_source_expected_rows="${PLASTICLIST_REPLACE_SOURCE_EXPECTED_PRODUCT_TEST_ROWS:-}"

if [ "$schema_only" = false ] && [ -z "$samples_path" ]; then
  echo "PLASTICLIST_SAMPLES_TSV_PATH is required" >&2
  exit 64
fi

if [ "$schema_only" = false ] && [ ! -f "$samples_path" ]; then
  echo "PlasticList samples TSV not found" >&2
  exit 66
fi

if [ "$schema_only" = false ] && [ -n "${PLASTICLIST_PRODUCT_MATCHES_TSV_PATH:-}" ]; then
  echo "PLASTICLIST_PRODUCT_MATCHES_TSV_PATH is no longer supported; use import-product-test-remaps.sh for reviewed product links" >&2
  exit 64
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
prepared_tsv="$run_work_dir/plasticlist-product-tests.tsv"
rendered_import_sql="$run_work_dir/import-plasticlist.sql"

if [ "$replace_source" = true ]; then
  if ! mkdir "$work_dir/replace-source.lock" 2>/dev/null; then
    echo "Another PlasticList --replace-source import is already running." >&2
    exit 75
  fi
  replace_source_lock_dir="$work_dir/replace-source.lock"
fi

LC_ALL=C awk -F '\t' -v OFS='\t' '
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

  function canonical_number(value) {
    return sprintf("%.15g", value + 0)
  }

  function ng_g_to_ppm(value) {
    return canonical_number(value / 1000)
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
      normalized_value = ng_g_to_ppm(result_value)
      normalized_unit = "ppm"
      normalized_basis = "product_mass"
      return 1
    }

    if (raw ~ /^>[0-9]+([.][0-9]+)?$/) {
      result_operator = "gt"
      result_value = substr(raw, 2)
      normalized_value = ng_g_to_ppm(result_value)
      normalized_unit = "ppm"
      normalized_basis = "product_mass"
      return 1
    }

    if (raw ~ /^[0-9]+([.][0-9]+)?$/) {
      result_operator = "eq"
      result_value = raw
      normalized_value = ng_g_to_ppm(raw)
      normalized_unit = "ppm"
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

    print "id", "food_id", "supplement_id", "source_key", "source_result_id", "source_name", "source_url", "source_report_title", "report_date", "tested_product_name", "tested_product_brand", "tested_product_upc", "tested_source_product_id", "match_method", "contaminant_key", "contaminant_name", "result_operator", "result_value", "result_unit", "result_basis", "normalized_value", "normalized_unit", "normalized_basis", "lab_name", "test_method"
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

    food_id = ""
    supplement_id = ""
    method = "source_only"

    for (idx = 1; idx <= contaminant_count; idx += 1) {
      if (!parse_result($(contaminant_result_col[idx]))) {
        continue
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
' "$samples_path" > "$prepared_tsv.tmp"

mv "$prepared_tsv.tmp" "$prepared_tsv"

prepared_product_test_rows=$(($(wc -l < "$prepared_tsv") - 1))
if [ "$prepared_product_test_rows" -le 0 ]; then
  echo "PlasticList import prepared zero product test rows; refusing to modify labels database." >&2
  exit 65
fi

if [ "$replace_source" = true ]; then
  if ! [[ "$replace_source_expected_rows" =~ ^[0-9]+$ ]]; then
    echo "PLASTICLIST_REPLACE_SOURCE_EXPECTED_PRODUCT_TEST_ROWS is required with --replace-source" >&2
    exit 64
  fi

  if [ "$prepared_product_test_rows" -ne "$replace_source_expected_rows" ]; then
    echo "PlasticList --replace-source expected $replace_source_expected_rows product test rows but prepared $prepared_product_test_rows; refusing destructive import." >&2
    exit 65
  fi
fi

apply_product_test_schemas

awk \
  -v product_tests_tsv="$(labels_db_psql_copy_literal "$prepared_tsv")" \
  '{
    gsub(/__PRODUCT_TESTS_TSV__/, product_tests_tsv)
    print
  }' \
  "$script_dir/import-plasticlist.sql" > "$rendered_import_sql"

echo "Importing PlasticList product test rows..."
run_labels_psql \
  -v ON_ERROR_STOP=1 \
  -v replace_source="$replace_source" \
  -v replace_source_expected_product_test_rows="$replace_source_expected_rows" \
  -f "$rendered_import_sql"

echo "Imported $prepared_product_test_rows PlasticList product test rows."
