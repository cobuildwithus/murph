#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

pnpm no-js

mode="both"
out_dir="$ROOT_DIR/audit-packages"
name="murph-review-gpt.protocol-target-snapshot"
protocol_slug="${MURPH_REVIEW_GPT_PROTOCOL_SLUG:-}"

normalize_protocol_alias() {
  printf '%s\n' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-(protocol|experiment|routine|page)$//'
}

resolve_protocol_slug() {
  local input="$1"
  local normalized_input path relative matches

  if [[ "$input" =~ ^[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*$ ]]; then
    path="packages/health-commons/content/protocols/${input}.md"
    if [[ -f "$path" ]]; then
      printf '%s\n' "$input"
      return 0
    fi
  fi

  normalized_input="$(normalize_protocol_alias "$input")"
  matches="$(
    find packages/health-commons/content/protocols -mindepth 2 -maxdepth 2 -type f -name '*.md' | sort | while IFS= read -r path; do
      relative="${path#packages/health-commons/content/protocols/}"
      relative="${relative%.md}"
      {
        printf '%s\n' "$relative"
        basename "$relative"
        sed -n -E 's/^[[:space:]]*slug:[[:space:]]*"protocols\/([^"]+)".*/\1/p; s/^[[:space:]]*title:[[:space:]]*"([^"]+)".*/\1/p; s/^[[:space:]]*-[[:space:]]*"([^"]+)".*/\1/p' "$path"
      } | while IFS= read -r candidate; do
        [[ -n "$candidate" ]] || continue
        if [[ "$(normalize_protocol_alias "$candidate")" == "$normalized_input" ]]; then
          printf '%s\n' "$relative"
          break
        fi
      done
    done | sort -u
  )"

  if [[ -z "$matches" ]]; then
    return 1
  fi
  if [[ "$(printf '%s\n' "$matches" | wc -l | tr -d ' ')" != "1" ]]; then
    echo "Ambiguous protocol slug '$input'; matching Health Commons protocol slugs:" >&2
    printf '%s\n' "$matches" >&2
    return 2
  fi
  printf '%s\n' "$matches"
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --zip)
      mode="zip"
      shift
      ;;
    --txt)
      mode="txt"
      shift
      ;;
    --both)
      mode="both"
      shift
      ;;
    --with-tests|--no-tests|--with-docs|--no-docs|--with-ci|--no-ci)
      # Compatibility with cobuild-review-gpt's standard package-script flags.
      # This target-aware package has an explicit include list, so these do not
      # change its scope.
      shift
      ;;
    --out-dir)
      [[ "$#" -ge 2 ]] || { echo "Missing value for --out-dir." >&2; exit 1; }
      out_dir="$2"
      shift 2
      ;;
    --out-dir=*)
      out_dir="${1#*=}"
      shift
      ;;
    --name)
      [[ "$#" -ge 2 ]] || { echo "Missing value for --name." >&2; exit 1; }
      name="$2"
      shift 2
      ;;
    --name=*)
      name="${1#*=}"
      shift
      ;;
    --protocol-slug)
      [[ "$#" -ge 2 ]] || { echo "Missing value for --protocol-slug." >&2; exit 1; }
      protocol_slug="$2"
      shift 2
      ;;
    --protocol-slug=*)
      protocol_slug="${1#*=}"
      shift
      ;;
    -*)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
    *)
      if [[ -n "$protocol_slug" ]]; then
        echo "Unexpected extra argument: $1" >&2
        exit 1
      fi
      protocol_slug="$1"
      shift
      ;;
  esac
done

if [[ -z "$protocol_slug" ]]; then
  echo "Missing protocol slug. Set MURPH_REVIEW_GPT_PROTOCOL_SLUG or pass --protocol-slug family/protocol-slug." >&2
  exit 1
fi

input_protocol_slug="$protocol_slug"
if ! resolved_protocol_slug="$(resolve_protocol_slug "$input_protocol_slug")"; then
  echo "Could not map '$input_protocol_slug' to a Health Commons protocol slug." >&2
  echo "Try a canonical slug like dry-sauna/murph-finnish-standard-3x-week." >&2
  exit 1
fi
protocol_slug="$resolved_protocol_slug"

protocol_path="packages/health-commons/content/protocols/${protocol_slug}.md"
if [[ ! -f "$protocol_path" ]]; then
  echo "Protocol page not found: $protocol_path" >&2
  exit 1
fi

family_slug="${protocol_slug%%/*}"
timestamp="$(date -u +%Y%m%d-%H%M%SZ)"
mkdir -p "$out_dir"
staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/murph-review-gpt-protocol.XXXXXX")"
include_list="$(mktemp "${TMPDIR:-/tmp}/murph-review-gpt-protocol-files.XXXXXX")"

cleanup() {
  rm -rf "$staging_dir"
  rm -f "$include_list"
}
trap cleanup EXIT

add_file() {
  local path="$1"
  [[ -f "$path" ]] || return 0
  printf '%s\n' "$path" >>"$include_list"
}

add_dir_files() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0
  find "$dir" -type f \
    ! -name '*.zip' \
    ! -name '*.pdf' \
    ! -name '*.jpg' \
    ! -name '*.jpeg' \
    ! -name '*.png' \
    ! -name '*.webp' \
    ! -name '*.gif' \
    ! -name '*.mp4' \
    ! -name '*.mov' \
    ! -name '*.heic' \
    | sort >>"$include_list"
}

add_research_context() {
  local ledger_path workspace_dir downloads_dir
  ledger_path="$(sed -n 's/^[[:space:]]*canonicalLedgerPath:[[:space:]]*"\([^"]*\)".*/\1/p' "$protocol_path" | head -1)"
  [[ -n "$ledger_path" ]] || return 0
  [[ "$ledger_path" == output-packages/research/* ]] || return 0

  add_file "$ledger_path"
  add_file "${ledger_path%/*}/source_extraction_batches_v1.json"

  workspace_dir="${ledger_path#output-packages/research/}"
  workspace_dir="output-packages/research/${workspace_dir%%/*}"
  [[ -d "$workspace_dir" ]] || return 0

  add_file "$workspace_dir/workflow.json"
  downloads_dir="$workspace_dir/downloads"
  [[ -d "$downloads_dir" ]] || return 0

  find "$downloads_dir" -maxdepth 3 -type f \( \
    -name 'assistant-response.md' \
    -o -name 'canonical_source_ledger_v1.json' \
    -o -name 'source_extraction_batches_v1.json' \
    -o -name '*source-ledger*.json' \
    -o -name '*evidence-appraisals.jsonl' \
    -o -name '*artifact-manifest.json' \
    -o -name '*file-manifest.md' \
    -o -name '*FILE_MANIFEST.md' \
    -o -name '*SOURCE_PAGES_STATUS.md' \
    -o -name '*NON_CLAIMS.md' \
    -o -name '*verification-checklist.md' \
    -o -name '*punchlist.md' \
  \) | sort >>"$include_list"
}

add_file ".dockerignore"
add_file ".gitignore"
add_file "AGENTS.md"
add_file "ARCHITECTURE.md"
add_file "README.md"
add_file "package.json"
add_file "pnpm-workspace.yaml"
add_file "agent-docs/index.md"
add_file "agent-docs/PRODUCT_SENSE.md"
add_file "agent-docs/PRODUCT_CONSTITUTION.md"
add_file "agent-docs/product-specs/health-commons.md"
add_file "agent-docs/product-specs/protocol-outcome-network.md"
add_file "agent-docs/operations/agent-workflow-routing.md"
add_file "agent-docs/operations/verification-and-runtime.md"
add_file "packages/contracts/src/health-commons.ts"
add_file "packages/health-commons/README.md"
add_file "packages/health-commons/package.json"
add_file "packages/health-commons/src/load.ts"
add_file "packages/health-commons/src/index.ts"
add_file "apps/web/src/lib/health-commons/experiment-detail-biomarkers.ts"
add_file "apps/web/src/lib/health-commons/experiment-detail.ts"
add_file "apps/web/src/components/experiments/experiment-detail/expected-signal-card.tsx"
add_file "$protocol_path"
add_file "packages/health-commons/content/families/${family_slug}.md"
add_file "packages/health-commons/content/artifacts/${family_slug}/research-artifacts.json"
add_file "packages/health-commons/content/evidence-appraisals/source-protocol-evidence/${family_slug}.jsonl"
add_file "packages/health-commons/content/redirects.json"

while IFS= read -r family_key; do
  add_file "packages/health-commons/content/families/${family_key}.md"
done < <(grep -Eoh 'experiment_family:[a-z0-9._-]+' "$protocol_path" | sed 's/^experiment_family://' | sort -u)

while IFS= read -r biomarker_key; do
  add_file "packages/health-commons/content/biomarkers/${biomarker_key}.md"
done < <(grep -Eoh 'biomarker:[a-z0-9._-]+' "$protocol_path" | sed 's/^biomarker://' | sort -u)

add_dir_files "packages/health-commons/content/sources/${family_slug}"
add_dir_files "packages/health-commons/content/protocols/${family_slug}"
add_research_context

sort -u "$include_list" | while IFS= read -r path; do
  [[ -n "$path" ]] || continue
  mkdir -p "$staging_dir/$(dirname "$path")"
  cp -p "$path" "$staging_dir/$path"
done

cat >"$staging_dir/REVIEW_CONTEXT.md" <<EOF
# Review GPT Protocol Context

Target protocol slug: \`${protocol_slug}\`

Start here:

- \`${protocol_path}\`
- \`packages/health-commons/content/sources/${family_slug}/\`
- \`packages/health-commons/content/evidence-appraisals/source-protocol-evidence/${family_slug}.jsonl\`

Use this package as a focused protocol-edit snapshot. Avoid broad repo scans unless a listed file points to a specific missing dependency. Edit only protocol-relevant authored source files. Do not edit generated Health Commons catalog files.
EOF

included_count="$(find "$staging_dir" -type f | wc -l | tr -d ' ')"
base_path="$out_dir/${name}-${timestamp}"
zip_path="${base_path}.zip"
txt_path="${base_path}.txt"

if [[ "$mode" == "zip" || "$mode" == "both" ]]; then
  rm -f "$zip_path"
  (cd "$staging_dir" && zip -qr "$zip_path" .)
fi

if [[ "$mode" == "txt" || "$mode" == "both" ]]; then
  rm -f "$txt_path"
  (
    cd "$staging_dir"
    find . -type f | sed 's#^\./##' | sort | while IFS= read -r path; do
      printf '\n===== %s =====\n\n' "$path"
      sed -n '1,20000p' "$path"
    done
  ) >"$txt_path"
fi

echo "Protocol audit package created."
echo "Protocol slug: $protocol_slug"
echo "Included files: $included_count"
if [[ "$mode" == "zip" || "$mode" == "both" ]]; then
  echo "ZIP: $zip_path ($(du -h "$zip_path" | awk '{print $1}'))"
fi
if [[ "$mode" == "txt" || "$mode" == "both" ]]; then
  echo "TXT: $txt_path ($(du -h "$txt_path" | awk '{print $1}'))"
fi
