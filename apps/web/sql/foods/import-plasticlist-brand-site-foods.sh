#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: apps/web/sql/foods/import-plasticlist-brand-site-foods.sh

Imports committed PlasticList-reviewed brand-site food label anchors into foods.

Required env:
  MURPH_LABELS_DB_URL  Postgres URL for the labels database.

Optional env:
  PSQL_BIN             psql binary to use. Defaults to psql.

The runner prepares a repo-local CSV under .product-tests-work/ and then applies
the normal foods prepared importer. It never prints the database URL.
USAGE
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
  "")
    ;;
  *)
    usage
    exit 64
    ;;
esac

script_dir_abs="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir_abs/../../../.." && pwd)"
product_tests_script_dir_abs="$repo_root/apps/web/sql/product-tests"

# shellcheck source=apps/web/sql/product-tests/labels-db-psql.sh
. "$product_tests_script_dir_abs/labels-db-psql.sh"

cleanup_food_anchor_import() {
  cleanup_labels_db_psql_env
}

trap cleanup_food_anchor_import EXIT
prepare_labels_db_psql_env

cd "$repo_root"

json_path="apps/web/sql/foods/plasticlist-brand-site-foods.json"
if [ ! -f "$json_path" ]; then
  echo "PlasticList brand-site foods JSON not found" >&2
  exit 66
fi

work_dir="$repo_root/.product-tests-work/plasticlist-brand-site-foods"
mkdir -p "$work_dir"
run_work_dir="$(mktemp -d "$work_dir/run.XXXXXX")"
prepared_csv="$run_work_dir/foods.csv"

node - "$json_path" "$prepared_csv" <<'NODE'
const fs = require("node:fs");

const [inputPath, outputPath] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(inputPath, "utf8"));
if (!Array.isArray(rows) || rows.length === 0) {
  throw new Error("PlasticList brand-site foods JSON must contain at least one row");
}

const headers = [
  "id",
  "canonical_key",
  "data_origin",
  "data_origin_id",
  "data_origin_url",
  "data_origin_priority",
  "name",
  "brand",
  "upc",
  "off_market",
  "search_text",
  "label",
  "serving_grams",
  "fdc_release_date",
];
const seenIds = new Set();
const seenOrigins = new Set();

function requiredString(row, field) {
  const value = row[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`PlasticList brand-site food row is missing ${field}`);
  }
  return value;
}

function nullableString(row, field) {
  const value = row[field];
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") {
    throw new Error(`PlasticList brand-site food row ${field} must be string or null`);
  }
  return value;
}

function requiredNumber(row, field) {
  const value = row[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`PlasticList brand-site food row ${field} must be a finite number`);
  }
  return value;
}

function requiredBoolean(row, field) {
  const value = row[field];
  if (typeof value !== "boolean") {
    throw new Error(`PlasticList brand-site food row ${field} must be boolean`);
  }
  return value;
}

function firstServingGrams(label, id) {
  const servingSizes = label.servingSizes;
  if (!Array.isArray(servingSizes)) return "";
  for (const servingSize of servingSizes) {
    if (!servingSize || typeof servingSize !== "object" || Array.isArray(servingSize)) {
      continue;
    }
    const grams = servingSize.grams;
    if (typeof grams === "number" && Number.isFinite(grams) && grams > 0) {
      return grams;
    }
  }
  throw new Error(`PlasticList brand-site food row ${id} has servingSizes without positive grams`);
}

function csvField(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, "\"\"")}"` : text;
}

function csvRow(row) {
  const id = requiredString(row, "id");
  const dataOrigin = requiredString(row, "dataOrigin");
  const dataOriginId = requiredString(row, "dataOriginId");
  const label = row.label;
  if (!label || typeof label !== "object" || Array.isArray(label)) {
    throw new Error(`PlasticList brand-site food row ${id} is missing label object`);
  }
  if (dataOrigin !== "brand_site") {
    throw new Error(`PlasticList brand-site food row ${id} must use dataOrigin brand_site`);
  }
  if (dataOriginId !== id) {
    throw new Error(`PlasticList brand-site food row ${id} must use dataOriginId equal to id`);
  }
  if (seenIds.has(id)) {
    throw new Error(`Duplicate PlasticList brand-site food id ${id}`);
  }
  seenIds.add(id);
  const originKey = `${dataOrigin}\t${dataOriginId}`;
  if (seenOrigins.has(originKey)) {
    throw new Error(`Duplicate PlasticList brand-site food origin ${originKey}`);
  }
  seenOrigins.add(originKey);

  return [
    id,
    requiredString(row, "canonicalKey"),
    dataOrigin,
    dataOriginId,
    requiredString(row, "dataOriginUrl"),
    requiredNumber(row, "dataOriginPriority"),
    requiredString(row, "name"),
    nullableString(row, "brand"),
    nullableString(row, "upc"),
    requiredBoolean(row, "offMarket"),
    requiredString(row, "searchText"),
    JSON.stringify(label),
    firstServingGrams(label, id),
    requiredString(row, "fdcReleaseDate"),
  ].map(csvField).join(",");
}

const output = `${headers.join(",")}\n${rows.map(csvRow).join("\n")}\n`;
fs.writeFileSync(outputPath, output);
console.log(`Prepared ${rows.length} PlasticList brand-site food row(s).`);
NODE

echo "Applying foods schema..."
run_labels_psql -v ON_ERROR_STOP=1 -f "apps/web/sql/foods/schema.sql"

echo "Applying PlasticList brand-site food anchors..."
export FDC_PREPARED_CSV="$prepared_csv"
run_labels_psql -v ON_ERROR_STOP=1 -f "apps/web/sql/foods/apply-prepared.sql"
unset FDC_PREPARED_CSV

echo "Imported PlasticList brand-site food anchors."
