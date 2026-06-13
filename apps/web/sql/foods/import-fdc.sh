#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: apps/web/sql/foods/import-fdc.sh [--prepare-only]
       apps/web/sql/foods/import-fdc.sh --export-prepared <out.csv>
       apps/web/sql/foods/import-fdc.sh --apply-prepared <in.csv>

Imports the FULL USDA FoodData Central CSV archive into the labels DB
`foods` table (data types: Branded, Foundation, SR Legacy, Survey/FNDDS).

The default mode runs the whole transform on the connected database. Managed
instances with small memory should use the two-phase path instead: run the
default mode against a LOCAL staging Postgres, then --export-prepared from it
(release-scoped by FDC_RELEASE_DATE), then --apply-prepared to the managed
labels DB (plain COPY + batched upserts, no server-side aggregation).

Required env:
  FDC_DATA_DIR        Directory containing the unzipped FULL FDC CSV archive
                      (the directory holding food.csv, branded_food.csv, ...).
                      Not required with --apply-prepared. For
                      --export-prepared, required only when FDC_RELEASE_DATE is
                      unset and must be derived from the directory name.
  MURPH_LABELS_DB_URL Postgres URL for the labels database
                      (falls back to MURPH_SUPPLEMENT_DB_URL).
                      Not required with --prepare-only.

Optional env:
  FDC_RELEASE_DATE    Release date YYYY-MM-DD. Derived from the archive
                      directory name when unset (e.g. ..._2026-04-30).
  PSQL_BIN            psql binary to use. Defaults to psql.

The runner writes derived CSVs only under .fdc-work/foods-import/ in this
worktree. It never prints the database URL.
USAGE
}

prepare_only=0
export_prepared=""
apply_prepared=""
case "${1:-}" in
  --prepare-only)
    prepare_only=1
    shift
    ;;
  --export-prepared)
    export_prepared="${2:-}"
    [ -n "$export_prepared" ] || { usage; exit 64; }
    shift 2
    ;;
  --apply-prepared)
    apply_prepared="${2:-}"
    [ -n "$apply_prepared" ] || { usage; exit 64; }
    shift 2
    ;;
  -h|--help)
    usage
    exit 0
    ;;
esac

if [ "$#" -ne 0 ]; then
  usage
  exit 64
fi

labels_db_url="${MURPH_LABELS_DB_URL:-${MURPH_SUPPLEMENT_DB_URL:-}}"
if [ "$prepare_only" -eq 0 ] && [ -z "$labels_db_url" ]; then
  echo "MURPH_LABELS_DB_URL (or MURPH_SUPPLEMENT_DB_URL) is required" >&2
  exit 64
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"
work_dir="$repo_root/.fdc-work/foods-import"
psql_bin="${PSQL_BIN:-psql}"

mkdir -p "$work_dir"

resolve_release_date() {
  local release_date="${FDC_RELEASE_DATE:-}"

  if [ -z "$release_date" ] && [ -n "${FDC_DATA_DIR:-}" ]; then
    release_date="$(basename "$FDC_DATA_DIR" | grep -Eo '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -n 1 || true)"
  fi

  if ! printf '%s' "$release_date" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then
    echo "FDC_RELEASE_DATE is required (YYYY-MM-DD) when FDC_DATA_DIR is unset or its directory name has no date" >&2
    exit 64
  fi

  printf '%s\n' "$release_date"
}

if [ -n "$export_prepared" ]; then
  release_date="$(resolve_release_date)"
  echo "Exporting prepared foods rows for FDC release $release_date..."
  "$psql_bin" -v ON_ERROR_STOP=1 -c "\\copy (SELECT id, canonical_key, data_origin, data_origin_id, data_origin_url, data_origin_priority, name, brand, upc, off_market, search_text, label, fdc_release_date FROM foods WHERE fdc_release_date = '$release_date' ORDER BY id) TO '$export_prepared' WITH (FORMAT csv, HEADER true)" "$labels_db_url"
  echo "Exported $(($(wc -l < "$export_prepared") - 1)) prepared rows."
  exit 0
fi

if [ -n "$apply_prepared" ]; then
  if [ ! -f "$apply_prepared" ]; then
    echo "Prepared CSV not found: $apply_prepared" >&2
    exit 66
  fi
  echo "Applying foods schema..."
  "$psql_bin" -v ON_ERROR_STOP=1 -f "$script_dir/schema.sql" "$labels_db_url"
  echo "Applying prepared foods rows..."
  FDC_PREPARED_CSV="$apply_prepared" "$psql_bin" -v ON_ERROR_STOP=1 -f "$script_dir/apply-prepared.sql" "$labels_db_url"
  exit 0
fi

if [ -z "${FDC_DATA_DIR:-}" ]; then
  echo "FDC_DATA_DIR is required" >&2
  exit 64
fi

release_date="$(resolve_release_date)"

find_csv() {
  local filename="$1"
  local found

  found="$(find "$FDC_DATA_DIR" -type f -name "$filename" -print -quit 2>/dev/null || true)"
  if [ -z "$found" ]; then
    echo "Missing CSV in FDC_DATA_DIR: $filename" >&2
    exit 66
  fi

  printf '%s\n' "$found"
}

assert_header() {
  local path="$1"
  local expected="$2"
  local actual

  actual="$(head -n 1 "$path")"
  if [ "$actual" != "$expected" ]; then
    echo "Unexpected header for ${path##*/}" >&2
    echo "Expected: $expected" >&2
    echo "Actual:   $actual" >&2
    exit 65
  fi
}

export FDC_FOOD_CSV="$(find_csv food.csv)"
export FDC_BRANDED_CSV="$(find_csv branded_food.csv)"
export FDC_SURVEY_CSV="$(find_csv survey_fndds_food.csv)"
export FDC_WWEIA_CATEGORY_CSV="$(find_csv wweia_food_category.csv)"
export FDC_NUTRIENT_CSV="$(find_csv nutrient.csv)"
food_nutrient_csv="$(find_csv food_nutrient.csv)"
export FDC_PORTION_CSV="$(find_csv food_portion.csv)"
export FDC_CATEGORY_CSV="$(find_csv food_category.csv)"
export FDC_MEASURE_UNIT_CSV="$(find_csv measure_unit.csv)"

assert_header "$FDC_FOOD_CSV" '"fdc_id","data_type","description","food_category_id","publication_date"'
assert_header "$FDC_BRANDED_CSV" '"fdc_id","brand_owner","brand_name","subbrand_name","gtin_upc","ingredients","not_a_significant_source_of","serving_size","serving_size_unit","household_serving_fulltext","branded_food_category","data_source","package_weight","modified_date","available_date","market_country","discontinued_date","preparation_state_code","trade_channel","short_description","material_code"'
assert_header "$FDC_SURVEY_CSV" '"fdc_id","food_code","wweia_category_code","start_date","end_date"'
assert_header "$FDC_WWEIA_CATEGORY_CSV" '"wweia_food_category","wweia_food_category_description"'
assert_header "$FDC_NUTRIENT_CSV" '"id","name","unit_name","nutrient_nbr","rank"'
assert_header "$food_nutrient_csv" '"id","fdc_id","nutrient_id","amount","data_points","derivation_id","min","max","median","loq","footnote","min_year_acquired","percent_daily_value"'
assert_header "$FDC_PORTION_CSV" '"id","fdc_id","seq_num","amount","measure_unit_id","portion_description","modifier","gram_weight","data_points","footnote","min_year_acquired"'
assert_header "$FDC_CATEGORY_CSV" '"id","code","description"'
assert_header "$FDC_MEASURE_UNIT_CSV" '"id","name"'

export FDC_FOOD_NUTRIENT_REDUCED_CSV="$work_dir/food-nutrient-reduced.csv"

# Reduce the ~27M-row food_nutrient.csv locally before \copy:
# - generic foods (Foundation, SR Legacy, FNDDS) keep ALL nutrients;
# - branded foods keep the US-label-declarable panel only;
# - only fdc_id, nutrient_id, amount columns are uploaded.
label_panel_nbrs="203 204 205 208 262 269 291 301 303 304 305 306 307 309 312 315 317 318 320 323 324 328 401 404 405 406 410 415 417 418 421 430 435 539 601 605 606 645 646"

echo "Reducing food_nutrient.csv (label panel for branded, all nutrients for generics)..."
LC_ALL=C awk -F '\",\"' \
  -v label_nbrs="$label_panel_nbrs" \
  -v food_csv="$FDC_FOOD_CSV" \
  -v nutrient_csv="$FDC_NUTRIENT_CSV" '
  BEGIN {
    split(label_nbrs, nbrs, " ")
    for (idx in nbrs) {
      wanted_nbr[nbrs[idx]] = 1
    }
  }
  FILENAME == nutrient_csv {
    if (FNR > 1) {
      id = $1
      nbr = $4
      gsub(/^"|"$/, "", id)
      gsub(/^"|"$/, "", nbr)
      if (nbr in wanted_nbr) {
        label_nutrient[id] = 1
      }
    }
    next
  }
  FILENAME == food_csv {
    if (FNR > 1) {
      id = $1
      data_type = $2
      gsub(/^"|"$/, "", id)
      gsub(/^"|"$/, "", data_type)
      if (data_type == "foundation_food" || data_type == "sr_legacy_food" || data_type == "survey_fndds_food") {
        generic_food[id] = 1
      }
    }
    next
  }
  FNR == 1 {
    print "\"fdc_id\",\"nutrient_id\",\"amount\""
    next
  }
  {
    fdc_id = $2
    nutrient_id = $3
    amount = $4
    gsub(/^"|"$/, "", fdc_id)
    gsub(/^"|"$/, "", nutrient_id)
    gsub(/^"|"$/, "", amount)
    if ((fdc_id in generic_food) || (nutrient_id in label_nutrient)) {
      print "\"" fdc_id "\",\"" nutrient_id "\",\"" amount "\""
    }
  }
' "$FDC_NUTRIENT_CSV" "$FDC_FOOD_CSV" "$food_nutrient_csv" > "$FDC_FOOD_NUTRIENT_REDUCED_CSV.tmp"
mv "$FDC_FOOD_NUTRIENT_REDUCED_CSV.tmp" "$FDC_FOOD_NUTRIENT_REDUCED_CSV"

echo "Reduced food_nutrient rows: $(($(wc -l < "$FDC_FOOD_NUTRIENT_REDUCED_CSV") - 1))"

if [ "$prepare_only" -eq 1 ]; then
  echo "Prepared reduced nutrient CSV under .fdc-work/foods-import/"
  exit 0
fi

if ! command -v "$psql_bin" >/dev/null 2>&1; then
  echo "psql not found; set PSQL_BIN or install PostgreSQL client tools" >&2
  exit 69
fi

echo "Applying foods schema..."
"$psql_bin" -v ON_ERROR_STOP=1 -f "$script_dir/schema.sql" "$labels_db_url"

echo "Importing FDC release $release_date..."
"$psql_bin" -v ON_ERROR_STOP=1 -v fdc_release_date="$release_date" -f "$script_dir/import-fdc.sql" "$labels_db_url"
