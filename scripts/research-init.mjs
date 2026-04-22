#!/usr/bin/env node

import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.resolve(scriptDir, "..");
const orchestratorDir = path.join(scriptDir, "research-orchestrator");
const promptTemplateDir = path.join(orchestratorDir, "prompts");
const presetDir = path.join(orchestratorDir, "presets");
const researchOutputRoot = path.join(repoRoot, "output-packages", "research");

function usage(exitCode = 2) {
  console.error(`Usage:
  pnpm research:init "topic"
  pnpm research:init --topic "topic" [options]

Options:
  --topic <text>       Research topic. You can also pass this as the first positional argument.
  --family <slug>      Health Commons family slug override.
  --slug <slug>        Protocol slug override.
  --out-dir <dir>      Output directory inside this repo. Defaults to output-packages/research/<slug>-<timestamp>.
  --force              Replace an existing output directory.
  -h, --help           Show this help text.

Environment used by generated command wrappers:
  RESEARCH_MODEL         Defaults to gpt-5.4-pro
  RESEARCH_WAIT_TIMEOUT  Defaults to 45m
  RESEARCH_TIMEOUT       Defaults to 60m
`);
  process.exit(exitCode);
}

function slugify(input) {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function normalizeMatchValue(input) {
  return slugify(input);
}

function toTitleCase(input) {
  return String(input ?? "")
    .trim()
    .split(/[^a-zA-Z0-9]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function formatDirTimestamp(date) {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}Z`;
}

function toPosixRelative(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join(path.posix.sep);
}

function ensureRepoLocalOutputDir(outDir) {
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

function isExistingScaffoldDir(outDir) {
  const workflowPath = path.join(outDir, "workflow.json");

  if (!existsSync(workflowPath)) {
    return false;
  }

  try {
    const workflow = JSON.parse(readFileSync(workflowPath, "utf8"));
    return workflow?.schemaVersion === "murph.research.orchestrator.init.v1";
  } catch {
    return false;
  }
}

function mkdirp(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

function writeTextFile(filePath, content) {
  mkdirp(path.dirname(filePath));
  writeFileSync(filePath, content, "utf8");
}

function writeExecutable(filePath, content) {
  writeTextFile(filePath, content);
  chmodSync(filePath, 0o755);
}

function readTemplate(templateName) {
  return readFileSync(path.join(promptTemplateDir, templateName), "utf8");
}

function renderTemplate(templateName, replacements) {
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

function formatBulletList(items, formatter = (item) => item) {
  if (!items || items.length === 0) {
    return "- none";
  }

  return items.map((item) => `- ${formatter(item)}`).join("\n");
}

function loadPresetDefinitions() {
  const presetFiles = readdirSync(presetDir)
    .filter((entry) => entry.endsWith(".json"))
    .sort();

  return presetFiles.map((entry) =>
    JSON.parse(readFileSync(path.join(presetDir, entry), "utf8")),
  );
}

function buildDefaultShards(protocolName) {
  return [
    {
      id: "direct-intervention",
      topic: `Direct ${protocolName} intervention trials and controlled human studies.`,
      queryStrings: [
        `"${protocolName}" randomized trial adults`,
        `"${protocolName}" crossover trial human`,
        `"${protocolName}" intervention dose duration study`,
      ],
      sourceTypes: [
        "Randomized trials",
        "Controlled crossover studies",
        "Acute physiology studies with a clear intervention dose",
      ],
      directEvidence: [
        `Human studies that directly test ${protocolName} or the same intervention wording.`,
      ],
      adjacentEvidence: [
        "Population-mismatched or clinically supervised variants that should stay bounded.",
      ],
      endpointFamilies: [
        "Primary experiment outcomes",
        "Wearable or manual biomarkers",
        "Adherence and dose-response signals",
      ],
    },
    {
      id: "reviews-guidelines",
      topic: `Reviews, meta-analyses, and guidelines relevant to ${protocolName}.`,
      queryStrings: [
        `"${protocolName}" systematic review`,
        `"${protocolName}" meta analysis`,
        `"${protocolName}" guideline safety`,
      ],
      sourceTypes: [
        "Systematic reviews",
        "Meta-analyses",
        "Consensus statements or professional guidance",
      ],
      directEvidence: [
        "Review-level synthesis that directly addresses the intervention or a clearly matching family.",
      ],
      adjacentEvidence: [
        "Broad wellness reviews that mix multiple interventions without separating the protocol.",
      ],
      endpointFamilies: [
        "Evidence quality",
        "Dose framing",
        "Safety boundaries",
      ],
    },
    {
      id: "safety-adverse-events",
      topic: `Safety boundaries, contraindications, and adverse events for ${protocolName}.`,
      queryStrings: [
        `"${protocolName}" adverse events`,
        `"${protocolName}" contraindications`,
        `"${protocolName}" safety review`,
      ],
      sourceTypes: [
        "Safety reviews",
        "Case reports",
        "Guidelines or clinician-facing reviews",
      ],
      directEvidence: [
        "Safety findings directly tied to the same intervention or dosing pattern.",
      ],
      adjacentEvidence: [
        "Higher-risk medical or supervised variants that define exclusion boundaries.",
      ],
      endpointFamilies: [
        "Adverse events",
        "Stop conditions",
        "Avoid or ask-clinician groups",
      ],
    },
    {
      id: "mechanisms",
      topic: `Mechanisms and physiology relevant to ${protocolName}.`,
      queryStrings: [
        `"${protocolName}" physiology mechanism`,
        `"${protocolName}" mechanistic study`,
        `"${protocolName}" causal pathway`,
      ],
      sourceTypes: [
        "Mechanistic human studies",
        "Physiology reviews",
        "Targeted basic-science overviews only when they clarify the human chain",
      ],
      directEvidence: [
        "Mechanistic studies that illuminate why the intervention might work.",
      ],
      adjacentEvidence: [
        "Pure basic science that cannot support a protocol claim on its own.",
      ],
      endpointFamilies: [
        "Mechanistic plausibility",
        "Dose fidelity",
        "Limits of causal interpretation",
      ],
    },
    {
      id: "adjacent-variants",
      topic: `Adjacent variants that should not be merged into the default ${protocolName} protocol.`,
      queryStrings: [
        `"${protocolName}" variant protocol`,
        `"${protocolName}" related intervention`,
        `"${protocolName}" adjacent evidence`,
      ],
      sourceTypes: [
        "Variant protocol studies",
        "Clinical or supervised variants",
        "Implementation and taxonomy references",
      ],
      directEvidence: [
        "Only evidence that truly matches the target intervention and dosing frame.",
      ],
      adjacentEvidence: [
        "Related modalities, clinician-guided variants, or bundled interventions.",
      ],
      endpointFamilies: [
        "Taxonomy boundaries",
        "Disambiguation",
        "Non-claims",
      ],
    },
    {
      id: "outcomes-measurement",
      topic: `Outcome mapping, biomarkers, and measurement seams for ${protocolName}.`,
      queryStrings: [
        `"${protocolName}" biomarker study human`,
        `"${protocolName}" wearable outcome trial`,
        `"${protocolName}" measurement endpoint review`,
      ],
      sourceTypes: [
        "Outcome-focused trials",
        "Measurement or validation studies",
        "Reviews that clarify what is realistically measurable in a self-experiment",
      ],
      directEvidence: [
        "Studies that directly tie the intervention to realistic personal-experiment endpoints or measurement limits.",
      ],
      adjacentEvidence: [
        "Lab-only or disease-treatment endpoints that should stay context-only for a Murph protocol.",
      ],
      endpointFamilies: [
        "Biomarker candidates",
        "Expected latency",
        "Wearable or manual feasibility",
      ],
    },
  ];
}

function buildDefaultSections() {
  return [
    {
      id: "dose-implementation",
      focus: "human steps, dose, frequency, timing, duration, setup, adherence, logging fields",
    },
    {
      id: "outcomes-biomarkers",
      focus: "primary and secondary biomarkers, expected signal, latency, wearable or manual measurability",
    },
    {
      id: "safety-contraindications",
      focus: "caution level, avoid or ask-clinician groups, stop conditions, adverse events, safety boundaries",
    },
    {
      id: "mechanisms",
      focus: "physiology, causal chain, mechanistic plausibility, and limits of mechanism evidence",
    },
    {
      id: "evidence-quality",
      focus: "directness, confidence label, conflicts, null results, adjacent variants, and non-claims",
    },
    {
      id: "user-experience",
      focus: "one-sentence description, human understandable steps, things that could improve, and things to watch",
    },
  ];
}

function resolveSpecification({ topic, family, slug }) {
  const topicSlug = slugify(topic);
  const presets = loadPresetDefinitions();
  const matchedPreset = presets.find((preset) => {
    const matchTopics = Array.isArray(preset.matchTopics) ? preset.matchTopics : [];
    return matchTopics.some((candidate) => normalizeMatchValue(candidate) === topicSlug);
  });

  if (matchedPreset) {
    return {
      presetId: matchedPreset.presetId ?? topicSlug,
      protocolName: matchedPreset.protocolName ?? toTitleCase(topic),
      protocolSlug: slug || matchedPreset.protocolSlug || topicSlug,
      familySlug: family || matchedPreset.familySlug || slug || topicSlug,
      startingPoints: Array.isArray(matchedPreset.startingPoints)
        ? matchedPreset.startingPoints
        : [],
      discoveryShards: Array.isArray(matchedPreset.discoveryShards)
        ? matchedPreset.discoveryShards
        : buildDefaultShards(matchedPreset.protocolName ?? toTitleCase(topic)),
      sectionSeams: Array.isArray(matchedPreset.sectionSeams)
        ? matchedPreset.sectionSeams
        : buildDefaultSections(),
    };
  }

  const protocolName = toTitleCase(topic);
  const protocolSlug = slug || topicSlug || "research-topic";
  return {
    presetId: "generic",
    protocolName,
    protocolSlug,
    familySlug: family || protocolSlug,
    startingPoints: [
      "No preset-specific starting points were applied.",
      "Refine the family slug, adjacent variants, and safety boundaries during the charter pass before landing any protocol page.",
    ],
    discoveryShards: buildDefaultShards(protocolName),
    sectionSeams: buildDefaultSections(),
  };
}

function buildSharedPromptHeader(spec) {
  return renderTemplate("shared-header.md", {
    PROTOCOL_NAME: spec.protocolName,
    PROTOCOL_SLUG: spec.protocolSlug,
    FAMILY_SLUG: spec.familySlug,
  }).trimEnd();
}

function buildWorkflowObject({ generatedAt, outDirRelative, spec, promptFiles, runnableCommands }) {
  const protocolPath = path.posix.join(
    "packages/health-commons/content/protocols",
    spec.familySlug,
    `${spec.protocolSlug}.md`,
  );
  const sourceDir = path.posix.join(
    "packages/health-commons/content/sources",
    spec.familySlug,
  );
  const artifactManifestPath = path.posix.join(
    "packages/health-commons/content/artifacts",
    spec.familySlug,
    "research-artifacts.json",
  );

  return {
    schemaVersion: "murph.research.orchestrator.init.v1",
    generatedAt,
    outputDir: outDirRelative,
    presetId: spec.presetId,
    protocol: {
      name: spec.protocolName,
      slug: spec.protocolSlug,
      familySlug: spec.familySlug,
      familyKey: `experiment_family:${spec.familySlug}`,
      protocolKey: `protocol_variant:${spec.familySlug}/${spec.protocolSlug}`,
      protocolPath,
      sourceDir,
      artifactManifestPath,
    },
    startingPoints: spec.startingPoints,
    discoveryShards: spec.discoveryShards,
    sectionSeams: spec.sectionSeams,
    promptFiles,
    runnableCommands,
  };
}

function buildCommandHelperScript() {
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
  --no-zip \\
  --send \\
  --wait \\
  --format json \\
  --model "\${RESEARCH_MODEL:-gpt-5.4-pro}" \\
  --wait-timeout "\${RESEARCH_WAIT_TIMEOUT:-45m}" \\
  --timeout "\${RESEARCH_TIMEOUT:-60m}" \\
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

function buildCommandWrapper(label, promptRelativePath) {
  return `#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
run_dir="$(cd "\${script_dir}/.." && pwd)"

exec "\${script_dir}/_run-review-gpt.sh" "${label}" "\${run_dir}/${promptRelativePath}" "\${run_dir}/responses/${label}.md"
`;
}

function buildRunbook({ outDirRelative, spec, runnableCommands, templateOnlyPrompts }) {
  const commandList = runnableCommands
    .map((command, index) => `${index + 1}. \`bash ${command}\``)
    .join("\n");
  const templateList = templateOnlyPrompts
    .map((promptPath) => `- \`${promptPath}\``)
    .join("\n");
  const discoverySummary = spec.discoveryShards
    .map((shard) => `- \`${shard.id}\`: ${shard.topic}`)
    .join("\n");

  return `# Research Orchestrator Scaffold

This workspace was generated by \`pnpm research:init\`.
It sets up the DAG-style review:gpt research prompts for **${spec.protocolName}** without launching any runs automatically.

## Protocol Target

- Protocol name: ${spec.protocolName}
- Protocol slug: ${spec.protocolSlug}
- Family slug: ${spec.familySlug}
- Output package: \`${outDirRelative}\`

## Discovery Shards

${discoverySummary}

## Run Now

These command wrappers are ready to run immediately from the repo root:

${commandList}

Each command writes:

- \`responses/<label>.md\`
- \`logs/<label>.result.json\`
- \`logs/<label>.stderr.log\`
- \`state/chat-urls/<label>.txt\` when a ChatGPT thread URL is detected

## Template-Only Later Stages

The later reducer, extraction, synthesis, and QA prompts are generated now, but they still contain \`TODO_*\` placeholders that depend on earlier outputs:

${templateList}

## Environment Knobs

- \`RESEARCH_MODEL\`: defaults to \`gpt-5.4-pro\`
- \`RESEARCH_WAIT_TIMEOUT\`: defaults to \`45m\`
- \`RESEARCH_TIMEOUT\`: defaults to \`60m\`

## Notes

- The generated command wrappers discover the repo root dynamically at runtime and do not hardcode absolute local paths.
- The legacy \`pnpm research\` runner remains unchanged. This scaffold is the new orchestrator entrypoint, not a replacement for the old shell flow yet.
- Use the charter output to refine shard boundaries before trusting the later template-only prompts verbatim.
`;
}

function parseArgs(argv) {
  let topic = "";
  let family = "";
  let slug = "";
  let outDir = "";
  let force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    switch (value) {
      case "--topic":
        topic = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--family":
        family = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--slug":
        slug = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--out-dir":
        outDir = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--force":
        force = true;
        break;
      case "-h":
      case "--help":
        usage(0);
        break;
      default:
        if (value.startsWith("--")) {
          throw new Error(`Unknown option: ${value}`);
        }
        if (!topic) {
          topic = value;
        } else {
          throw new Error(`Unexpected extra argument: ${value}`);
        }
    }
  }

  if (!topic.trim()) {
    throw new Error("Missing research topic.");
  }

  return {
    topic: topic.trim(),
    family: family.trim(),
    slug: slug.trim(),
    outDir: outDir.trim(),
    force,
  };
}

function main(argv) {
  const args = parseArgs(argv);
  const spec = resolveSpecification(args);
  const now = new Date();
  const timestamp = formatDirTimestamp(now);
  const outDir = path.resolve(
    repoRoot,
    args.outDir || path.join("output-packages", "research", `${spec.protocolSlug}-${timestamp}`),
  );

  ensureRepoLocalOutputDir(outDir);

  if (existsSync(outDir)) {
    const stat = lstatSync(outDir);
    if (!stat.isDirectory()) {
      throw new Error(`Output target is not a directory: ${toPosixRelative(outDir)}`);
    }
    if (!args.force) {
      throw new Error(`Output directory already exists: ${toPosixRelative(outDir)}`);
    }
    if (!isExistingScaffoldDir(outDir)) {
      throw new Error(
        `Refusing --force for a non-scaffold directory: ${toPosixRelative(outDir)}`,
      );
    }
    rmSync(outDir, { recursive: true, force: true });
  }

  const dirs = [
    outDir,
    path.join(outDir, "prompts"),
    path.join(outDir, "commands"),
    path.join(outDir, "responses"),
    path.join(outDir, "logs"),
    path.join(outDir, "state"),
    path.join(outDir, "state", "chat-urls"),
  ];

  for (const dir of dirs) {
    mkdirp(dir);
  }

  const sharedHeader = buildSharedPromptHeader(spec);
  const commonPromptTokens = {
    FAMILY_SLUG: spec.familySlug,
    PROTOCOL_NAME: spec.protocolName,
    PROTOCOL_SLUG: spec.protocolSlug,
  };
  const promptFiles = [];
  const runnableCommands = [];
  const templateOnlyPrompts = [];

  const charterPromptPath = path.join(outDir, "prompts", "01-charter.md");
  writeTextFile(
    charterPromptPath,
    renderTemplate("charter.md", {
      ...commonPromptTokens,
      SHARED_HEADER: sharedHeader,
      PRESET_STARTING_POINTS: formatBulletList(spec.startingPoints),
    }),
  );
  promptFiles.push("prompts/01-charter.md");

  const commandHelperPath = path.join(outDir, "commands", "_run-review-gpt.sh");
  writeExecutable(commandHelperPath, buildCommandHelperScript());

  const charterCommandPath = path.join(outDir, "commands", "01-charter.sh");
  writeExecutable(
    charterCommandPath,
    buildCommandWrapper("01-charter", "prompts/01-charter.md"),
  );
  runnableCommands.push("commands/01-charter.sh");

  spec.discoveryShards.forEach((shard, index) => {
    const ordinal = String(index + 2).padStart(2, "0");
    const baseName = `${ordinal}-discovery-${shard.id}`;
    const promptRelativePath = `prompts/${baseName}.md`;
    const promptPath = path.join(outDir, promptRelativePath);
    writeTextFile(
      promptPath,
      renderTemplate("discovery-shard.md", {
        ...commonPromptTokens,
        SHARED_HEADER: sharedHeader,
        SHARD_ID: shard.id,
        SHARD_TOPIC: shard.topic,
        SHARD_QUERY_STRINGS: formatBulletList(shard.queryStrings, (item) => `"${item}"`),
        SHARD_SOURCE_TYPES: formatBulletList(shard.sourceTypes),
        SHARD_DIRECT_EVIDENCE: formatBulletList(shard.directEvidence),
        SHARD_ADJACENT_EVIDENCE: formatBulletList(shard.adjacentEvidence),
        SHARD_ENDPOINT_FAMILIES: formatBulletList(shard.endpointFamilies),
      }),
    );
    promptFiles.push(promptRelativePath);

    const commandRelativePath = `commands/${baseName}.sh`;
    writeExecutable(
      path.join(outDir, commandRelativePath),
      buildCommandWrapper(baseName, promptRelativePath),
    );
    runnableCommands.push(commandRelativePath);
  });

  const templateSpecs = [
    {
      relativePath: "prompts/10-snowball-gap-fill.template.md",
      templateName: "snowball-gap-fill.md",
      replacements: {
        ...commonPromptTokens,
        SHARED_HEADER: sharedHeader,
        BACKBONE_SOURCE_KEYS_OR_TITLES: "TODO_BACKBONE_SOURCE_KEYS_OR_TITLES",
        KNOWN_GAPS: "TODO_KNOWN_GAPS",
      },
    },
    {
      relativePath: "prompts/11-source-ledger-reducer.template.md",
      templateName: "source-ledger-reducer.md",
      replacements: {
        ...commonPromptTokens,
        SHARED_HEADER: sharedHeader,
        DISCOVERY_OUTPUTS_SOURCE: "TODO_DISCOVERY_OUTPUTS_SOURCE",
        CHARTER_SOURCE: "TODO_CHARTER_SOURCE",
        EXISTING_SOURCE_PAGE_INVENTORY_SOURCE: "TODO_EXISTING_SOURCE_PAGE_INVENTORY_SOURCE",
      },
    },
    {
      relativePath: "prompts/12-source-extraction-batch.template.md",
      templateName: "source-extraction-batch.md",
      replacements: {
        ...commonPromptTokens,
        SHARED_HEADER: sharedHeader,
        BATCH_ID: "TODO_BATCH_ID",
        SOURCE_KEYS: "TODO_SOURCE_KEYS",
        CANONICAL_LEDGER_SOURCE: "TODO_CANONICAL_SOURCE_LEDGER_V1_SOURCE",
        BATCH_SOURCE: "TODO_SOURCE_EXTRACTION_BATCHES_V1_SOURCE",
      },
    },
    {
      relativePath: "prompts/30-page-builder.template.md",
      templateName: "page-builder.md",
      replacements: {
        ...commonPromptTokens,
        SHARED_HEADER: sharedHeader,
        CHARTER_SOURCE: "TODO_CHARTER_SOURCE",
        CANONICAL_LEDGER_SOURCE: "TODO_CANONICAL_SOURCE_LEDGER_V1_SOURCE",
        SOURCE_PAGE_DRAFTS_SOURCE: "TODO_SOURCE_PAGE_DRAFTS_SOURCE",
        SECTION_SYNTHESIS_SOURCE: "TODO_SECTION_SYNTHESIS_SOURCE",
        ARTIFACT_CANDIDATES_SOURCE: "TODO_ARTIFACT_CANDIDATES_SOURCE",
      },
    },
    {
      relativePath: "prompts/31-evidence-qa.template.md",
      templateName: "evidence-qa.md",
      replacements: {
        ...commonPromptTokens,
        SHARED_HEADER: sharedHeader,
        PROTOCOL_PACKAGE_DRAFT_SOURCE: "TODO_PROTOCOL_PACKAGE_DRAFT_SOURCE",
        CLAIMS_SOURCE: "TODO_SECTION_CLAIMS_V1_SOURCE",
        ATOMIC_FINDINGS_SOURCE: "TODO_ATOMIC_FINDINGS_V1_SOURCE",
      },
    },
    {
      relativePath: "prompts/32-safety-qa.template.md",
      templateName: "safety-qa.md",
      replacements: {
        ...commonPromptTokens,
        SHARED_HEADER: sharedHeader,
        PROTOCOL_PACKAGE_DRAFT_SOURCE: "TODO_PROTOCOL_PACKAGE_DRAFT_SOURCE",
        SAFETY_FINDINGS_SOURCE: "TODO_SAFETY_FINDINGS_SOURCE",
      },
    },
    {
      relativePath: "prompts/33-schema-artifact-qa.template.md",
      templateName: "schema-artifact-qa.md",
      replacements: {
        ...commonPromptTokens,
        SHARED_HEADER: sharedHeader,
        PROTOCOL_PACKAGE_DRAFT_SOURCE: "TODO_PROTOCOL_PACKAGE_DRAFT_SOURCE",
        ARTIFACT_MANIFEST_SOURCE: "TODO_ARTIFACT_MANIFEST_SOURCE",
      },
    },
    {
      relativePath: "prompts/34-final-landing-reducer.template.md",
      templateName: "final-landing-reducer.md",
      replacements: {
        ...commonPromptTokens,
        SHARED_HEADER: sharedHeader,
        PROTOCOL_PACKAGE_DRAFT_SOURCE: "TODO_PROTOCOL_PACKAGE_DRAFT_SOURCE",
        EVIDENCE_QA_SOURCE: "TODO_EVIDENCE_QA_SOURCE",
        SAFETY_QA_SOURCE: "TODO_SAFETY_QA_SOURCE",
        SCHEMA_ARTIFACT_QA_SOURCE: "TODO_SCHEMA_ARTIFACT_QA_SOURCE",
      },
    },
  ];

  spec.sectionSeams.forEach((section, index) => {
    templateSpecs.push({
      relativePath: `prompts/${String(20 + index).padStart(2, "0")}-section-synthesis-${section.id}.template.md`,
      templateName: "section-synthesis.md",
      replacements: {
        ...commonPromptTokens,
        SHARED_HEADER: sharedHeader,
        SECTION_ID: section.id,
        SECTION_FOCUS: section.focus,
        CANONICAL_LEDGER_SOURCE: "TODO_CANONICAL_SOURCE_LEDGER_V1_SOURCE",
        ATOMIC_FINDINGS_SOURCE: "TODO_ATOMIC_FINDINGS_V1_SOURCE",
        SOURCE_PAGE_DRAFTS_SOURCE: "TODO_SOURCE_PAGE_DRAFTS_SOURCE",
      },
    });
  });

  for (const templateSpec of templateSpecs) {
    writeTextFile(
      path.join(outDir, templateSpec.relativePath),
      renderTemplate(templateSpec.templateName, templateSpec.replacements),
    );
    promptFiles.push(templateSpec.relativePath);
    templateOnlyPrompts.push(templateSpec.relativePath);
  }

  const outDirRelative = toPosixRelative(outDir);
  const workflow = buildWorkflowObject({
    generatedAt: now.toISOString(),
    outDirRelative,
    spec,
    promptFiles,
    runnableCommands,
  });

  writeTextFile(
    path.join(outDir, "workflow.json"),
    JSON.stringify(workflow, null, 2) + "\n",
  );
  writeTextFile(
    path.join(outDir, "README.md"),
    buildRunbook({
      outDirRelative,
      spec,
      runnableCommands,
      templateOnlyPrompts,
    }),
  );

  console.log(`Initialized research orchestrator scaffold at ${outDirRelative}`);
  console.log(`Run next: bash ${path.posix.join(outDirRelative, "commands/01-charter.sh")}`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
