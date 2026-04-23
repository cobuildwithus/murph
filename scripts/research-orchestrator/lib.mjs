import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ORCHESTRATOR_SCHEMA_VERSION = "murph.research.orchestrator.init.v1";

const libPath = fileURLToPath(import.meta.url);
export const orchestratorDir = path.dirname(libPath);
export const scriptDir = path.resolve(orchestratorDir, "..");
export const repoRoot = path.resolve(scriptDir, "..");
export const promptTemplateDir = path.join(orchestratorDir, "prompts");
export const researchOutputRoot = path.join(repoRoot, "output-packages", "research");
export const SOURCE_LEDGER_REDUCER_LABEL = "11-source-ledger-reducer";
export const PAGE_BUILDER_LABEL = "30-page-builder";

export const RESEARCH_REFERENCE_FILE_PATHS = [
  "agent-docs/product-specs/health-commons.md",
  "agent-docs/product-specs/experiment-onboarding.md",
  "packages/contracts/src/health-commons.ts",
  "packages/health-commons/content/protocols/red-light-glasses-before-bed/red-light-glasses-before-bed.md",
  "packages/health-commons/content/protocols/sauna-protocol.md",
  "packages/health-commons/content/protocols/norwegian-4x4/norwegian-4x4.md",
  "packages/health-commons/content/protocols/dry-sauna/murph-finnish-standard-3x-week.md",
  "packages/health-commons/content/protocols/dry-sauna/bryan-johnson-blueprint.md",
  "packages/health-commons/content/families/norwegian-4x4.md",
  "packages/health-commons/content/families/infrared-sauna.md",
  "packages/health-commons/content/families/evening-light-reduction.md",
  "packages/health-commons/content/families/sauna.md",
  "packages/health-commons/content/families/dry-sauna.md",
  "packages/health-commons/content/biomarkers/estimated-vo2max.md",
  "packages/health-commons/content/biomarkers/sleep-efficiency.md",
  "packages/health-commons/content/biomarkers/deep-sleep-minutes.md",
  "packages/health-commons/content/biomarkers/resting-heart-rate.md",
  "packages/health-commons/content/biomarkers/hrv-rmssd.md",
  "packages/health-commons/content/biomarkers/morning-blood-pressure.md",
  "packages/health-commons/content/biomarkers/sleep-onset-latency.md",
  "packages/health-commons/content/sources/red-light-glasses-before-bed/red-light-glasses-before-bed-bibliography.md",
  "packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-33707105.md",
  "packages/health-commons/content/sources/norwegian-4x4/norwegian-4x4-bibliography.md",
  "packages/health-commons/content/sources/norwegian-4x4/pmid-30293954.md",
  "packages/health-commons/content/sources/sauna/sauna-bibliography-2026-04-18.md",
  "packages/health-commons/content/sources/sauna/pmid-24304490.md",
  "packages/health-commons/content/artifacts/norwegian-4x4/research-artifacts.json",
  "packages/health-commons/content/artifacts/red-light-glasses-before-bed/research-artifacts.json",
  "packages/health-commons/content/artifacts/sauna/research-artifacts.json",
];

export function slugify(input) {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function toTitleCase(input) {
  return String(input ?? "")
    .trim()
    .split(/[^a-zA-Z0-9]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function formatDirTimestamp(date) {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}Z`;
}

export function toPosixRelative(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join(path.posix.sep);
}

export function ensureRepoLocalOutputDir(outDir) {
  const relativePath = path.relative(repoRoot, outDir);
  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("--out-dir must point to a directory inside this repo.");
  }

  const outputRootRelative = toPosixRelative(researchOutputRoot);
  const outDirRelative = relativePath.split(path.sep).join(path.posix.sep);

  if (
    outDirRelative === outputRootRelative ||
    !outDirRelative.startsWith(`${outputRootRelative}/`)
  ) {
    throw new Error(
      "--out-dir must point to a directory under output-packages/research/ inside this repo.",
    );
  }
}

export function isExistingScaffoldDir(outDir) {
  const workflowPath = path.join(outDir, "workflow.json");

  if (!existsSync(workflowPath)) {
    return false;
  }

  try {
    const workflow = JSON.parse(readFileSync(workflowPath, "utf8"));
    return workflow?.schemaVersion === ORCHESTRATOR_SCHEMA_VERSION;
  } catch {
    return false;
  }
}

export function readWorkflow(workspaceDir) {
  const workflowPath = path.join(workspaceDir, "workflow.json");
  if (!existsSync(workflowPath)) {
    throw new Error(`Missing workflow.json in ${toPosixRelative(workspaceDir)}`);
  }

  const workflow = JSON.parse(readFileSync(workflowPath, "utf8"));
  if (workflow?.schemaVersion !== ORCHESTRATOR_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported workflow schema in ${toPosixRelative(workflowPath)}: ${String(workflow?.schemaVersion ?? "unknown")}`,
    );
  }

  return workflow;
}

export function mkdirp(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

export function writeTextFile(filePath, content) {
  mkdirp(path.dirname(filePath));
  writeFileSync(filePath, content, "utf8");
}

export function writeExecutable(filePath, content) {
  writeTextFile(filePath, content);
  chmodSync(filePath, 0o755);
}

export function readTemplate(templateName) {
  return readFileSync(path.join(promptTemplateDir, templateName), "utf8");
}

export function renderTemplate(templateName, replacements) {
  let output = readTemplate(templateName);

  for (const [key, value] of Object.entries(replacements)) {
    output = output.replaceAll(`{{${key}}}`, value);
  }

  const leftoverTokens = output.match(/{{[A-Z0-9_]+}}/g);
  if (leftoverTokens) {
    throw new Error(
      `Unresolved template tokens in ${templateName}: ${leftoverTokens.join(", ")}`,
    );
  }

  return output.trimEnd() + "\n";
}

export function formatBulletList(items, formatter = (item) => item) {
  if (!items || items.length === 0) {
    return "- none";
  }

  return items.map((item) => `- ${formatter(item)}`).join("\n");
}

export function buildProtocolMetadata(protocolName, protocolSlug, familySlug) {
  const protocolPath = path.posix.join(
    "packages/health-commons/content/protocols",
    familySlug,
    `${protocolSlug}.md`,
  );
  const sourceDir = path.posix.join(
    "packages/health-commons/content/sources",
    familySlug,
  );
  const artifactManifestPath = path.posix.join(
    "packages/health-commons/content/artifacts",
    familySlug,
    "research-artifacts.json",
  );

  return {
    name: protocolName,
    slug: protocolSlug,
    familySlug,
    familyKey: `experiment_family:${familySlug}`,
    protocolKey: `protocol_variant:${familySlug}/${protocolSlug}`,
    protocolPath,
    sourceDir,
    artifactManifestPath,
  };
}

export function buildSharedPromptHeader(spec) {
  return renderTemplate("shared-header.md", {
    PROTOCOL_NAME: spec.protocolName,
    PROTOCOL_SLUG: spec.protocolSlug,
    FAMILY_SLUG: spec.familySlug,
  }).trimEnd();
}

export function buildDiscoveryStepLabel(index, fileId) {
  const ordinal = String(index + 2).padStart(2, "0");
  return `${ordinal}-discovery-${fileId}`;
}

export function buildPageBuilderRequiredArtifacts(protocolSlug, familySlug) {
  return [
    {
      logicalName: "PROTOCOL_PAGE_DRAFT",
      fileName: `${protocolSlug}.md`,
      relativePath: `downloads/${PAGE_BUILDER_LABEL}/downloads/${protocolSlug}.md`,
    },
    {
      logicalName: "FAMILY_PAGE_DRAFT",
      fileName: `${familySlug}.md`,
      relativePath: `downloads/${PAGE_BUILDER_LABEL}/downloads/${familySlug}.md`,
    },
    {
      logicalName: "ARTIFACT_MANIFEST_DRAFT",
      fileName: "research-artifacts.json",
      relativePath: `downloads/${PAGE_BUILDER_LABEL}/downloads/research-artifacts.json`,
    },
    {
      logicalName: "PACKAGE_DRAFT_ARCHIVE",
      fileName: `${familySlug}-package-draft.zip`,
      relativePath: `downloads/${PAGE_BUILDER_LABEL}/downloads/${familySlug}-package-draft.zip`,
    },
  ];
}

export function buildResearchArtifactContracts({
  discoveryShards = [],
  includeSourceLedgerReducer = false,
  includePageBuilder = false,
  protocolSlug = "",
  familySlug = "",
} = {}) {
  const contracts = {};

  discoveryShards.forEach((shard, index) => {
    const label = buildDiscoveryStepLabel(index, shard.fileId);
    contracts[label] = {
      requiredArtifacts: [
        {
          logicalName: "SOURCE_CANDIDATES_V1",
          fileName: "source_candidates_v1.json",
          relativePath: `downloads/${label}/source_candidates_v1.json`,
        },
      ],
    };
  });

  if (includeSourceLedgerReducer) {
    contracts[SOURCE_LEDGER_REDUCER_LABEL] = {
      requiredArtifacts: [
        {
          logicalName: "CANONICAL_SOURCE_LEDGER_V1",
          fileName: "canonical_source_ledger_v1.json",
          relativePath: `downloads/${SOURCE_LEDGER_REDUCER_LABEL}/canonical_source_ledger_v1.json`,
        },
        {
          logicalName: "SOURCE_EXTRACTION_BATCHES_V1",
          fileName: "source_extraction_batches_v1.json",
          relativePath: `downloads/${SOURCE_LEDGER_REDUCER_LABEL}/source_extraction_batches_v1.json`,
        },
      ],
    };
  }

  if (includePageBuilder) {
    if (!protocolSlug || !familySlug) {
      throw new Error("includePageBuilder requires protocolSlug and familySlug.");
    }

    contracts[PAGE_BUILDER_LABEL] = {
      requiredArtifacts: buildPageBuilderRequiredArtifacts(protocolSlug, familySlug),
    };
  }

  return contracts;
}

export function buildCommandHelperScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <label> <prompt-file> <response-file>" >&2
  exit 2
fi

label="$1"
prompt_file="$2"
response_file="$3"

script_dir="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
run_dir="$(cd "\${script_dir}/.." && pwd)"

find_repo_dir() {
  local dir="$1"
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/package.json" ]] && grep -q '"name"[[:space:]]*:[[:space:]]*"murph-workspace"' "$dir/package.json"; then
      printf '%s\\n' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

repo_dir="$(find_repo_dir "$run_dir")" || {
  echo "Could not locate the murph workspace root from $run_dir" >&2
  exit 1
}

mkdir -p "\${run_dir}/responses" "\${run_dir}/logs" "\${run_dir}/downloads" "\${run_dir}/state/chat-urls" "\${run_dir}/state/thread-exports"

result_file="\${run_dir}/logs/\${label}.result.json"
stderr_file="\${run_dir}/logs/\${label}.stderr.log"
chat_url_file="\${run_dir}/state/chat-urls/\${label}.txt"
thread_export_file="\${run_dir}/state/thread-exports/\${label}.thread.json"
wake_output_dir="\${run_dir}/downloads/\${label}"
wake_status_file="\${wake_output_dir}/status.json"
wake_thread_file="\${wake_output_dir}/thread.json"
artifact_contract_status_file="\${wake_output_dir}/artifact-contract-status.json"
workflow_file="\${run_dir}/workflow.json"
default_config_file="\${run_dir}/config/review-gpt-research.config.sh"
work_profile_config_file="\${run_dir}/config/review-gpt-work-profile.sh"
review_gpt_config="\${RESEARCH_REVIEW_GPT_CONFIG:-}"
required_artifacts_json="[]"

rm -f "\${result_file}" "\${stderr_file}" "\${chat_url_file}" "\${thread_export_file}" "\${response_file}" "\${artifact_contract_status_file}"
rm -rf "\${wake_output_dir}"

if [[ -z "\${review_gpt_config}" ]]; then
  if [[ -f "\${work_profile_config_file}" ]]; then
    review_gpt_config="\${work_profile_config_file}"
  else
    review_gpt_config="\${default_config_file}"
  fi
fi

if [[ ! -f "\${review_gpt_config}" ]]; then
  echo "Missing research review:gpt config: \${review_gpt_config}" >&2
  exit 63
fi

normalize_path() {
  local target="$1"
  if [[ -z "\${target}" ]]; then
    return 1
  fi

  local absolute_target="\${target}"
  if [[ "\${absolute_target}" != /* ]]; then
    absolute_target="\${repo_dir}/\${absolute_target}"
  fi

  if [[ -d "\${absolute_target}" ]]; then
    (
      cd "\${absolute_target}"
      pwd -P
    )
    return 0
  fi

  local dir_name
  dir_name="$(dirname "\${absolute_target}")"
  if [[ ! -d "\${dir_name}" ]]; then
    printf '%s\\n' "\${absolute_target}"
    return 0
  fi

  (
    cd "\${dir_name}"
    printf '%s/%s\\n' "$(pwd -P)" "$(basename "\${absolute_target}")"
  )
}

resolve_required_artifacts_from_workflow() {
  node - "\${workflow_file}" "\${label}" <<'NODE'
const fs = require("node:fs");

const [workflowPath, label] = process.argv.slice(2);

if (!workflowPath || !fs.existsSync(workflowPath)) {
  process.stdout.write("[]");
  process.exit(0);
}

try {
  const workflow = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
  const requiredArtifacts = workflow?.artifactContracts?.[label]?.requiredArtifacts;
  process.stdout.write(JSON.stringify(Array.isArray(requiredArtifacts) ? requiredArtifacts : []));
} catch {
  process.stdout.write("[]");
}
NODE
}

resolve_package_script_from_config() {
  local configured_package_script=""
  configured_package_script="$(
    REVIEW_GPT_CONFIG_PATH="\${review_gpt_config}" RUN_DIR="\${run_dir}" bash <<'BASH'
set -euo pipefail

review_gpt_config="\${REVIEW_GPT_CONFIG_PATH}"
run_dir="\${RUN_DIR}"
workspace_dir="\${run_dir}"

if [[ ! -f "\${review_gpt_config}" ]]; then
  exit 0
fi

script_dir="$(cd "$(dirname "\${review_gpt_config}")" && pwd)"

review_gpt_register_alias() { :; }
review_gpt_register_preset() { :; }
review_gpt_register_dir_preset() { :; }
review_gpt_register_preset_group() { :; }

# shellcheck source=/dev/null
. "\${review_gpt_config}" >/dev/null 2>&1

printf '%s\\n' "\${package_script:-}"
BASH
  )" || true

  if [[ -z "\${configured_package_script}" ]]; then
    return 0
  fi

  printf '%s\\n' "\${configured_package_script}"
}

assert_workspace_package_script() {
  local expected_package_script="\${run_dir}/scripts/package-research-context.sh"
  local resolved_package_script=""
  resolved_package_script="$(resolve_package_script_from_config)"

  if [[ -z "\${resolved_package_script}" ]]; then
    return 0
  fi

  local expected_normalized=""
  local resolved_normalized=""
  expected_normalized="$(normalize_path "\${expected_package_script}" || true)"
  resolved_normalized="$(normalize_path "\${resolved_package_script}" || true)"

  if [[ -z "\${expected_normalized}" || -z "\${resolved_normalized}" ]]; then
    return 0
  fi

  if [[ "\${expected_normalized}" != "\${resolved_normalized}" ]]; then
    echo "review:gpt config resolves to a different research package script." >&2
    echo "Config: \${review_gpt_config}" >&2
    echo "Expected package script: \${expected_normalized}" >&2
    echo "Resolved package script: \${resolved_normalized}" >&2
    echo "Refusing to send because this would attach the wrong research workspace bundle." >&2
    exit 64
  fi
}

assert_workspace_package_script

normalize_required_artifacts_from_wake() {
  node - "\${required_artifacts_json}" "\${run_dir}" "\${wake_output_dir}" "\${wake_status_file}" "\${artifact_contract_status_file}" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const [requiredJson, runDir, wakeOutputDir, statusPath, summaryPath] = process.argv.slice(2);

let requiredArtifacts = [];
try {
  requiredArtifacts = JSON.parse(requiredJson);
} catch {
  requiredArtifacts = [];
}

if (!Array.isArray(requiredArtifacts)) {
  requiredArtifacts = [];
}

const summary = {
  requiredArtifacts,
  rawCandidates: [],
  normalizedArtifacts: [],
  missingArtifacts: [],
};

function writeSummaryAndExit(code) {
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\\n", "utf8");
  process.exit(code);
}

if (requiredArtifacts.length === 0) {
  writeSummaryAndExit(0);
}

const rawCandidateMap = new Map();
const bookkeepingBasenames = new Set([
  path.basename(statusPath),
  path.basename(summaryPath),
  "thread.json",
]);

function validateArtifactPayload(logicalName, targetPath) {
  if (path.extname(targetPath).toLowerCase() !== ".json") {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  } catch (error) {
    return {
      reason: "invalid-json",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      reason: "invalid-json-shape",
      detail: "Top-level JSON value must be an object.",
    };
  }

  if (logicalName === "SOURCE_CANDIDATES_V1" && !Array.isArray(parsed.records)) {
    return {
      reason: "invalid-json-shape",
      detail: "SOURCE_CANDIDATES_V1 requires a records array.",
    };
  }

  if (logicalName === "CANONICAL_SOURCE_LEDGER_V1" && !Array.isArray(parsed.records)) {
    return {
      reason: "invalid-json-shape",
      detail: "CANONICAL_SOURCE_LEDGER_V1 requires a records array.",
    };
  }

  if (logicalName === "SOURCE_EXTRACTION_BATCHES_V1" && !Array.isArray(parsed.batches)) {
    return {
      reason: "invalid-json-shape",
      detail: "SOURCE_EXTRACTION_BATCHES_V1 requires a batches array.",
    };
  }

  return null;
}

function addCandidate(candidatePath) {
  const normalizedPath = path.resolve(candidatePath);
  if (!fs.existsSync(normalizedPath)) {
    return;
  }

  let stat;
  try {
    stat = fs.statSync(normalizedPath);
  } catch {
    return;
  }

  if (!stat.isFile() || rawCandidateMap.has(normalizedPath)) {
    return;
  }

  rawCandidateMap.set(normalizedPath, {
    absolutePath: normalizedPath,
    fileName: path.basename(normalizedPath),
  });
}

if (fs.existsSync(statusPath)) {
  try {
    const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    const downloadedArtifacts = Array.isArray(status?.downloadedArtifacts)
      ? status.downloadedArtifacts
      : [];
    for (const entry of downloadedArtifacts) {
      if (typeof entry === "string" && entry.trim()) {
        addCandidate(entry.trim());
      }
    }
  } catch {
    // Ignore malformed wake status and fall back to filesystem discovery.
  }
}

function walkFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return;
  }

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(absolutePath);
      continue;
    }
    if (entry.isFile() && !bookkeepingBasenames.has(entry.name)) {
      addCandidate(absolutePath);
    }
  }
}

walkFiles(wakeOutputDir);

const rawCandidates = Array.from(rawCandidateMap.values());
summary.rawCandidates = rawCandidates.map((entry) => entry.absolutePath);

for (const artifact of requiredArtifacts) {
  const relativePath = String(artifact?.relativePath ?? "").trim();
  const expectedFileName = String(artifact?.fileName ?? "").trim();
  const logicalName = String(artifact?.logicalName ?? "").trim();

  if (!relativePath || !expectedFileName || !logicalName) {
    summary.missingArtifacts.push({
      logicalName: logicalName || "unknown",
      relativePath: relativePath || "unknown",
      reason: "invalid-contract",
    });
    continue;
  }

  const targetPath = path.resolve(runDir, relativePath);
  let sourcePath = rawCandidates.find((entry) => entry.fileName === expectedFileName)?.absolutePath;

  if (!sourcePath && fs.existsSync(targetPath)) {
    sourcePath = targetPath;
  }

  if (!sourcePath && requiredArtifacts.length === 1 && rawCandidates.length === 1) {
    sourcePath = rawCandidates[0].absolutePath;
  }

  if (!sourcePath) {
    summary.missingArtifacts.push({
      logicalName,
      relativePath,
      expectedFileName,
      reason: "missing-download",
    });
    continue;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (path.resolve(sourcePath) !== path.resolve(targetPath)) {
    fs.copyFileSync(sourcePath, targetPath);
  }

  const validationError = validateArtifactPayload(logicalName, targetPath);
  if (validationError) {
    summary.missingArtifacts.push({
      logicalName,
      relativePath,
      expectedFileName,
      sourcePath,
      reason: validationError.reason,
      detail: validationError.detail,
    });
    continue;
  }

  summary.normalizedArtifacts.push({
    logicalName,
    relativePath,
    sourcePath,
    targetPath,
  });
}

writeSummaryAndExit(summary.missingArtifacts.length > 0 ? 1 : 0);
NODE
}

required_artifacts_json="$(resolve_required_artifacts_from_workflow)"

capture_chat_url() {
  node - "\${result_file}" "\${stderr_file}" "\${chat_url_file}" <<'NODE'
const fs = require("node:fs");

const [stdoutPath, stderrPath, chatUrlPath] = process.argv.slice(2);
for (const sourcePath of [stdoutPath, stderrPath]) {
  if (!fs.existsSync(sourcePath)) {
    continue;
  }

  const raw = fs.readFileSync(sourcePath, "utf8");

  const directLine = raw
    .split(/\\r?\\n/u)
    .find((line) => /ChatGPT (thread|conversation) URL: https:\\/\\/chatgpt\\.com\\/c\\//u.test(line));

  if (directLine) {
    const match = directLine.match(/https:\\/\\/chatgpt\\.com\\/c\\/\\S+/u);
    if (match) {
      fs.writeFileSync(chatUrlPath, match[0] + "\\n", "utf8");
      process.exit(0);
    }
  }

  const matches = [...raw.matchAll(/https:\\/\\/chatgpt\\.com\\/c\\/\\S+/gu)];
  if (matches.length > 0) {
    fs.writeFileSync(chatUrlPath, matches.at(-1)[0] + "\\n", "utf8");
    process.exit(0);
  }
}
NODE
}

resolve_browser_endpoint() {
  local endpoint_from_result=""
  if [[ -f "\${result_file}" ]]; then
    endpoint_from_result="$(
      sed -n 's/^Managed browser endpoint: \\(.*\\)$/\\1/p' "\${result_file}" | tail -n 1
    )"
  fi
  if [[ -n "\${endpoint_from_result}" ]]; then
    case "\${endpoint_from_result}" in
      http://*|https://*)
        printf '%s\\n' "\${endpoint_from_result}"
        ;;
      *)
        printf 'http://%s\\n' "\${endpoint_from_result}"
        ;;
    esac
    return 0
  fi

  if [[ -n "\${RESEARCH_MANAGED_BROWSER_ENDPOINT:-}" ]]; then
    printf '%s\\n' "\${RESEARCH_MANAGED_BROWSER_ENDPOINT}"
    return 0
  fi

  if [[ -n "\${RESEARCH_MANAGED_BROWSER_PORT:-}" ]]; then
    printf 'http://127.0.0.1:%s\\n' "\${RESEARCH_MANAGED_BROWSER_PORT}"
    return 0
  fi

  if [[ ! -f "\${review_gpt_config}" ]]; then
    return 0
  fi

  local configured_endpoint=""
  configured_endpoint="$(
    REVIEW_GPT_CONFIG_PATH="\${review_gpt_config}" RUN_DIR="\${run_dir}" bash <<'BASH'
set -euo pipefail

review_gpt_config="\${REVIEW_GPT_CONFIG_PATH}"
run_dir="\${RUN_DIR}"
workspace_dir="\${run_dir}"

if [[ ! -f "\${review_gpt_config}" ]]; then
  exit 0
fi

script_dir="$(cd "$(dirname "\${review_gpt_config}")" && pwd)"

review_gpt_register_alias() { :; }
review_gpt_register_preset() { :; }
review_gpt_register_dir_preset() { :; }
review_gpt_register_preset_group() { :; }

# shellcheck source=/dev/null
. "\${review_gpt_config}" >/dev/null 2>&1

if [[ -n "\${research_thread_export_browser_endpoint:-}" ]]; then
  printf '%s\\n' "\${research_thread_export_browser_endpoint}"
  exit 0
fi

if [[ -n "\${managed_browser_endpoint:-}" ]]; then
  printf '%s\\n' "\${managed_browser_endpoint}"
  exit 0
fi

if [[ -n "\${managed_browser_port:-}" ]]; then
  printf 'http://127.0.0.1:%s\\n' "\${managed_browser_port}"
  exit 0
fi

if [[ -n "\${remote_port:-}" ]]; then
  printf 'http://127.0.0.1:%s\\n' "\${remote_port}"
fi
BASH
  )" || true

  if [[ -n "\${configured_endpoint}" ]]; then
    printf '%s\\n' "\${configured_endpoint}"
    return 0
  fi
}

run_thread_wake() {
  if [[ ! -f "\${chat_url_file}" ]]; then
    return 1
  fi

  mkdir -p "\${wake_output_dir}"

  local browser_endpoint=""
  browser_endpoint="$(resolve_browser_endpoint || true)"

  local -a wake_cmd=(
    pnpm
    exec
    cobuild-review-gpt
    thread
    wake
    --delay
    "\${RESEARCH_WAKE_DELAY:-0s}"
    --poll-interval
    "\${RESEARCH_POLL_INTERVAL:-1m}"
    --poll-jitter
    "\${RESEARCH_POLL_JITTER:-1m}"
    --poll-timeout
    "\${RESEARCH_POLL_TIMEOUT:-200m}"
    --chat-url
    "$(tr -d '\\r\\n' < "\${chat_url_file}")"
    --output-dir
    "\${wake_output_dir}"
    --repo-dir
    "\${repo_dir}"
    --skip-resume
  )

  if [[ -n "\${browser_endpoint}" ]]; then
    wake_cmd+=(
      --browser-endpoint
      "\${browser_endpoint}"
    )
  fi

  printf '%s\\n' '--- thread wake ---' >>"\${result_file}"
  "\${wake_cmd[@]}" >>"\${result_file}" 2>>"\${stderr_file}"
}

copy_thread_export_from_wake() {
  if [[ -f "\${wake_thread_file}" ]]; then
    cp "\${wake_thread_file}" "\${thread_export_file}"
  fi
}

recover_response_from_thread_export() {
  node - "\${thread_export_file}" "\${response_file}" "\${wake_status_file}" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const [threadPath, responsePath, statusPath] = process.argv.slice(2);
if (!fs.existsSync(threadPath)) {
  process.exit(0);
}

let thread;
try {
  thread = JSON.parse(fs.readFileSync(threadPath, "utf8"));
} catch {
  process.exit(0);
}

let status = undefined;
if (statusPath && fs.existsSync(statusPath)) {
  try {
    status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  } catch {
    status = undefined;
  }
}

const assistantSnapshots = Array.isArray(thread.assistantSnapshots)
  ? thread.assistantSnapshots
  : [];

const candidateTexts = assistantSnapshots
  .filter((entry) => entry && entry.afterLastUserMessage !== false)
  .map((entry) => String(entry.text ?? "").trim())
  .filter(Boolean);

const meaningfulTexts = candidateTexts.filter((entry) => !/^(attached\\b|pro thinking\\b)/iu.test(entry));

let responseText = meaningfulTexts.at(-1) ?? "";
if (!responseText && candidateTexts.length > 0) {
  responseText = candidateTexts.at(-1) ?? "";
}
if (!responseText) {
  const bodyText = String(thread.bodyText ?? "").trim();
  if (bodyText) {
    responseText = bodyText;
  }
}

if (!responseText) {
  const downloadedArtifacts = Array.isArray(status?.downloadedArtifacts)
    ? status.downloadedArtifacts
    : [];
  const relativeArtifacts = downloadedArtifacts.map((entry) => path.relative(process.cwd(), entry) || entry);
  const lines = [
    "Recovered via thread wake.",
    "",
  ];

  if (thread.chatUrl) {
    lines.push("Chat URL: " + thread.chatUrl, "");
  }

  if (relativeArtifacts.length > 0) {
    lines.push("Downloaded artifacts:");
    for (const artifact of relativeArtifacts) {
      lines.push("- " + artifact);
    }
  } else {
    lines.push("No inline assistant text or downloaded artifacts were exposed in the final thread export.");
  }

  responseText = lines.join("\\n").trim();
}

fs.mkdirSync(path.dirname(responsePath), { recursive: true });
fs.writeFileSync(
  responsePath,
  responseText.endsWith("\\n") ? responseText : responseText + "\\n",
  "utf8",
);
NODE
}

cd "\${repo_dir}"

set +e
pnpm exec cobuild-review-gpt \\
  --config "\${review_gpt_config}" \\
  --send \\
  --format json \\
  --model "\${RESEARCH_MODEL:-gpt-5.4-pro}" \\
  --timeout "\${RESEARCH_TIMEOUT:-210m}" \\
  --prompt-file "\${prompt_file}" \\
  >"\${result_file}" 2>"\${stderr_file}"
send_status=$?
set -e

capture_chat_url
wake_status=0
artifact_contract_status=0
if [[ -f "\${chat_url_file}" ]]; then
  set +e
  run_thread_wake
  wake_status=$?
  set -e
  copy_thread_export_from_wake
  if [[ "\${wake_status}" -eq 0 ]]; then
    set +e
    normalize_required_artifacts_from_wake
    artifact_contract_status=$?
    set -e
  fi
  recover_response_from_thread_export
fi

if [[ "\${send_status}" -ne 0 && ! -f "\${chat_url_file}" ]]; then
  cat "\${stderr_file}" >&2
  echo "research step \${label} failed" >&2
  exit "\${send_status}"
fi

if [[ ! -f "\${chat_url_file}" ]]; then
  cat "\${stderr_file}" >&2
  echo "No ChatGPT thread URL detected for research step \${label}" >&2
  exit 65
fi

if [[ "\${wake_status}" -ne 0 ]]; then
  cat "\${stderr_file}" >&2
  echo "Chat URL: \$(cat "\${chat_url_file}")" >&2
  if [[ -f "\${thread_export_file}" ]]; then
    echo "Thread export: \${thread_export_file}" >&2
  fi
  echo "research step \${label} failed during thread wake" >&2
  exit "\${wake_status}"
fi

if [[ "\${artifact_contract_status}" -ne 0 ]]; then
  echo "Artifact contract status: \${artifact_contract_status_file}" >&2
  echo "research step \${label} is missing required local artifacts after thread wake" >&2
  exit 68
fi

if [[ ! -f "\${thread_export_file}" ]]; then
  echo "Thread export missing after thread wake: \${thread_export_file}" >&2
  exit 66
fi

if [[ ! -f "\${response_file}" ]]; then
  echo "Recovered response missing after thread wake: \${response_file}" >&2
  exit 67
fi

echo "Response: \${response_file}"
echo "Result log: \${result_file}"
echo "Wake output: \${wake_output_dir}"
if [[ -f "\${artifact_contract_status_file}" ]]; then
  echo "Artifact status: \${artifact_contract_status_file}"
fi
if [[ -f "\${chat_url_file}" ]]; then
  echo "Chat URL: $(cat "\${chat_url_file}")"
fi
if [[ -f "\${thread_export_file}" ]]; then
  echo "Thread export: \${thread_export_file}"
fi
if [[ "\${send_status}" -ne 0 ]]; then
  echo "Recovered after send failure: yes"
fi
`;
}

export function buildResearchReviewGptConfig() {
  return `#!/usr/bin/env bash

script_dir="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
workspace_dir="$(cd "\${script_dir}/.." && pwd)"

package_script="\${workspace_dir}/scripts/package-research-context.sh"
repomix_attachment_format="\${RESEARCH_REPOMIX_ATTACHMENT_FORMAT:-none}"
research_thread_export_browser_endpoint="\${RESEARCH_THREAD_EXPORT_BROWSER_ENDPOINT:-}"
`;
}

export function buildResearchWorkProfileConfig() {
  return `#!/usr/bin/env bash

script_dir="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=/dev/null
. "\${script_dir}/review-gpt-research.config.sh"

browser_binary_path="\${browser_binary_path:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
managed_browser_user_data_dir="\${RESEARCH_MANAGED_BROWSER_USER_DATA_DIR:-$HOME/.review-gpt-work/murph-research-chrome}"
managed_browser_profile="\${RESEARCH_MANAGED_BROWSER_PROFILE:-Default}"
managed_browser_port="\${RESEARCH_MANAGED_BROWSER_PORT:-9224}"
research_thread_export_browser_endpoint="\${RESEARCH_THREAD_EXPORT_BROWSER_ENDPOINT:-http://127.0.0.1:\${managed_browser_port}}"
`;
}

export function buildResearchPackageScript() {
  const referenceFilesLiteral = RESEARCH_REFERENCE_FILE_PATHS.map(
    (relativePath) => `  "${relativePath}"`,
  ).join("\n");

  return `#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
workspace_dir="$(cd "\${script_dir}/.." && pwd)"

find_repo_dir() {
  local dir="$1"
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/package.json" ]] && grep -q '"name"[[:space:]]*:[[:space:]]*"murph-workspace"' "$dir/package.json"; then
      printf '%s\\n' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

repo_dir="$(find_repo_dir "\${workspace_dir}")" || {
  echo "Could not locate the murph workspace root from \${workspace_dir}" >&2
  exit 1
}

out_dir="\${repo_dir}/audit-packages"
prefix="murph-research-context"

case "\${workspace_dir}" in
  "\${repo_dir}"/*)
    workspace_relative="\${workspace_dir#"\${repo_dir}/"}"
    ;;
  *)
    echo "Research workspace must live inside the repo root: \${workspace_dir}" >&2
    exit 1
    ;;
esac

usage() {
  local exit_code="\${1:-0}"
  cat >&2 <<'USAGE'
Usage: package-research-context.sh [options]

Create a ZIP bundle containing the active research workspace plus a small
Health Commons schema/example reference pack.

Options:
  --zip                      Create only a .zip archive (default)
  --out-dir <dir>            Output directory (default: audit-packages)
  --name <prefix>            Output filename prefix (default: murph-research-context)
  --with-tests               Accepted for compatibility; no effect.
  --no-tests                 Accepted for compatibility; no effect.
  --with-docs                Accepted for compatibility; no effect.
  --no-docs                  Accepted for compatibility; no effect.
  -h, --help                 Show this help message
USAGE
  exit "\${exit_code}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --zip|--with-tests|--no-tests|--with-docs|--no-docs)
      shift
      ;;
    --out-dir)
      [[ $# -ge 2 ]] || {
        echo "Error: --out-dir requires a value." >&2
        exit 1
      }
      out_dir="$2"
      shift 2
      ;;
    --name)
      [[ $# -ge 2 ]] || {
        echo "Error: --name requires a value." >&2
        exit 1
      }
      prefix="$2"
      shift 2
      ;;
    --txt|--both)
      echo "Error: only ZIP output is supported for research bundles." >&2
      exit 1
      ;;
    -h|--help)
      usage 0
      ;;
    *)
      echo "Error: unknown option '$1'." >&2
      usage 2
      ;;
  esac
done

if ! command -v zip >/dev/null 2>&1; then
  echo "Error: zip is required to package a research bundle." >&2
  exit 1
fi

declare -a workspace_files=()
declare -a reference_files=()

add_file_if_exists() {
  local relative_path="$1"
  if [[ -f "\${repo_dir}/\${relative_path}" ]]; then
    workspace_files+=("\${relative_path}")
  fi
}

collect_dir_files() {
  local relative_dir="$1"
  local target_array_name="$2"
  local absolute_dir="\${repo_dir}/\${relative_dir}"
  if [[ ! -d "\${absolute_dir}" ]]; then
    return 0
  fi

  while IFS= read -r -d '' absolute_path; do
    local relative_path="\${absolute_path#"\${repo_dir}/"}"
    if [[ "\${target_array_name}" == "workspace_files" ]]; then
      workspace_files+=("\${relative_path}")
    else
      reference_files+=("\${relative_path}")
    fi
  done < <(find "\${absolute_dir}" -type f -print0 | sort -z)
}

collect_workspace_dir() {
  collect_dir_files "$1" workspace_files
}

declare -a bundled_reference_files=(
${referenceFilesLiteral}
)

for relative_path in "\${bundled_reference_files[@]}"; do
  if [[ -f "\${repo_dir}/\${relative_path}" ]]; then
    reference_files+=("\${relative_path}")
  fi
done

add_file_if_exists "\${workspace_relative}/README.md"
add_file_if_exists "\${workspace_relative}/workflow.json"
collect_workspace_dir "\${workspace_relative}/prompts"
collect_workspace_dir "\${workspace_relative}/responses"
collect_workspace_dir "\${workspace_relative}/downloads"
collect_workspace_dir "\${workspace_relative}/commands"
collect_workspace_dir "\${workspace_relative}/config"
collect_workspace_dir "\${workspace_relative}/scripts"
collect_workspace_dir "\${workspace_relative}/state/chat-urls"
collect_workspace_dir "\${workspace_relative}/state/thread-exports"

declare -a all_files=()

append_unique_file() {
  local relative_path="$1"
  local existing_path
  if [[ "\${#all_files[@]}" -gt 0 ]]; then
    for existing_path in "\${all_files[@]}"; do
      if [[ "\${existing_path}" == "\${relative_path}" ]]; then
        return 0
      fi
    done
  fi

  all_files+=("\${relative_path}")
}

for relative_path in "\${reference_files[@]}"; do
  append_unique_file "\${relative_path}"
done

for relative_path in "\${workspace_files[@]}"; do
  append_unique_file "\${relative_path}"
done

if [[ "\${#all_files[@]}" -eq 0 ]]; then
  echo "Included files: 0"
  echo "Research workspace files added: 0"
  echo "Research reference files added: 0"
  echo "Research workspace root: \${workspace_relative}"
  exit 0
fi

mkdir -p "\${out_dir}"
absolute_out_dir="$(
  cd "\${out_dir}"
  pwd -P
)"

timestamp="$(date -u +%Y%m%d-%H%M%SZ)"
zip_path="\${absolute_out_dir}/\${prefix}-\${timestamp}.zip"

stage_dir="$(mktemp -d "\${TMPDIR:-/tmp}/murph-research-context.XXXXXX")"
cleanup() {
  rm -rf "\${stage_dir}"
}
trap cleanup EXIT

for relative_path in "\${all_files[@]}"; do
  source_path="\${repo_dir}/\${relative_path}"
  target_path="\${stage_dir}/\${relative_path}"
  mkdir -p "$(dirname "\${target_path}")"
  cp -p "\${source_path}" "\${target_path}"
done

(
  cd "\${stage_dir}"
  zip -qr "\${zip_path}" .
)

zip_size="$(stat -f %z "\${zip_path}" 2>/dev/null || stat -c %s "\${zip_path}")"

echo "Included files: \${#all_files[@]}"
echo "ZIP: \${zip_path} (\${zip_size} bytes)"
echo "Research reference files added: \${#reference_files[@]}"
echo "Research workspace files added: \${#workspace_files[@]}"
echo "Research workspace root: \${workspace_relative}"
`;
}

export function writeResearchReviewGptSupportFiles(workspaceDir) {
  writeTextFile(
    path.join(workspaceDir, "config", "review-gpt-research.config.sh"),
    buildResearchReviewGptConfig(),
  );
  writeTextFile(
    path.join(workspaceDir, "config", "review-gpt-work-profile.sh"),
    buildResearchWorkProfileConfig(),
  );
  writeExecutable(
    path.join(workspaceDir, "scripts", "package-research-context.sh"),
    buildResearchPackageScript(),
  );
}

export function buildCommandWrapper(label, promptRelativePath) {
  return `#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
run_dir="$(cd "\${script_dir}/.." && pwd)"

exec "\${script_dir}/_run-review-gpt.sh" "${label}" "\${run_dir}/${promptRelativePath}" "\${run_dir}/responses/${label}.md"
`;
}

export function assertWorkspaceDir(workspaceDir) {
  ensureRepoLocalOutputDir(workspaceDir);
  if (!existsSync(workspaceDir)) {
    throw new Error(`Workspace directory does not exist: ${toPosixRelative(workspaceDir)}`);
  }
  const stat = lstatSync(workspaceDir);
  if (!stat.isDirectory()) {
    throw new Error(`Workspace path is not a directory: ${toPosixRelative(workspaceDir)}`);
  }
}
