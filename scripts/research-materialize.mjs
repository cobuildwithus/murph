#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

import {
  ORCHESTRATOR_SCHEMA_VERSION,
  assertWorkspaceDir,
  buildDiscoveryStepLabel,
  buildResearchArtifactContracts,
  buildCommandHelperScript,
  buildCommandWrapper,
  buildProtocolMetadata,
  buildSharedPromptHeader,
  formatBulletList,
  PAGE_BUILDER_LABEL,
  readWorkflow,
  renderTemplate,
  repoRoot,
  slugify,
  SOURCE_LEDGER_REDUCER_LABEL,
  toPosixRelative,
  writeExecutable,
  writeResearchReviewGptSupportFiles,
  writeTextFile,
} from "./research-orchestrator/lib.mjs";

function usage(exitCode = 2) {
  console.error(`Usage:
  pnpm research:materialize --workspace <dir> [options]

Options:
  --workspace <dir>         Existing research scaffold directory under output-packages/research/.
  --charter-response <file> Charter response file. Defaults to <workspace>/responses/01-charter.md.
  -h, --help                Show this help text.
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  let workspace = "";
  let charterResponse = "";

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    switch (value) {
      case "--workspace":
        workspace = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--charter-response":
        charterResponse = argv[index + 1] ?? "";
        index += 1;
        break;
      case "-h":
      case "--help":
        usage(0);
        break;
      default:
        if (value.startsWith("--")) {
          throw new Error(`Unknown option: ${value}`);
        }
        if (!workspace) {
          workspace = value;
        } else {
          throw new Error(`Unexpected extra argument: ${value}`);
        }
    }
  }

  if (!workspace.trim()) {
    throw new Error("Missing workspace path.");
  }

  return {
    workspace: workspace.trim(),
    charterResponse: charterResponse.trim(),
  };
}

function escapeRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractNamedJsonBlock(raw, name) {
  const patternText =
    String.raw`(?:^|\n)(?:#{1,6}\s*)?${escapeRegex(name)}:?\s*\n+` +
    "```json" +
    String.raw`\s*([\s\S]*?)\n` +
    "```";
  const pattern = new RegExp(patternText, "u");
  const match = raw.match(pattern);
  if (!match) {
    throw new Error(`Missing required ${name} JSON block in charter response.`);
  }

  try {
    return JSON.parse(match[1]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${name}: ${message}`);
  }
}

function normalizeStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array.`);
  }

  return value.map((entry, index) => {
    const normalized = String(entry ?? "").trim();
    if (!normalized) {
      throw new Error(`${label}[${index}] must be a non-empty string.`);
    }
    return normalized;
  });
}

function parseCharterManifest(rawManifest) {
  if (!rawManifest || typeof rawManifest !== "object" || Array.isArray(rawManifest)) {
    throw new Error("CHARTER_MANIFEST_V1 must be a JSON object.");
  }

  const protocolName = String(rawManifest.protocolName ?? "").trim();
  const protocolSlug = slugify(rawManifest.protocolSlug ?? "");
  const familySlug = slugify(rawManifest.familySlug ?? "");

  if (!protocolName) {
    throw new Error("CHARTER_MANIFEST_V1.protocolName is required.");
  }
  if (!protocolSlug) {
    throw new Error("CHARTER_MANIFEST_V1.protocolSlug is required.");
  }
  if (!familySlug) {
    throw new Error("CHARTER_MANIFEST_V1.familySlug is required.");
  }

  return {
    protocolName,
    protocolSlug,
    familySlug,
    protocolAliases: Array.isArray(rawManifest.protocolAliases)
      ? rawManifest.protocolAliases
          .map((entry) => String(entry ?? "").trim())
          .filter(Boolean)
      : [],
    variantDecision: String(rawManifest.variantDecision ?? "").trim() || "unspecified",
    notes: Array.isArray(rawManifest.notes)
      ? rawManifest.notes
          .map((entry) => String(entry ?? "").trim())
          .filter(Boolean)
      : [],
  };
}

function parseSearchShards(rawShards) {
  if (!rawShards || typeof rawShards !== "object" || Array.isArray(rawShards)) {
    throw new Error("SEARCH_SHARDS_V1 must be a JSON object.");
  }

  if (!Array.isArray(rawShards.shards) || rawShards.shards.length === 0) {
    throw new Error("SEARCH_SHARDS_V1.shards must be a non-empty array.");
  }

  const seenFileIds = new Set();
  return rawShards.shards.map((shard, index) => {
    if (!shard || typeof shard !== "object" || Array.isArray(shard)) {
      throw new Error(`SEARCH_SHARDS_V1.shards[${index}] must be an object.`);
    }

    const id = String(shard.id ?? "").trim();
    const fileId = slugify(id);
    const topic = String(shard.topic ?? "").trim();

    if (!id) {
      throw new Error(`SEARCH_SHARDS_V1.shards[${index}].id is required.`);
    }
    if (!fileId) {
      throw new Error(`SEARCH_SHARDS_V1.shards[${index}].id must be file-safe after slugification.`);
    }
    if (seenFileIds.has(fileId)) {
      throw new Error(`SEARCH_SHARDS_V1 contains duplicate shard ids after slugification: ${fileId}`);
    }
    if (!topic) {
      throw new Error(`SEARCH_SHARDS_V1.shards[${index}].topic is required.`);
    }

    seenFileIds.add(fileId);

    return {
      id,
      fileId,
      topic,
      queryStrings: normalizeStringArray(
        shard.queryStrings,
        `SEARCH_SHARDS_V1.shards[${index}].queryStrings`,
      ),
      sourceTypes: normalizeStringArray(
        shard.sourceTypes,
        `SEARCH_SHARDS_V1.shards[${index}].sourceTypes`,
      ),
      directEvidence: normalizeStringArray(
        shard.directEvidence,
        `SEARCH_SHARDS_V1.shards[${index}].directEvidence`,
      ),
      adjacentEvidence: normalizeStringArray(
        shard.adjacentEvidence,
        `SEARCH_SHARDS_V1.shards[${index}].adjacentEvidence`,
      ),
      endpointFamilies: normalizeStringArray(
        shard.endpointFamilies,
        `SEARCH_SHARDS_V1.shards[${index}].endpointFamilies`,
      ),
    };
  });
}

function parseSectionSeams(rawSections) {
  if (!rawSections || typeof rawSections !== "object" || Array.isArray(rawSections)) {
    throw new Error("SECTION_SEAMS_V1 must be a JSON object.");
  }

  if (!Array.isArray(rawSections.sections) || rawSections.sections.length === 0) {
    throw new Error("SECTION_SEAMS_V1.sections must be a non-empty array.");
  }

  const seenFileIds = new Set();
  return rawSections.sections.map((section, index) => {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      throw new Error(`SECTION_SEAMS_V1.sections[${index}] must be an object.`);
    }

    const id = String(section.id ?? "").trim();
    const fileId = slugify(id);
    const focus = String(section.focus ?? "").trim();

    if (!id) {
      throw new Error(`SECTION_SEAMS_V1.sections[${index}].id is required.`);
    }
    if (!fileId) {
      throw new Error(`SECTION_SEAMS_V1.sections[${index}].id must be file-safe after slugification.`);
    }
    if (seenFileIds.has(fileId)) {
      throw new Error(`SECTION_SEAMS_V1 contains duplicate section ids after slugification: ${fileId}`);
    }
    if (!focus) {
      throw new Error(`SECTION_SEAMS_V1.sections[${index}].focus is required.`);
    }

    seenFileIds.add(fileId);

    return {
      id,
      fileId,
      focus,
    };
  });
}

function parseSourceExtractionSchema(rawSchema) {
  if (!rawSchema || typeof rawSchema !== "object" || Array.isArray(rawSchema)) {
    throw new Error("SOURCE_EXTRACTION_SCHEMA_V1 must be a JSON object.");
  }

  return {
    fields: normalizeStringArray(rawSchema.fields, "SOURCE_EXTRACTION_SCHEMA_V1.fields"),
  };
}

function parseInitialFilePlan(rawPlan) {
  if (!rawPlan || typeof rawPlan !== "object" || Array.isArray(rawPlan)) {
    throw new Error("INITIAL_FILE_PLAN_V1 must be a JSON object.");
  }

  if (!Array.isArray(rawPlan.files) || rawPlan.files.length === 0) {
    throw new Error("INITIAL_FILE_PLAN_V1.files must be a non-empty array.");
  }

  return {
    files: rawPlan.files.map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`INITIAL_FILE_PLAN_V1.files[${index}] must be an object.`);
      }

      const kind = String(entry.kind ?? "").trim();
      const filePath = String(entry.path ?? "").trim();
      const why = String(entry.why ?? "").trim();

      if (!kind) {
        throw new Error(`INITIAL_FILE_PLAN_V1.files[${index}].kind is required.`);
      }
      if (!filePath) {
        throw new Error(`INITIAL_FILE_PLAN_V1.files[${index}].path is required.`);
      }
      if (!why) {
        throw new Error(`INITIAL_FILE_PLAN_V1.files[${index}].why is required.`);
      }

      return { kind, path: filePath, why };
    }),
  };
}

function parseCharterResponse(raw) {
  return {
    manifest: parseCharterManifest(extractNamedJsonBlock(raw, "CHARTER_MANIFEST_V1")),
    discoveryShards: parseSearchShards(extractNamedJsonBlock(raw, "SEARCH_SHARDS_V1")),
    sectionSeams: parseSectionSeams(extractNamedJsonBlock(raw, "SECTION_SEAMS_V1")),
    sourceExtractionSchema: parseSourceExtractionSchema(
      extractNamedJsonBlock(raw, "SOURCE_EXTRACTION_SCHEMA_V1"),
    ),
    initialFilePlan: parseInitialFilePlan(extractNamedJsonBlock(raw, "INITIAL_FILE_PLAN_V1")),
  };
}

function removeWorkspaceRelativeFile(workspaceDir, relativePath) {
  const normalizedRelativePath = String(relativePath ?? "")
    .trim()
    .split(path.posix.sep)
    .join(path.sep);
  if (!normalizedRelativePath) {
    return;
  }

  const absolutePath = path.resolve(workspaceDir, normalizedRelativePath);
  const relativeCheck = path.relative(workspaceDir, absolutePath);
  if (
    relativeCheck === "" ||
    relativeCheck.startsWith("..") ||
    path.isAbsolute(relativeCheck)
  ) {
    throw new Error(`Refusing to remove a path outside the workspace: ${relativePath}`);
  }

  rmSync(absolutePath, { force: true });
}

function cleanupGeneratedPostCharterFiles(workspaceDir, workflow) {
  const keepPaths = new Set([
    "prompts/01-charter.md",
    "commands/01-charter.sh",
    "commands/_run-review-gpt.sh",
  ]);
  const ownedGeneratedPaths = new Set(
    [...(Array.isArray(workflow.promptFiles) ? workflow.promptFiles : []), ...(Array.isArray(workflow.runnableCommands) ? workflow.runnableCommands : [])]
      .map((entry) => String(entry ?? "").trim())
      .filter((entry) => entry && !keepPaths.has(entry)),
  );

  if (ownedGeneratedPaths.size > 0) {
    for (const relativePath of ownedGeneratedPaths) {
      removeWorkspaceRelativeFile(workspaceDir, relativePath);
    }
    return;
  }

  const promptDir = path.join(workspaceDir, "prompts");
  const commandDir = path.join(workspaceDir, "commands");

  const removablePromptPattern = /^(?:0[2-9]|1[0-2]|2\d|3[0-4])-.*\.md$/u;
  const removableCommandPattern = /^(?:0[2-9]|[1-9]\d)-.*\.sh$/u;

  if (existsSync(promptDir)) {
    for (const entry of readdirSync(promptDir)) {
      if (entry !== "01-charter.md" && removablePromptPattern.test(entry)) {
        removeWorkspaceRelativeFile(workspaceDir, path.posix.join("prompts", entry));
      }
    }
  }

  if (existsSync(commandDir)) {
    for (const entry of readdirSync(commandDir)) {
      if (!["_run-review-gpt.sh", "01-charter.sh"].includes(entry) && removableCommandPattern.test(entry)) {
        removeWorkspaceRelativeFile(workspaceDir, path.posix.join("commands", entry));
      }
    }
  }
}

function buildLaterTemplateSpecs(commonPromptTokens, sharedHeader, sectionSeams) {
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
      relativePath: `prompts/${SOURCE_LEDGER_REDUCER_LABEL}.template.md`,
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
      relativePath: "prompts/34-final-landing-reducer.template.md",
      templateName: "final-landing-reducer.md",
      replacements: {
        ...commonPromptTokens,
        SHARED_HEADER: sharedHeader,
        PROTOCOL_PACKAGE_DRAFT_SOURCE: "TODO_PROTOCOL_PACKAGE_DRAFT_SOURCE",
        EVIDENCE_QA_SOURCE: "TODO_EVIDENCE_QA_SOURCE",
        SAFETY_QA_SOURCE: "TODO_SAFETY_QA_SOURCE",
      },
    },
  ];

  sectionSeams.forEach((section, index) => {
    templateSpecs.push({
      relativePath: `prompts/${String(20 + index).padStart(2, "0")}-section-synthesis-${section.fileId}.template.md`,
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

  return templateSpecs;
}

function buildPageBuilderDraftSourceList(outDirRelative, protocolSlug, familySlug) {
  return formatBulletList([
    `${outDirRelative}/downloads/${PAGE_BUILDER_LABEL}/downloads/${protocolSlug}.md`,
    `${outDirRelative}/downloads/${PAGE_BUILDER_LABEL}/downloads/${familySlug}.md`,
    `${outDirRelative}/downloads/${PAGE_BUILDER_LABEL}/downloads/${familySlug}-package-draft.zip`,
  ]);
}

function buildRunbook({
  outDirRelative,
  manifest,
  charterSourceRelative,
  discoveryShards,
  runnableCommands,
  templateOnlyPrompts,
}) {
  const commandList = runnableCommands
    .slice(1)
    .map((command, index) => `${index + 1}. \`bash ${command}\``)
    .join("\n");
  const templateList = templateOnlyPrompts
    .map((promptPath) => `- \`${promptPath}\``)
    .join("\n");
  const discoverySummary = discoveryShards
    .map((shard) => `- \`${shard.id}\`: ${shard.topic}`)
    .join("\n");

  return `# Research Orchestrator Scaffold

This workspace was generated by \`pnpm research:init\` and then materialized from the charter response at \`${charterSourceRelative}\`.

## Resolved Identity

- Protocol name: ${manifest.protocolName}
- Protocol slug: ${manifest.protocolSlug}
- Family slug: ${manifest.familySlug}
- Output package: \`${outDirRelative}\`

## Discovery Shards

${discoverySummary}

## Run Next

The discovery tranche is now runnable from the repo root:

${commandList}

Each command writes:

- \`responses/<label>.md\`
- \`logs/<label>.result.json\`
- \`logs/<label>.stderr.log\`
- \`state/chat-urls/<label>.txt\` when a ChatGPT thread URL is detected
- the canonical machine-readable seam artifact under \`downloads/<label>/...\` when the prompt requests one

## Template-Only Later Stages

The later reducer, extraction, synthesis, and QA prompts are generated now, but they still contain \`TODO_*\` placeholders that depend on earlier outputs:

${templateList}

## Notes

- Re-running \`pnpm research:materialize --workspace ${outDirRelative}\` replaces generated post-charter prompts and commands inside this workspace.
- The legacy \`pnpm research\` runner remains unchanged. This scaffold is a separate charter-first orchestrator path.
`;
}

function main(argv) {
  const args = parseArgs(argv);
  const workspaceDir = path.resolve(repoRoot, args.workspace);
  assertWorkspaceDir(workspaceDir);

  const workflow = readWorkflow(workspaceDir);
  const charterResponsePath = path.resolve(
    repoRoot,
    args.charterResponse || path.join(workspaceDir, workflow.charterResponseFile ?? "responses/01-charter.md"),
  );

  if (!existsSync(charterResponsePath)) {
    throw new Error(`Missing charter response file: ${toPosixRelative(charterResponsePath)}`);
  }

  const charterArtifacts = parseCharterResponse(readFileSync(charterResponsePath, "utf8"));
  cleanupGeneratedPostCharterFiles(workspaceDir, workflow);

  const helperScriptPath = path.join(workspaceDir, "commands", "_run-review-gpt.sh");
  const helperScriptContent = buildCommandHelperScript();
  if (!existsSync(helperScriptPath) || readFileSync(helperScriptPath, "utf8") !== helperScriptContent) {
    writeExecutable(helperScriptPath, helperScriptContent);
  }
  writeResearchReviewGptSupportFiles(workspaceDir);

  const materializedSpec = {
    protocolName: charterArtifacts.manifest.protocolName,
    protocolSlug: charterArtifacts.manifest.protocolSlug,
    familySlug: charterArtifacts.manifest.familySlug,
  };
  const sharedHeader = buildSharedPromptHeader(materializedSpec);
  const commonPromptTokens = {
    PROTOCOL_NAME: materializedSpec.protocolName,
    PROTOCOL_SLUG: materializedSpec.protocolSlug,
    FAMILY_SLUG: materializedSpec.familySlug,
  };

  const promptFiles = ["prompts/01-charter.md"];
  const runnableCommands = ["commands/01-charter.sh"];
  const templateOnlyPrompts = [];

  charterArtifacts.discoveryShards.forEach((shard, index) => {
    const baseName = buildDiscoveryStepLabel(index, shard.fileId);
    const promptRelativePath = `prompts/${baseName}.md`;
    writeTextFile(
      path.join(workspaceDir, promptRelativePath),
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
      path.join(workspaceDir, commandRelativePath),
      buildCommandWrapper(baseName, promptRelativePath),
    );
    runnableCommands.push(commandRelativePath);
  });

  const templateSpecs = buildLaterTemplateSpecs(
    commonPromptTokens,
    sharedHeader,
    charterArtifacts.sectionSeams,
  );

  for (const templateSpec of templateSpecs) {
    writeTextFile(
      path.join(workspaceDir, templateSpec.relativePath),
      renderTemplate(templateSpec.templateName, templateSpec.replacements),
    );
    promptFiles.push(templateSpec.relativePath);
    templateOnlyPrompts.push(templateSpec.relativePath);
  }

  const outDirRelative = toPosixRelative(workspaceDir);
  const pageBuilderDraftSource = buildPageBuilderDraftSourceList(
    outDirRelative,
    materializedSpec.protocolSlug,
    materializedSpec.familySlug,
  );
  const updatedWorkflow = {
    ...workflow,
    schemaVersion: ORCHESTRATOR_SCHEMA_VERSION,
    status: "materialized",
    materializedAt: new Date().toISOString(),
    materializedFrom: toPosixRelative(charterResponsePath),
    protocol: {
      ...buildProtocolMetadata(
        charterArtifacts.manifest.protocolName,
        charterArtifacts.manifest.protocolSlug,
        charterArtifacts.manifest.familySlug,
      ),
      provisional: false,
    },
    charterManifest: charterArtifacts.manifest,
    sourceExtractionSchema: charterArtifacts.sourceExtractionSchema,
    initialFilePlan: charterArtifacts.initialFilePlan,
    artifactContracts: buildResearchArtifactContracts({
      discoveryShards: charterArtifacts.discoveryShards,
      includeSourceLedgerReducer: true,
      includePageBuilder: true,
      protocolSlug: materializedSpec.protocolSlug,
      familySlug: materializedSpec.familySlug,
    }),
    discoveryShards: charterArtifacts.discoveryShards.map(({ fileId, ...rest }) => rest),
    sectionSeams: charterArtifacts.sectionSeams.map(({ fileId, ...rest }) => rest),
    promptFiles,
    runnableCommands,
  };

  writeTextFile(
    path.join(workspaceDir, "workflow.json"),
    JSON.stringify(updatedWorkflow, null, 2) + "\n",
  );
  writeTextFile(
    path.join(workspaceDir, "README.md"),
    buildRunbook({
      outDirRelative,
      manifest: charterArtifacts.manifest,
      charterSourceRelative: toPosixRelative(charterResponsePath),
      discoveryShards: charterArtifacts.discoveryShards,
      runnableCommands,
      templateOnlyPrompts,
    }),
  );

  // Patch the late-stage templates with the artifact-first page-builder sources so
  // downstream manual or scripted materialization uses the stable downloads path.
  const lateStageTemplatePatches = [
    {
      relativePath: "prompts/31-evidence-qa.template.md",
      replacements: {
        PROTOCOL_PACKAGE_DRAFT_SOURCE: pageBuilderDraftSource,
      },
    },
    {
      relativePath: "prompts/32-safety-qa.template.md",
      replacements: {
        PROTOCOL_PACKAGE_DRAFT_SOURCE: pageBuilderDraftSource,
      },
    },
    {
      relativePath: "prompts/34-final-landing-reducer.template.md",
      replacements: {
        PROTOCOL_PACKAGE_DRAFT_SOURCE: pageBuilderDraftSource,
      },
    },
  ];

  for (const { relativePath, replacements } of lateStageTemplatePatches) {
    const absolutePath = path.join(workspaceDir, relativePath);
    let content = readFileSync(absolutePath, "utf8");
    for (const [token, value] of Object.entries(replacements)) {
      content = content.replaceAll(`TODO_${token}`, value);
    }
    writeTextFile(absolutePath, content);
  }

  console.log(`Materialized post-charter prompts at ${outDirRelative}`);
  if (runnableCommands.length > 1) {
    console.log(`Run next: bash ${path.posix.join(outDirRelative, runnableCommands[1])}`);
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
