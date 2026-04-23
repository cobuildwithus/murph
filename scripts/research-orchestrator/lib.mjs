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

mkdir -p "\${run_dir}/responses" "\${run_dir}/logs" "\${run_dir}/state/chat-urls" "\${run_dir}/state/thread-exports"

result_file="\${run_dir}/logs/\${label}.result.json"
stderr_file="\${run_dir}/logs/\${label}.stderr.log"
chat_url_file="\${run_dir}/state/chat-urls/\${label}.txt"
thread_export_file="\${run_dir}/state/thread-exports/\${label}.thread.json"
default_config_file="\${run_dir}/config/review-gpt-research.config.sh"
work_profile_config_file="\${run_dir}/config/review-gpt-work-profile.sh"
review_gpt_config="\${RESEARCH_REVIEW_GPT_CONFIG:-}"

if [[ -z "\${review_gpt_config}" ]]; then
  if [[ -f "\${work_profile_config_file}" ]]; then
    review_gpt_config="\${work_profile_config_file}"
  else
    review_gpt_config="\${default_config_file}"
  fi
fi

if [[ ! -f "\${review_gpt_config}" ]]; then
  review_gpt_config="\${repo_dir}/scripts/review-gpt.config.sh"
fi

capture_chat_url() {
  node - "\${result_file}" "\${chat_url_file}" <<'NODE'
const fs = require("node:fs");

const [resultPath, chatUrlPath] = process.argv.slice(2);
if (!fs.existsSync(resultPath)) {
  process.exit(0);
}

const raw = fs.readFileSync(resultPath, "utf8");

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
    sed -n 's/^[[:space:]]*research_thread_export_browser_endpoint="\\(.*\\)"[[:space:]]*$/\\1/p' "\${review_gpt_config}" | tail -n 1
  )"
  if [[ -n "\${configured_endpoint}" ]]; then
    printf '%s\\n' "\${configured_endpoint}"
  fi
}

export_thread_snapshot() {
  if [[ ! -f "\${chat_url_file}" ]]; then
    return 0
  fi

  local browser_endpoint
  browser_endpoint="\$(resolve_browser_endpoint || true)"
  if [[ -z "\${browser_endpoint}" ]]; then
    return 0
  fi

  pnpm exec cobuild-review-gpt thread export \\
    --browser-endpoint "\${browser_endpoint}" \\
    --chat-url "\$(tr -d '\\r\\n' < "\${chat_url_file}")" \\
    --output "\${thread_export_file}" \\
    --format json >/dev/null 2>&1 || true
}

cd "\${repo_dir}"

set +e
pnpm exec cobuild-review-gpt \\
  --config "\${review_gpt_config}" \\
  --send \\
  --wait \\
  --format json \\
  --model "\${RESEARCH_MODEL:-gpt-5.4-pro}" \\
  --wait-timeout "\${RESEARCH_WAIT_TIMEOUT:-200m}" \\
  --timeout "\${RESEARCH_TIMEOUT:-210m}" \\
  --prompt-file "\${prompt_file}" \\
  --response-file "\${response_file}" \\
  >"\${result_file}" 2>"\${stderr_file}"
status=$?
set -e

capture_chat_url
export_thread_snapshot

if [[ "$status" -ne 0 ]]; then
  cat "\${stderr_file}" >&2
  if [[ -f "\${chat_url_file}" ]]; then
    echo "Chat URL: \$(cat "\${chat_url_file}")" >&2
  fi
  if [[ -f "\${thread_export_file}" ]]; then
    echo "Thread export: \${thread_export_file}" >&2
  fi
  echo "research step \${label} failed" >&2
  exit "$status"
fi

echo "Response: \${response_file}"
echo "Result log: \${result_file}"
if [[ -f "\${chat_url_file}" ]]; then
  echo "Chat URL: $(cat "\${chat_url_file}")"
fi
if [[ -f "\${thread_export_file}" ]]; then
  echo "Thread export: \${thread_export_file}"
fi
`;
}

export function buildResearchReviewGptConfig() {
  return `#!/usr/bin/env bash

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
  return 1
}

# shellcheck source=/dev/null
. "\${repo_dir}/scripts/review-gpt.config.sh"

package_script="\${workspace_dir}/scripts/package-research-context.sh"
research_thread_export_browser_endpoint="\${RESEARCH_THREAD_EXPORT_BROWSER_ENDPOINT:-}"
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
  -h, --help                 Show this help message
USAGE
  exit "\${exit_code}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --zip)
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
