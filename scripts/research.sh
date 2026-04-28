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
  --start-turn <1-5>   Resume from a specific pass. Defaults to 1.
  --chat-url <url>     Resume an existing ChatGPT thread instead of starting a new one.
  --out-dir <dir>      Output directory. Defaults to output-packages/research/<slug>-<timestamp>.
  --smoke-test         Use trivial artifact-return prompts for end-to-end workflow validation.
  -h, --help           Show this help text.

Environment:
  RESEARCH_MODEL           Defaults to gpt-5.4-pro
  RESEARCH_THINKING        Defaults to current
  RESEARCH_WAIT_TIMEOUT    Defaults to 45m
  RESEARCH_TIMEOUT         Defaults to 60m
  RESEARCH_ARTIFACT_LIMIT  Defaults to 6 downloaded artifacts per pass

Notes:
  The final landing-producing pass uses `thread wake` when CODEX_THREAD_ID is available.
  4-turn runs wake after pass 4.
  5-turn runs wake after pass 4 and use one recursive same-thread audit/fix cycle.
  If CODEX_THREAD_ID is unavailable, 5-turn runs fall back to the explicit pass-5 send.
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

extract_chat_url() {
  local result_file="$1"
  local chat_url_line=""

  chat_url_line="$(
    grep -E 'ChatGPT (thread|conversation) URL: https://chatgpt\.com/c/' "$result_file" \
      | tail -n 1 \
      | sed -E 's/^.*URL: (https:\/\/chatgpt\.com\/c\/[^[:space:]]+).*$/\1/'
  )"

  if [[ -n "$chat_url_line" ]]; then
    printf '%s' "$chat_url_line"
    return 0
  fi

  node - "$result_file" <<'NODE'
const fs = require("node:fs");

const [filePath] = process.argv.slice(2);
const raw = fs.readFileSync(filePath, "utf8");
const matches = [...raw.matchAll(/https:\/\/chatgpt\.com\/c\/[^\s"'`]+/g)];

if (matches.length === 0) {
  process.exit(1);
}

process.stdout.write(matches[matches.length - 1][0]);
NODE
}

count_downloaded_files() {
  local search_dir="$1"

  find "$search_dir" -type f ! -name '.gitkeep' 2>/dev/null | wc -l | tr -d '[:space:]'
}

uses_recursive_final_audit() {
  [[ "$smoke_test" != "1" && "$turns" == "5" && -n "${CODEX_THREAD_ID:-}" ]]
}

is_final_landing_pass() {
  local turn="$1"

  if [[ "$smoke_test" == "1" ]]; then
    return 1
  fi

  if uses_recursive_final_audit; then
    [[ "$turn" == "04" ]]
    return
  fi

  if [[ "$turns" == "5" ]]; then
    [[ "$turn" == "05" ]]
    return
  fi

  [[ "$turn" == "04" ]]
}

topic=""
family=""
slug=""
turns="4"
start_turn="1"
chat_url=""
out_dir=""
smoke_test=0

model="${RESEARCH_MODEL:-gpt-5.4-pro}"
thinking="${RESEARCH_THINKING:-current}"
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
    --start-turn)
      start_turn="${2:-}"
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
    --smoke-test)
      smoke_test=1
      shift
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

case "$start_turn" in
  1|2|3|4|5) ;;
  *)
    echo "--start-turn must be between 1 and 5." >&2
    exit 2
    ;;
esac

if (( start_turn > turns )); then
  echo "--start-turn cannot be greater than --turns." >&2
  exit 2
fi

if (( start_turn > 1 )) && [[ -z "$chat_url" ]]; then
  echo "--start-turn greater than 1 requires --chat-url." >&2
  exit 2
fi

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

write_smoke_prompt() {
  local turn="$1"
  local label="$2"
  local prompt_path="$out_dir/prompts/${turn}-${label}.md"
  local artifact_name="smoke-${turn}-${label}.patch"
  local target_file="smoke-${turn}-${label}.txt"
  local artifact_body
  artifact_body="$(cat <<EOF
diff --git a/${target_file} b/${target_file}
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/${target_file}
@@ -0,0 +1 @@
+smoke ${turn} ok
EOF
)"

  cat > "$prompt_path" <<EOF
This is a workflow smoke test running on ChatGPT Pro at chatgpt.com.

Return immediately.

Required outputs:
1. Attach exactly one small patch file named ${artifact_name}
2. The full contents of that file must be exactly this unified diff:
${artifact_body}
3. In the chat response, write exactly:
attached ${artifact_name}
4. The file must be a real downloadable assistant attachment or behavior-button artifact.
5. A plain-text claim that a file is attached does not count.
6. Do not inline the patch in the chat body instead of attaching it.

Do not browse, search, think aloud, or add anything else.
EOF
}

write_prompt_1() {
  if [[ "$smoke_test" == "1" ]]; then
    write_smoke_prompt "01" "discovery"
    return
  fi

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
  if [[ "$smoke_test" == "1" ]]; then
    write_smoke_prompt "02" "gap-fill"
    return
  fi

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
  if [[ "$smoke_test" == "1" ]]; then
    write_smoke_prompt "03" "synthesis"
    return
  fi

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
   - keep `sourceKeys` in structured claim lists only; do not append raw `source_artifact:*` keys or `Source keys:` labels to drafted user-facing Health Commons prose, including protocol, family, biomarker, and bibliography prose
   - write the protocol frontmatter `summary` as `/experiments` card copy: describe the action/outcome/safety posture without repeating duration, frequency, session count, or dose timing already shown in protocol metadata
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
  if [[ "$smoke_test" == "1" ]]; then
    write_smoke_prompt "04" "landing"
    return
  fi

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
- Source keys belong in structured metadata or claim lists, not in user-facing Markdown body prose.
- Remove raw `source_artifact:*`, `sourceKeys`, and `Source keys:` dumps from all user-facing Health Commons copy, including protocol, family, and biomarker prose; use readable study/source references if attribution is needed.
- Treat the protocol frontmatter `summary` as `/experiments` card copy; do not repeat duration, frequency, session count, or dose timing that is already represented by protocol metadata.
- Do not imply long-term disease-outcome causality from a short-term self-experiment.
- Do not include copyrighted PDFs unless they are clearly open access or public domain.
- Do not invent DOI, PMID, PMCID, journals, sample sizes, or effect sizes.

PATCH FORMAT:
Include the unified diff in a fenced diff block even if you also attach files.
EOF
}

write_prompt_5() {
  if [[ "$smoke_test" == "1" ]]; then
    write_smoke_prompt "05" "final-audit"
    return
  fi

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
6. Block raw `source_artifact:*`, `sourceKeys`, or `Source keys:` leaks in user-facing Markdown body prose while preserving structured source-key fields.
7. Return a revised patch only if something materially changes.

OUTPUT:
- Blockers
- Non-blocking improvements
- Revised patch if required
- Final artifact-manifest corrections
- Final verification checklist

If you propose code changes, attach them as a .patch or .diff artifact instead of only describing them in prose.
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
  local downloaded_file_count="0"

  last_download_target_count="0"

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

  downloaded_file_count="$(count_downloaded_files "$turn_download_dir")"
  last_download_target_count="$downloaded_file_count"

  if [[ "$downloaded_file_count" == "0" ]]; then
    printf 'No downloadable assistant artifacts were captured for pass %s.\n' "$turn" \
      >"$out_dir/logs/${turn}.download-skip.log"
  fi
}

wake_final_turn() {
  local turn="$1"
  local label="$2"
  local wake_dir="$out_dir/wake/${turn}-${label}"
  local wake_result="$out_dir/logs/${turn}-${label}.wake.json"
  local wake_stderr="$out_dir/logs/${turn}-${label}.wake.stderr.log"
  local resume_prompt="This wake came from research pass ${turn} (${label}) for topic: ${topic}. If a returned patch or diff was downloaded, inspect it, apply it locally if valid, run the repo-required verification for the touched slice, and land the patch. If no returned patch exists, report that clearly and stop. Watched thread: {{chat_url}}."
  local -a wake_args
  local recursive_prompt=""

  if [[ -z "${CODEX_THREAD_ID:-}" ]]; then
    echo "Final pass ${turn} completed, but CODEX_THREAD_ID is not set. Falling back to download-only artifact capture." >&2
    download_turn_artifacts "$turn"
    return
  fi

  mkdir -p "$wake_dir"

  wake_args=(
    pnpm chatgpt:thread:wake
    --delay 0s
    --chat-url "$chat_url"
    --session-id "$CODEX_THREAD_ID"
    --repo-dir "$ROOT_DIR"
    --output-dir "$wake_dir"
    --resume-prompt "$resume_prompt"
  )

  if uses_recursive_final_audit; then
    recursive_prompt="$(cat "$out_dir/prompts/05-final-audit.md")"
    wake_args+=(--recursive-depth 1 --recursive-prompt "$recursive_prompt")
  fi

  set +e
  "${wake_args[@]}" >"$wake_result" 2>"$wake_stderr"
  local wake_status=$?
  set -e

  if [[ "$wake_status" -ne 0 ]]; then
    cat "$wake_stderr" >&2
    echo "Final-pass thread wake failed for pass ${turn}. See ${wake_stderr}" >&2
    exit "$wake_status"
  fi
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
    --wait
    --wait-timeout "$wait_timeout"
    --timeout "$timeout"
  )

  if [[ -n "$thinking" && "$thinking" != "current" ]]; then
    args+=(--thinking "$thinking")
  fi

  if [[ -n "$chat_url" ]]; then
    args+=(--chat-url "$chat_url")
  fi

  echo
  echo "=== Running pass ${turn}: ${label} ==="

  set +e
  "${args[@]}" >"$result_file" 2>"$stderr_file"
  local status=$?
  set -e

  local next_chat_url
  next_chat_url="$(extract_chat_url "$result_file" || true)"

  if [[ -n "$next_chat_url" ]]; then
    chat_url="$next_chat_url"
    printf '%s\n' "$chat_url" > "$out_dir/chat-url.txt"
  fi

  if [[ "$status" -ne 0 ]]; then
    if [[ -n "$chat_url" ]]; then
      download_turn_artifacts "$turn"
    fi
    cat "$stderr_file" >&2
    echo "Pass ${turn} failed. See ${stderr_file}" >&2
    exit "$status"
  fi

  if [[ -z "$chat_url" ]]; then
    echo "Failed to capture a ChatGPT thread URL for pass ${turn}." >&2
    exit 1
  fi

  if is_final_landing_pass "$turn"; then
    wake_final_turn "$turn" "$label"
    return
  fi

  download_turn_artifacts "$turn"

  if [[ "$smoke_test" == "1" && "$last_download_target_count" == "0" ]]; then
    echo "Smoke-test pass ${turn} did not produce a downloadable assistant artifact." >&2
    exit 1
  fi
}

if (( start_turn <= 1 )); then
  run_turn "01" "discovery"
fi

if (( start_turn <= 2 )) && (( turns >= 2 )); then
  run_turn "02" "gap-fill"
fi

if (( start_turn <= 3 )) && (( turns >= 3 )); then
  run_turn "03" "synthesis"
fi

if (( start_turn <= 4 )) && (( turns >= 4 )); then
  run_turn "04" "landing"
fi

if uses_recursive_final_audit && [[ "$turns" == "5" ]] && (( start_turn == 5 )); then
  if [[ -z "$chat_url" ]]; then
    echo "Recursive audit wake requires --chat-url when resuming at turn 5." >&2
    exit 1
  fi
  wake_final_turn "04" "landing"
fi

if ! uses_recursive_final_audit && [[ "$turns" == "5" ]] && (( start_turn <= 5 )); then
  run_turn "05" "final-audit"
fi

echo
echo "Research workflow complete."
echo "Thread URL: $chat_url"
echo "Output dir: $out_dir"
