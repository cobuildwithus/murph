#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat >&2 <<'USAGE'
Usage:
  pnpm research "topic"
  pnpm research --topic "topic" [options]

Options:
  --topic <text>       Research topic. You can also pass this as the first positional argument.
  --family <slug>      Health Commons family/path bucket. Defaults to the derived topic slug.
  --slug <slug>        Protocol/page slug. Defaults to the derived topic slug.
  --turns <4|5>        Number of research passes. Defaults to 4.
  --chat-url <url>     Resume an existing ChatGPT thread instead of starting a new one.
  --out-dir <dir>      Output directory. Defaults to output-packages/research/<slug>-<timestamp>.
  -h, --help           Show this help text.

Environment:
  RESEARCH_MODEL           Defaults to gpt-5.4-pro
  RESEARCH_THINKING        Defaults to extended
  RESEARCH_WAIT_TIMEOUT    Defaults to 45m
  RESEARCH_TIMEOUT         Defaults to 60m
  RESEARCH_ARTIFACT_LIMIT  Defaults to 6 downloaded artifacts per pass
USAGE
  exit "${1:-2}"
}

slugify() {
  node -e '
    const input = String(process.argv[1] ?? "");
    const slug = input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-");
    process.stdout.write(slug || "research-topic");
  ' "$1"
}

json_field() {
  node - "$1" "$2" <<'NODE'
const fs = require("node:fs");

const [filePath, fieldName] = process.argv.slice(2);
const raw = fs.readFileSync(filePath, "utf8");
const start = raw.indexOf("{");
const end = raw.lastIndexOf("}");

if (start < 0 || end < start) {
  process.exit(1);
}

const data = JSON.parse(raw.slice(start, end + 1));
const value = data[fieldName];

if (value === undefined || value === null) {
  process.exit(0);
}

process.stdout.write(String(value));
NODE
}

topic=""
family=""
slug=""
turns="4"
chat_url=""
out_dir=""

model="${RESEARCH_MODEL:-gpt-5.4-pro}"
thinking="${RESEARCH_THINKING:-extended}"
wait_timeout="${RESEARCH_WAIT_TIMEOUT:-45m}"
timeout="${RESEARCH_TIMEOUT:-60m}"
artifact_limit="${RESEARCH_ARTIFACT_LIMIT:-6}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --topic)
      topic="${2:-}"
      shift 2
      ;;
    --family)
      family="${2:-}"
      shift 2
      ;;
    --slug)
      slug="${2:-}"
      shift 2
      ;;
    --turns)
      turns="${2:-}"
      shift 2
      ;;
    --chat-url)
      chat_url="${2:-}"
      shift 2
      ;;
    --out-dir)
      out_dir="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage 0
      ;;
    --*)
      echo "Unknown option: $1" >&2
      usage 2
      ;;
    *)
      if [[ -z "$topic" ]]; then
        topic="$1"
        shift
      else
        echo "Unexpected extra argument: $1" >&2
        usage 2
      fi
      ;;
  esac
done

[[ -n "$topic" ]] || {
  echo "Missing research topic." >&2
  usage 2
}

[[ "$turns" == "4" || "$turns" == "5" ]] || {
  echo "--turns must be 4 or 5." >&2
  exit 2
}

derived_slug="$(slugify "$topic")"
[[ -n "$slug" ]] || slug="$derived_slug"
[[ -n "$family" ]] || family="$slug"

timestamp="$(date -u '+%Y%m%d-%H%M%SZ')"

if [[ -z "$out_dir" ]]; then
  out_dir="output-packages/research/${slug}-${timestamp}"
fi

mkdir -p "$out_dir/prompts" "$out_dir/responses" "$out_dir/logs" "$out_dir/exports" "$out_dir/downloads"

protocol_path="packages/health-commons/content/protocols/${family}/${slug}.md"
source_dir="packages/health-commons/content/sources/${family}"
artifact_manifest_path="packages/health-commons/content/artifacts/${family}/research-artifacts.json"
bibliography_path="${source_dir}/${slug}-bibliography.md"
corpus_json_path="${out_dir}/protocol-research-corpus.json"
pdf_manifest_path="${out_dir}/pdf-download-manifest.json"
download_script_path="${out_dir}/download-open-access-pdfs.sh"

example_protocol_path="packages/health-commons/content/protocols/dry-sauna/murph-finnish-standard-3x-week.md"
example_artifact_manifest_path="packages/health-commons/content/artifacts/sauna/research-artifacts.json"

write_prompt_1() {
  cat > "$out_dir/prompts/01-discovery.md" <<EOF
You are doing pass 1 of a Murph Health Commons research workflow.

TOPIC:
${topic}

TARGET SHAPE:
- Protocol page path: ${protocol_path}
- Source directory: ${source_dir}
- Artifact manifest path: ${artifact_manifest_path}
- Bibliography page path: ${bibliography_path}

STYLE REFERENCES ALREADY IN THE REPO:
- ${example_protocol_path}
- ${example_artifact_manifest_path}

PASS 1 GOAL:
Build the broadest defensible research corpus for this topic. Do not write the final protocol page yet. Maximize recall first, especially peer-reviewed and guideline-level evidence, then rank what matters for a bounded self-experiment.

SEARCH REQUIREMENTS:
1. Search peer-reviewed and guideline sources first: PubMed/MEDLINE, PMC, Crossref/DOI pages, clinical guidelines, major journals, and credible review venues.
2. Expand synonyms, mechanisms, common user phrasing, safety terms, contraindications, timing variants, and wearable-measurable endpoints.
3. Separate human intervention evidence from observational, mechanistic, animal, in vitro, preprint, and commentary evidence.
4. Capture null findings, mixed findings, adverse events, and population mismatch early rather than hiding them for later.
5. Prefer records with DOI, PMID, PMCID, usable abstract/full text, intervention dose, duration, and endpoints.

OUTPUT CONTRACT:

## Search strategy
- Databases and source classes searched.
- Exact search phrases used or recommended.
- Inclusion and exclusion criteria.
- Blind spots still left open.

## Corpus JSON
Return one fenced JSON block named CORPUS_JSON_V1 with this shape:

{
  "topic": "...",
  "generatedAt": "<ISO timestamp>",
  "records": [
    {
      "sourceKey": "source_artifact:<stable-id>",
      "title": "...",
      "authors": ["..."],
      "year": 2024,
      "journal": "...",
      "doi": "... or null",
      "pmid": "... or null",
      "pmcid": "... or null",
      "url": "...",
      "studyDesign": "systematic-review | meta-analysis | rct | cohort | crossover | acute-physiology | guideline | narrative-review | mechanistic | other",
      "population": "...",
      "sampleSize": "...",
      "intervention": {
        "modality": "...",
        "dose": "...",
        "duration": "...",
        "frequency": "..."
      },
      "endpoints": ["..."],
      "findings": ["..."],
      "limitations": ["..."],
      "safetyNotes": ["..."],
      "relevanceToMurph": "high | medium | low",
      "priority": "backbone | shortlist | supporting | exclude",
      "evidenceBucket": "...",
      "openAccessPdfUrl": "... or null",
      "pdfRightsStatus": "open_access | public_domain | free_to_read_not_redistributable | permission_required | paywalled | unknown",
      "citation": "..."
    }
  ]
}

## Shortlist
Rank the top 20-40 records and say why they matter for Murph.

## Missing data
List the endpoints, populations, or variants that pass 2 should target.

PDF RULE:
Only surface open-access or clearly redistributable PDFs as downloadable artifacts. For everything else, return metadata and links only.
EOF
}

write_prompt_2() {
  cat > "$out_dir/prompts/02-gap-fill.md" <<EOF
You are doing pass 2 of the same Murph Health Commons research workflow.

TOPIC:
${topic}

Use the previous pass in this same thread as the starting corpus.

PASS 2 GOAL:
Act adversarially. Find what pass 1 missed, fix bad metadata, separate variants that should not be merged, and identify the smallest evidence-backed protocol recipe Murph could test without overclaiming.

TASKS:
1. Backward and forward citation chase from the backbone papers.
2. Search for negative or null findings, safety issues, contraindications, dose-response uncertainty, and population mismatch.
3. Split out adjacent variants that should probably become separate Murph pages instead of one merged page.
4. Dedupe by DOI, PMID, PMCID, title, and trial registration where possible.
5. Mark records that should not support a Murph protocol claim.

OUTPUT CONTRACT:

## Additions and corrections
- New records.
- Removed or downgraded records.
- Metadata fixes.
- Contradictions and uncertainty.

## Refined Corpus JSON
Return one fenced JSON block named REFINED_CORPUS_JSON_V1 with the same schema as pass 1 plus:
- "dedupeGroupId"
- "claimUse": "supports-protocol | context-only | safety-only | do-not-use"
- "sourcePageNeeded": true/false
- "artifactNeeded": true/false

## Evidence map
Group the refined corpus into:
- evidence backbone
- protocol dose and design
- wearable or testable endpoints
- safety and contraindications
- adjacent variants to split
- context-only rationale

## Protocol implications
Do not write the final page yet. State what Murph should probably test, what it should not claim, and what it should measure.

PDF RULE:
Only mark a PDF as downloadable when it is clearly open access or public domain.
EOF
}

write_prompt_3() {
  cat > "$out_dir/prompts/03-synthesis.md" <<EOF
You are doing pass 3 of the Murph Health Commons research workflow.

TOPIC:
${topic}

Use the earlier thread context and the refined corpus from pass 2. Now synthesize into Murph-shaped content, but do not produce the final patch yet.

TARGET SHAPE:
- Protocol page path: ${protocol_path}
- Source pages directory: ${source_dir}
- Artifact manifest path: ${artifact_manifest_path}
- Bibliography page path: ${bibliography_path}

PASS 3 GOAL:
Draft the actual Murph protocol/source structure in the same style as the Health Commons examples already in this repo.

CONTENT REQUIREMENTS:
1. The protocol must be a bounded self-experiment, not a permanent lifestyle prescription.
2. Include:
   - summary
   - protocol recipe
   - baseline and intervention duration
   - primary biomarker
   - secondary or exploratory biomarkers
   - adherence target
   - stop conditions
   - contraindications / ask-clinician-first notes
   - confounders to log
   - expected signal and latency
   - claim list with sourceKeys
   - caveats and non-claims
3. Separate causal intervention evidence, observational context, mechanistic plausibility, and safety evidence.
4. Draft source pages for the highest-priority records using the repo's Health Commons source_artifact style.
5. Draft a bibliography page and artifact-manifest plan.

OUTPUT CONTRACT:

## Protocol design summary
Concise explanation of what should land and why.

## Files to create or update
Table of paths and purpose.

## Draft protocol page
Complete markdown draft for ${protocol_path}.

## Draft source page template
One full example source_artifact page plus rules for the rest.

## Draft bibliography page
Complete bibliography draft for ${bibliography_path}.

## Artifact manifest plan
Manifest-ready JSON entries using:
- rightsStatus
- redistributable
- localPath
- sourceUrl
- sha256 only when a real downloadable PDF is actually available
EOF
}

write_prompt_4() {
  cat > "$out_dir/prompts/04-landing.md" <<EOF
You are doing pass 4, the landing pass, for the Murph Health Commons research workflow.

TOPIC:
${topic}

Use the previous thread context. Produce an implementation-ready landing package.

TARGET SHAPE:
- Protocol page path: ${protocol_path}
- Source pages directory: ${source_dir}
- Artifact manifest path: ${artifact_manifest_path}
- Bibliography page path: ${bibliography_path}
- Corpus JSON path: ${corpus_json_path}
- PDF manifest path: ${pdf_manifest_path}
- Download script path: ${download_script_path}

PASS 4 GOAL:
Return a patch over the repo plus the machine-readable research artifacts Murph would need locally.

REQUIRED OUTPUTS:
1. A unified diff that creates or updates:
   - the protocol page
   - the bibliography page
   - the highest-priority source_artifact pages
   - the artifact manifest JSON
2. A machine-readable corpus JSON draft for ${corpus_json_path}
3. A machine-readable PDF manifest draft for ${pdf_manifest_path}
4. A downloader shell script draft for ${download_script_path}
5. A verification checklist

STRICT RULES:
- No material claim without sourceKeys.
- Do not imply long-term disease-outcome causality from a short-term self-experiment.
- Do not include copyrighted PDFs unless they are clearly open access or public domain.
- Do not invent DOI, PMID, PMCID, journals, sample sizes, or effect sizes.

PATCH FORMAT:
Include the unified diff in a fenced diff block even if you also attach files.
EOF
}

write_prompt_5() {
  cat > "$out_dir/prompts/05-final-audit.md" <<EOF
You are doing optional pass 5, a skeptical final audit.

TOPIC:
${topic}

Use the earlier thread context and review the landing package as if you are blocking merge until unsupported claims, missing safety notes, and repo-shape errors are fixed.

AUDIT TASKS:
1. Identify unsupported or overstated claims.
2. Identify missing contraindications, stop conditions, or confounders.
3. Identify weak sourceKeys that should be downgraded or removed.
4. Check that the landing package matches the existing Health Commons page and artifact patterns.
5. Check that the PDF plan is rights-safe.
6. Return a revised patch only if something materially changes.

OUTPUT:
- Blockers
- Non-blocking improvements
- Revised patch if required
- Final artifact-manifest corrections
- Final verification checklist
EOF
}

write_prompt_1
write_prompt_2
write_prompt_3
write_prompt_4
write_prompt_5

download_turn_artifacts() {
  local turn="$1"
  local export_output="$out_dir/exports/${turn}.thread.json"
  local export_log="$out_dir/logs/${turn}.thread-export.log"
  local turn_download_dir="$out_dir/downloads/${turn}"

  mkdir -p "$turn_download_dir"

  set +e
  pnpm review:gpt thread export \
    --chat-url "$chat_url" \
    --output "$export_output" \
    --format json \
    >"$export_log" 2>&1
  local export_status=$?
  set -e

  if [[ "$export_status" -ne 0 ]]; then
    return 0
  fi

  local idx=0

  while [[ "$idx" -lt "$artifact_limit" ]]; do
    local artifact_dir="$turn_download_dir/artifact-${idx}"
    local artifact_log="$out_dir/logs/${turn}.artifact-${idx}.log"
    mkdir -p "$artifact_dir"

    set +e
    pnpm review:gpt thread download \
      --chat-url "$chat_url" \
      --artifact-index "$idx" \
      --output-dir "$artifact_dir" \
      --format json \
      >"$artifact_log" 2>&1
    local artifact_status=$?
    set -e

    if [[ "$artifact_status" -ne 0 ]]; then
      rm -rf "$artifact_dir"
    fi

    idx=$((idx + 1))
  done
}

run_turn() {
  local turn="$1"
  local label="$2"
  local prompt_file="$out_dir/prompts/${turn}-${label}.md"
  local response_file="$out_dir/responses/${turn}-${label}.md"
  local result_file="$out_dir/logs/${turn}-${label}.result.json"
  local stderr_file="$out_dir/logs/${turn}-${label}.stderr.log"

  local -a args=(
    pnpm review:gpt
    --format json
    --prompt-file "$prompt_file"
    --response-file "$response_file"
    --model "$model"
    --thinking "$thinking"
    --wait
    --wait-timeout "$wait_timeout"
    --timeout "$timeout"
  )

  if [[ -n "$chat_url" ]]; then
    args+=(--chat-url "$chat_url")
  fi

  echo
  echo "=== Running pass ${turn}: ${label} ==="

  set +e
  "${args[@]}" >"$result_file" 2>"$stderr_file"
  local status=$?
  set -e

  if [[ "$status" -ne 0 ]]; then
    cat "$stderr_file" >&2
    echo "Pass ${turn} failed. See ${stderr_file}" >&2
    exit "$status"
  fi

  local next_chat_url
  next_chat_url="$(json_field "$result_file" chatUrl || true)"

  if [[ -n "$next_chat_url" ]]; then
    chat_url="$next_chat_url"
    printf '%s\n' "$chat_url" > "$out_dir/chat-url.txt"
  fi

  if [[ -z "$chat_url" ]]; then
    echo "Failed to capture a ChatGPT thread URL for pass ${turn}." >&2
    exit 1
  fi

  download_turn_artifacts "$turn"
}

run_turn "01" "discovery"
run_turn "02" "gap-fill"
run_turn "03" "synthesis"
run_turn "04" "landing"

if [[ "$turns" == "5" ]]; then
  run_turn "05" "final-audit"
fi

echo
echo "Research workflow complete."
echo "Thread URL: $chat_url"
echo "Output dir: $out_dir"
