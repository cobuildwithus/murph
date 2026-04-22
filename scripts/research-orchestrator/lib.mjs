import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ORCHESTRATOR_SCHEMA_VERSION = "murph.research.orchestrator.init.v2";
const SUPPORTED_SCAFFOLD_SCHEMA_VERSIONS = new Set([
  "murph.research.orchestrator.init.v1",
  ORCHESTRATOR_SCHEMA_VERSION,
]);

const libPath = fileURLToPath(import.meta.url);
export const orchestratorDir = path.dirname(libPath);
export const scriptDir = path.resolve(orchestratorDir, "..");
export const repoRoot = path.resolve(scriptDir, "..");
export const promptTemplateDir = path.join(orchestratorDir, "prompts");
export const researchOutputRoot = path.join(repoRoot, "output-packages", "research");

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
    return SUPPORTED_SCAFFOLD_SCHEMA_VERSIONS.has(workflow?.schemaVersion);
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
  if (!SUPPORTED_SCAFFOLD_SCHEMA_VERSIONS.has(workflow?.schemaVersion)) {
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

mkdir -p "\${run_dir}/responses" "\${run_dir}/logs" "\${run_dir}/state/chat-urls"

result_file="\${run_dir}/logs/\${label}.result.json"
stderr_file="\${run_dir}/logs/\${label}.stderr.log"
chat_url_file="\${run_dir}/state/chat-urls/\${label}.txt"

cd "\${repo_dir}"

set +e
pnpm review:gpt \\
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

if [[ "$status" -ne 0 ]]; then
  cat "\${stderr_file}" >&2
  echo "research step \${label} failed" >&2
  exit "$status"
fi

node - "\${result_file}" "\${chat_url_file}" <<'NODE'
const fs = require("node:fs");

const [resultPath, chatUrlPath] = process.argv.slice(2);
const raw = fs.readFileSync(resultPath, "utf8");

const directLine = raw
  .split(/\\r?\\n/u)
  .find((line) => /ChatGPT (thread|conversation) URL: https:\\/\\/chatgpt\\.com\\/c\\//u.test(line));

if (directLine) {
  const match = directLine.match(/https:\\/\\/chatgpt\\.com\\/c\\/[^\\s"'\\\`]+/u);
  if (match) {
    fs.writeFileSync(chatUrlPath, match[0] + "\\n", "utf8");
    process.exit(0);
  }
}

const matches = [...raw.matchAll(/https:\\/\\/chatgpt\\.com\\/c\\/[^\\s"'\\\`]+/gu)];
if (matches.length > 0) {
  fs.writeFileSync(chatUrlPath, matches.at(-1)[0] + "\\n", "utf8");
}
NODE

echo "Response: \${response_file}"
echo "Result log: \${result_file}"
if [[ -f "\${chat_url_file}" ]]; then
  echo "Chat URL: $(cat "\${chat_url_file}")"
fi
`;
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
