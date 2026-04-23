import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const initScriptPath = path.join(repoRoot, "scripts", "research-init.mjs");
const materializeScriptPath = path.join(repoRoot, "scripts", "research-materialize.mjs");

function runResearchInit(...args: string[]) {
  return spawnSync("node", [initScriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
    },
  });
}

function runResearchMaterialize(...args: string[]) {
  return spawnSync("node", [materializeScriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
    },
  });
}

function runResearchPackageScript(
  packageScriptPath: string,
  outDir: string,
  prefix: string,
  extraArgs: string[] = [],
) {
  return spawnSync(
    "bash",
    [packageScriptPath, "--zip", "--out-dir", outDir, "--name", prefix, ...extraArgs],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
      },
    },
  );
}

function runGeneratedReviewGptHelper(
  helperScriptPath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) {
  return spawnSync("bash", [helperScriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
}

function runGeneratedReviewGptSend(
  helperScriptPath: string,
  label: string,
  promptFile: string,
  env: NodeJS.ProcessEnv,
) {
  return runGeneratedReviewGptHelper(helperScriptPath, ["send", label, promptFile], env);
}

function runGeneratedReviewGptHarvest(
  helperScriptPath: string,
  label: string,
  responseFile: string | null,
  env: NodeJS.ProcessEnv,
) {
  return runGeneratedReviewGptHelper(
    helperScriptPath,
    responseFile ? ["harvest", label, responseFile] : ["harvest", label],
    env,
  );
}

function parseZipPathFromOutput(output: string) {
  const match = Array.from(output.matchAll(/^ZIP: (.*) \(\d+ bytes\)$/gm)).at(-1);
  return match?.[1] ?? "";
}

function listZipEntries(zipPath: string) {
  return execFileSync("unzip", ["-Z1", zipPath], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const sampleCharterResponse = `# Cold plunge charter

## 1. Protocol scope
- Keep deliberate cold plunge as the primary protocol.
- Split winter swimming and contrast therapy into adjacent variants.

## 2. PICOTS-style research frame
- Population: general adults
- Intervention: deliberate cold-water immersion
- Comparator: passive recovery or usual routine
- Outcomes: cardiovascular, mood, dose fidelity

## CHARTER_MANIFEST_V1
\`\`\`json
{
  "protocolName": "Cold Plunge",
  "protocolSlug": "cold-plunge",
  "familySlug": "cold-water-immersion",
  "protocolAliases": ["cold water immersion", "cold plunge"],
  "variantDecision": "split_variants",
  "notes": ["Keep winter swimming separate from the default protocol."]
}
\`\`\`

## SEARCH_SHARDS_V1
\`\`\`json
{
  "shards": [
    {
      "id": "direct-cwi",
      "topic": "Direct cold-water immersion intervention studies.",
      "queryStrings": ["cold water immersion randomized trial adults temperature duration"],
      "sourceTypes": ["Randomized trials", "Controlled acute studies"],
      "directEvidence": ["Studies that match deliberate cold-water immersion protocols."],
      "adjacentEvidence": ["Winter swimming and contrast therapy should stay separate."],
      "endpointFamilies": ["Dose fidelity", "primary outcomes"]
    },
    {
      "id": "cardiovascular-safety",
      "topic": "Cold shock, blood pressure, arrhythmia, syncope, and contraindication evidence.",
      "queryStrings": ["cold water immersion arrhythmia blood pressure contraindications"],
      "sourceTypes": ["Safety reviews", "Case reports", "Clinical reviews"],
      "directEvidence": ["Safety findings tied to deliberate cold-water immersion."],
      "adjacentEvidence": ["ICU, rescue, or drowning literature used only as safety boundaries."],
      "endpointFamilies": ["Adverse events", "stop conditions"]
    }
  ]
}
\`\`\`

## SECTION_SEAMS_V1
\`\`\`json
{
  "sections": [
    {
      "id": "dose-implementation",
      "focus": "human steps, dose, timing, immersion depth, and logging fields"
    },
    {
      "id": "safety-contraindications",
      "focus": "avoid groups, stop conditions, adverse events, and clinician boundaries"
    }
  ]
}
\`\`\`

## SOURCE_EXTRACTION_SCHEMA_V1
\`\`\`json
{
  "fields": ["source metadata", "researchEvidence", "protocolEvidence", "finding IDs", "safety or adverse events"]
}
\`\`\`

## INITIAL_FILE_PLAN_V1
\`\`\`json
{
  "files": [
    {
      "kind": "protocol_page",
      "path": "packages/health-commons/content/protocols/cold-water-immersion/cold-plunge.md",
      "why": "primary protocol landing page"
    },
    {
      "kind": "family_page",
      "path": "packages/health-commons/content/families/cold-water-immersion.md",
      "why": "shared family taxonomy and related variants"
    }
  ]
}
\`\`\`
`;

describe("research init scaffold", () => {
  const researchOutputRoot = path.join(repoRoot, "output-packages", "research");

  it("wires the root package scripts to the research helpers", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["research:init"]).toBe("node scripts/research-init.mjs");
    expect(packageJson.scripts?.["research:materialize"]).toBe(
      "node scripts/research-materialize.mjs",
    );
  });

  it("creates a charter-only scaffold and materializes later seams from the charter response", () => {
    mkdirSync(researchOutputRoot, { recursive: true });
    const tempRoot = mkdtempSync(path.join(researchOutputRoot, "tmp-research-init-"));
    const outDir = path.join(tempRoot, "cold-plunge-pack");

    try {
      const initResult = runResearchInit("cold plunge", "--out-dir", outDir);

      expect(initResult.status).toBe(0);
      expect(initResult.stderr).toBe("");
      expect(initResult.stdout).toContain("Initialized research orchestrator scaffold");
      expect(initResult.stdout).toContain("pnpm research:materialize --workspace");
      expect(initResult.stdout).toContain("commands/01-charter.send.sh");
      expect(initResult.stdout).toContain("commands/01-charter.harvest.sh");
      expect(existsSync(path.join(outDir, "README.md"))).toBe(true);
      expect(existsSync(path.join(outDir, "workflow.json"))).toBe(true);
      expect(existsSync(path.join(outDir, "prompts", "01-charter.md"))).toBe(true);
      expect(existsSync(path.join(outDir, "commands", "01-charter.send.sh"))).toBe(true);
      expect(existsSync(path.join(outDir, "commands", "01-charter.harvest.sh"))).toBe(true);
      expect(existsSync(path.join(outDir, "commands", "02-discovery-direct-cwi.sh"))).toBe(false);
      expect(
        readFileSync(path.join(outDir, "commands", "01-charter.send.sh"), "utf8"),
      ).toContain('_run-review-gpt.sh" send "01-charter"');
      expect(
        readFileSync(path.join(outDir, "commands", "01-charter.harvest.sh"), "utf8"),
      ).toContain('_run-review-gpt.sh" harvest "01-charter"');

      const initWorkflow = JSON.parse(
        readFileSync(path.join(outDir, "workflow.json"), "utf8"),
      ) as {
        artifactContracts: Record<
          string,
          { requiredArtifacts: Array<{ fileName: string; logicalName: string; relativePath: string }> }
        >;
        schemaVersion: string;
        status: string;
        topic: string;
        protocol: {
          familySlug: string;
          name: string;
          provisional: boolean;
          protocolKey: string;
          slug: string;
        };
        promptFiles: string[];
        runnableCommands: string[];
      };

      expect(initWorkflow.schemaVersion).toBe("murph.research.orchestrator.init.v1");
      expect(initWorkflow.status).toBe("charter_pending");
      expect(initWorkflow.topic).toBe("cold plunge");
      expect(initWorkflow.protocol.name).toBe("Cold Plunge");
      expect(initWorkflow.protocol.slug).toBe("cold-plunge");
      expect(initWorkflow.protocol.familySlug).toBe("cold-plunge");
      expect(initWorkflow.protocol.protocolKey).toBe("protocol_variant:cold-plunge/cold-plunge");
      expect(initWorkflow.protocol.provisional).toBe(true);
      expect(initWorkflow.artifactContracts).toEqual({});
      expect(initWorkflow.promptFiles).toEqual(["prompts/01-charter.md"]);
      expect(initWorkflow.runnableCommands).toEqual([
        "commands/01-charter.send.sh",
        "commands/01-charter.harvest.sh",
      ]);

      const charterPrompt = readFileSync(
        path.join(outDir, "prompts", "01-charter.md"),
        "utf8",
      );
      expect(charterPrompt).toContain('User-supplied topic string: "cold plunge"');
      expect(charterPrompt).toContain("## CHARTER_MANIFEST_V1");
      expect(charterPrompt).toContain("## SEARCH_SHARDS_V1");
      expect(charterPrompt).toContain("## SECTION_SEAMS_V1");
      expect(charterPrompt).toContain("## SOURCE_EXTRACTION_SCHEMA_V1");
      expect(charterPrompt).toContain("## INITIAL_FILE_PLAN_V1");
      expect(charterPrompt).toContain("Treat `repo.snapshot.zip` as the authoritative source");

      const helperScript = readFileSync(
        path.join(outDir, "commands", "_run-review-gpt.sh"),
        "utf8",
      );
      expect(helperScript).toContain("pnpm exec cobuild-review-gpt");
      expect(helperScript).toContain('--config "${review_gpt_config}"');
      expect(helperScript).toContain('config/review-gpt-research.config.sh');
      expect(helperScript).toContain('assert_workspace_package_script');
      expect(helperScript).toContain('resolve_package_script_from_config');
      expect(helperScript).toContain('resolve_required_artifacts_from_workflow');
      expect(helperScript).toContain('normalize_required_artifacts_from_wake');
      expect(helperScript).toContain('artifact-contract-status.json');
      expect(helperScript).toContain("--send");
      expect(helperScript).toContain("thread wake");
      expect(helperScript).toContain("--skip-resume");
      expect(helperScript).toContain("murph-workspace");
      expect(helperScript).toContain('$0 send <label> <prompt-file>');
      expect(helperScript).toContain('$0 harvest <label> [response-file|-]');
      expect(helperScript).toContain('match(/https:\\/\\/chatgpt\\.com\\/c\\/\\S+/u)');
      expect(helperScript).toContain('matchAll(/https:\\/\\/chatgpt\\.com\\/c\\/\\S+/gu)');
      expect(helperScript).toContain('managed_browser_port');

      assertResearchReviewGptSupportFiles(outDir);

      const initReadme = readFileSync(path.join(outDir, "README.md"), "utf8");
      expect(initReadme).toContain("Only the charter send/harvest pair is runnable right now.");
      expect(initReadme).toContain("bash commands/01-charter.send.sh");
      expect(initReadme).toContain("bash commands/01-charter.harvest.sh");
      expect(initReadme).toContain(`pnpm research:materialize --workspace ${path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep)}`);

      writeTextFileSync(path.join(outDir, "prompts", "02-discovery-stale.md"), "stale\n");
      writeTextFileSync(path.join(outDir, "commands", "02-discovery-stale.sh"), "#!/usr/bin/env bash\n");
      writeTextFileSync(
        path.join(outDir, "prompts", "20-section-synthesis-stale.template.md"),
        "stale\n",
      );

      const staleWorkflow = {
        ...initWorkflow,
        schemaVersion: "murph.research.orchestrator.init.v1",
        status: "charter_pending",
        promptFiles: [
          "prompts/01-charter.md",
          "prompts/02-discovery-stale.md",
          "prompts/20-section-synthesis-stale.template.md",
        ],
        runnableCommands: [
          "commands/01-charter.send.sh",
          "commands/01-charter.harvest.sh",
          "commands/02-discovery-stale.send.sh",
          "commands/02-discovery-stale.harvest.sh",
        ],
      };
      writeFileSync(
        path.join(outDir, "workflow.json"),
        JSON.stringify(staleWorkflow, null, 2) + "\n",
        "utf8",
      );

      writeFileSync(
        path.join(outDir, "responses", "01-charter.md"),
        sampleCharterResponse,
        "utf8",
      );
      rmSync(path.join(outDir, "config"), { recursive: true, force: true });
      rmSync(path.join(outDir, "scripts"), { recursive: true, force: true });

      const materializeResult = runResearchMaterialize("--workspace", outDir);

      expect(materializeResult.status).toBe(0);
      expect(materializeResult.stderr).toBe("");
      expect(materializeResult.stdout).toContain("Materialized post-charter prompts");
      expect(materializeResult.stdout).toContain("commands/02-discovery-direct-cwi.send.sh");
      expect(materializeResult.stdout).toContain("commands/02-discovery-direct-cwi.harvest.sh");
      expect(existsSync(path.join(outDir, "commands", "02-discovery-direct-cwi.send.sh"))).toBe(true);
      expect(existsSync(path.join(outDir, "commands", "02-discovery-direct-cwi.harvest.sh"))).toBe(true);
      expect(
        readFileSync(path.join(outDir, "commands", "02-discovery-direct-cwi.send.sh"), "utf8"),
      ).toContain('_run-review-gpt.sh" send "02-discovery-direct-cwi"');
      expect(
        readFileSync(path.join(outDir, "commands", "02-discovery-direct-cwi.harvest.sh"), "utf8"),
      ).toContain('_run-review-gpt.sh" harvest "02-discovery-direct-cwi" "-"');
      expect(
        existsSync(path.join(outDir, "commands", "03-discovery-cardiovascular-safety.send.sh")),
      ).toBe(true);
      expect(
        existsSync(path.join(outDir, "commands", "03-discovery-cardiovascular-safety.harvest.sh")),
      ).toBe(true);
      expect(existsSync(path.join(outDir, "prompts", "02-discovery-direct-cwi.md"))).toBe(true);
      expect(existsSync(path.join(outDir, "prompts", "10-snowball-gap-fill.template.md"))).toBe(
        true,
      );
      expect(
        existsSync(
          path.join(outDir, "prompts", "20-section-synthesis-dose-implementation.template.md"),
        ),
      ).toBe(true);
      expect(existsSync(path.join(outDir, "prompts", "02-discovery-stale.md"))).toBe(false);
      expect(existsSync(path.join(outDir, "commands", "02-discovery-stale.sh"))).toBe(false);
      expect(
        existsSync(path.join(outDir, "prompts", "20-section-synthesis-stale.template.md")),
      ).toBe(false);
      assertResearchReviewGptSupportFiles(outDir);

      const materializedWorkflow = JSON.parse(
        readFileSync(path.join(outDir, "workflow.json"), "utf8"),
      ) as {
        artifactContracts: Record<
          string,
          { requiredArtifacts: Array<{ fileName: string; logicalName: string; relativePath: string }> }
        >;
        schemaVersion: string;
        status: string;
        materializedFrom: string;
        protocol: {
          familySlug: string;
          name: string;
          provisional: boolean;
          protocolKey: string;
          slug: string;
        };
        discoveryShards: Array<{ id: string; topic: string }>;
        sectionSeams: Array<{ id: string; focus: string }>;
        sourceExtractionSchema: { fields: string[] };
        initialFilePlan: { files: Array<{ kind: string; path: string; why: string }> };
        promptFiles: string[];
        runnableCommands: string[];
      };

      expect(materializedWorkflow.schemaVersion).toBe("murph.research.orchestrator.init.v1");
      expect(materializedWorkflow.status).toBe("materialized");
      expect(materializedWorkflow.materializedFrom).toBe(
        path.relative(repoRoot, path.join(outDir, "responses", "01-charter.md")).split(path.sep).join(path.posix.sep),
      );
      expect(materializedWorkflow.protocol.name).toBe("Cold Plunge");
      expect(materializedWorkflow.protocol.slug).toBe("cold-plunge");
      expect(materializedWorkflow.protocol.familySlug).toBe("cold-water-immersion");
      expect(materializedWorkflow.protocol.protocolKey).toBe(
        "protocol_variant:cold-water-immersion/cold-plunge",
      );
      expect(materializedWorkflow.protocol.provisional).toBe(false);
      expect(materializedWorkflow.artifactContracts["02-discovery-direct-cwi"]?.requiredArtifacts)
        .toEqual([
          {
            fileName: "source_candidates_v1.json",
            logicalName: "SOURCE_CANDIDATES_V1",
            relativePath: "downloads/02-discovery-direct-cwi/source_candidates_v1.json",
          },
        ]);
      expect(
        materializedWorkflow.artifactContracts["11-source-ledger-reducer"]?.requiredArtifacts,
      ).toEqual([
        {
          fileName: "canonical_source_ledger_v1.json",
          logicalName: "CANONICAL_SOURCE_LEDGER_V1",
          relativePath: "downloads/11-source-ledger-reducer/canonical_source_ledger_v1.json",
        },
        {
          fileName: "source_extraction_batches_v1.json",
          logicalName: "SOURCE_EXTRACTION_BATCHES_V1",
          relativePath: "downloads/11-source-ledger-reducer/source_extraction_batches_v1.json",
        },
      ]);
      expect(materializedWorkflow.artifactContracts["30-page-builder"]?.requiredArtifacts).toEqual([
        {
          fileName: "cold-plunge.md",
          logicalName: "PROTOCOL_PAGE_DRAFT",
          relativePath: "downloads/30-page-builder/downloads/cold-plunge.md",
        },
        {
          fileName: "cold-water-immersion.md",
          logicalName: "FAMILY_PAGE_DRAFT",
          relativePath: "downloads/30-page-builder/downloads/cold-water-immersion.md",
        },
        {
          fileName: "research-artifacts.json",
          logicalName: "ARTIFACT_MANIFEST_DRAFT",
          relativePath: "downloads/30-page-builder/downloads/research-artifacts.json",
        },
        {
          fileName: "cold-water-immersion-package-draft.zip",
          logicalName: "PACKAGE_DRAFT_ARCHIVE",
          relativePath: "downloads/30-page-builder/downloads/cold-water-immersion-package-draft.zip",
        },
      ]);
      expect(materializedWorkflow.discoveryShards).toHaveLength(2);
      expect(materializedWorkflow.discoveryShards[0]?.id).toBe("direct-cwi");
      expect(materializedWorkflow.sectionSeams).toHaveLength(2);
      expect(materializedWorkflow.sectionSeams[0]?.id).toBe("dose-implementation");
      expect(materializedWorkflow.sourceExtractionSchema.fields).toContain("researchEvidence");
      expect(materializedWorkflow.initialFilePlan.files[0]?.path).toBe(
        "packages/health-commons/content/protocols/cold-water-immersion/cold-plunge.md",
      );
      expect(materializedWorkflow.runnableCommands).toContain("commands/02-discovery-direct-cwi.send.sh");
      expect(materializedWorkflow.runnableCommands).toContain("commands/02-discovery-direct-cwi.harvest.sh");
      expect(materializedWorkflow.promptFiles).not.toContain(
        "prompts/33-schema-artifact-qa.template.md",
      );

      const discoveryPrompt = readFileSync(
        path.join(outDir, "prompts", "02-discovery-direct-cwi.md"),
        "utf8",
      );
      expect(discoveryPrompt).toContain("Shard ID: direct-cwi");
      expect(discoveryPrompt).toContain(
        "\"cold water immersion randomized trial adults temperature duration\"",
      );
      expect(discoveryPrompt).toContain("source_candidates_v1.json");

      const sectionPrompt = readFileSync(
        path.join(outDir, "prompts", "20-section-synthesis-dose-implementation.template.md"),
        "utf8",
      );
      expect(sectionPrompt).toContain("Section ID: dose-implementation");
      expect(sectionPrompt).toContain(
        `${path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep)}/downloads/11-source-ledger-reducer/downloads/CANONICAL_SOURCE_LEDGER_V1.json`,
      );
      expect(sectionPrompt).toContain(
        `${path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep)}/downloads/*/normalized/ATOMIC_FINDINGS_V1*.json`,
      );
      expect(sectionPrompt).toContain(
        `${path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep)}/downloads/*/downloads/*source-page-drafts*.md`,
      );

      const sourceLedgerReducerPrompt = readFileSync(
        path.join(outDir, "prompts", "11-source-ledger-reducer.template.md"),
        "utf8",
      );
      expect(sourceLedgerReducerPrompt).toContain("canonical_source_ledger_v1.json");
      expect(sourceLedgerReducerPrompt).toContain("source_extraction_batches_v1.json");
      expect(sourceLedgerReducerPrompt).toContain(
        `${path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep)}/downloads/0*-discovery-*/source_candidates*.json`,
      );
      expect(sourceLedgerReducerPrompt).toContain(
        `packages/health-commons/content/sources/cold-water-immersion/`,
      );

      const pageBuilderPrompt = readFileSync(
        path.join(outDir, "prompts", "30-page-builder.template.md"),
        "utf8",
      );
      expect(pageBuilderPrompt).toContain(
        `${path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep)}/responses/01-charter.md`,
      );
      expect(pageBuilderPrompt).toContain(
        `${path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep)}/responses/2*.md`,
      );
      expect(pageBuilderPrompt).toContain(
        `${path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep)}/downloads/*/downloads/ARTIFACT_CANDIDATES_V1*.json`,
      );

      const evidenceQaPrompt = readFileSync(
        path.join(outDir, "prompts", "31-evidence-qa.template.md"),
        "utf8",
      );
      expect(evidenceQaPrompt).toContain(
        `- ${path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep)}/downloads/30-page-builder/downloads/cold-plunge.md`,
      );
      expect(evidenceQaPrompt).toContain(
        `- ${path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep)}/downloads/30-page-builder/downloads/cold-water-immersion-package-draft.zip`,
      );
      expect(evidenceQaPrompt).toContain(
        `${path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep)}/responses/2*.md (extract SECTION_CLAIMS_V1 blocks from all section synthesis outputs)`,
      );
      expect(evidenceQaPrompt).toContain(
        `${path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep)}/downloads/*/downloads/ATOMIC_FINDINGS_V1*.json`,
      );

      expect(existsSync(path.join(outDir, "prompts", "33-schema-artifact-qa.template.md"))).toBe(
        false,
      );

      const finalReducerPrompt = readFileSync(
        path.join(outDir, "prompts", "34-final-landing-reducer.template.md"),
        "utf8",
      );
      expect(finalReducerPrompt).toContain(
        `- ${path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep)}/downloads/30-page-builder/downloads/cold-plunge.md`,
      );
      expect(finalReducerPrompt).toContain(
        `${path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep)}/responses/31-evidence-qa.md`,
      );
      expect(finalReducerPrompt).toContain(
        `${path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep)}/downloads/31-evidence-qa/thread.json`,
      );
      expect(finalReducerPrompt).toContain(
        `${path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep)}/responses/32-safety-qa.md`,
      );
      expect(finalReducerPrompt).toContain(
        `${path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep)}/downloads/32-safety-qa/thread.json`,
      );
      expect(finalReducerPrompt).not.toContain("SCHEMA_ARTIFACT_QA_SOURCE");

      const materializedReadme = readFileSync(path.join(outDir, "README.md"), "utf8");
      expect(materializedReadme).toContain("materialized from the charter response");
      expect(materializedReadme).toContain("commands/02-discovery-direct-cwi.send.sh");
      expect(materializedReadme).toContain("commands/02-discovery-direct-cwi.harvest.sh");
      expect(materializedReadme).toContain("Template-Only Later Stages");
      expect(materializedReadme).toContain("downloads/<label>/...");

      writeFileSync(
        path.join(outDir, "downloads", "sample-extraction.json"),
        "{\n  \"ok\": true\n}\n",
        "utf8",
      );
      writeFileSync(
        path.join(outDir, "state", "thread-exports", "sample.thread.json"),
        "{\n  \"assistantSnapshots\": []\n}\n",
        "utf8",
      );

      const packageOutDir = path.join(tempRoot, "research-package-out");
      mkdirSync(packageOutDir, { recursive: true });
      const packageResult = runResearchPackageScript(
        path.join(outDir, "scripts", "package-research-context.sh"),
        packageOutDir,
        "cold-plunge-research-context",
      );

      expect(packageResult.status).toBe(0);
      expect(packageResult.stderr).toBe("");
      expect(packageResult.stdout).toContain("Research workspace files added:");
      expect(packageResult.stdout).toContain("Research reference files added:");

      const zipPath = parseZipPathFromOutput(packageResult.stdout);
      expect(zipPath).toBeTruthy();
      expect(existsSync(zipPath)).toBe(true);

      const zipEntries = listZipEntries(zipPath);
      const relativeOutDir = path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep);
      expect(zipEntries).toContain(`${relativeOutDir}/workflow.json`);
      expect(zipEntries).toContain(`${relativeOutDir}/prompts/01-charter.md`);
      expect(zipEntries).toContain(`${relativeOutDir}/responses/01-charter.md`);
      expect(zipEntries).toContain(`${relativeOutDir}/downloads/sample-extraction.json`);
      expect(zipEntries).toContain(`${relativeOutDir}/state/thread-exports/sample.thread.json`);
      expect(zipEntries).toContain("agent-docs/product-specs/health-commons.md");
      expect(zipEntries).toContain("agent-docs/product-specs/experiment-onboarding.md");
      expect(zipEntries).toContain("packages/contracts/src/health-commons.ts");
      expect(zipEntries).toContain(
        "packages/health-commons/content/protocols/red-light-glasses-before-bed/red-light-glasses-before-bed.md",
      );
      expect(zipEntries).toContain("packages/health-commons/content/biomarkers/hrv-rmssd.md");
      expect(zipEntries).toContain(
        "packages/health-commons/content/artifacts/norwegian-4x4/research-artifacts.json",
      );
      expect(zipEntries).not.toContain("packages/health-commons/content/sources/sauna/pmid-37029766.md");

      const compatPackageResult = runResearchPackageScript(
        path.join(outDir, "scripts", "package-research-context.sh"),
        packageOutDir,
        "cold-plunge-research-context-compat",
        ["--no-docs", "--with-tests"],
      );

      expect(compatPackageResult.status).toBe(0);
      expect(compatPackageResult.stderr).toBe("");
      expect(compatPackageResult.stdout).toContain("Research workspace root:");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects output directories outside the repo root", () => {
    const externalRoot = mkdtempSync(path.join(os.tmpdir(), "murph-research-init-outside-"));

    try {
      const result = runResearchInit("cold plunge", "--out-dir", externalRoot);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("--out-dir must point to a directory inside this repo.");
    } finally {
      rmSync(externalRoot, { recursive: true, force: true });
    }
  });

  it("rejects unsafe force targets that are not prior research scaffolds", () => {
    mkdirSync(researchOutputRoot, { recursive: true });
    const tempRoot = mkdtempSync(path.join(researchOutputRoot, "tmp-research-init-force-"));
    const outDir = path.join(tempRoot, "unsafe-force-target");

    try {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path.join(outDir, "note.txt"), "not a scaffold\n", "utf8");

      const result = runResearchInit("cold plunge", "--out-dir", outDir, "--force");

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Refusing --force for a non-scaffold directory");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects materialization when the charter response is missing required JSON blocks", () => {
    mkdirSync(researchOutputRoot, { recursive: true });
    const tempRoot = mkdtempSync(path.join(researchOutputRoot, "tmp-research-materialize-"));
    const outDir = path.join(tempRoot, "missing-blocks");

    try {
      const initResult = runResearchInit("cold plunge", "--out-dir", outDir);
      expect(initResult.status).toBe(0);

      writeFileSync(
        path.join(outDir, "responses", "01-charter.md"),
        "This charter has no machine-readable blocks.\n",
        "utf8",
      );

      const result = runResearchMaterialize("--workspace", outDir);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Missing required CHARTER_MANIFEST_V1 JSON block");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects unsupported old research scaffold schema versions", () => {
    mkdirSync(researchOutputRoot, { recursive: true });
    const tempRoot = mkdtempSync(path.join(researchOutputRoot, "tmp-research-old-schema-"));
    const outDir = path.join(tempRoot, "old-schema");

    try {
      const initResult = runResearchInit("cold plunge", "--out-dir", outDir);
      expect(initResult.status).toBe(0);

      const workflowPath = path.join(outDir, "workflow.json");
      const workflow = JSON.parse(readFileSync(workflowPath, "utf8")) as {
        schemaVersion: string;
      };
      workflow.schemaVersion = "murph.research.orchestrator.init.v2";
      writeFileSync(workflowPath, JSON.stringify(workflow, null, 2) + "\n", "utf8");

      const result = runResearchMaterialize("--workspace", outDir);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "Unsupported workflow schema in output-packages/research/",
      );
      expect(result.stderr).toContain("murph.research.orchestrator.init.v2");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("recovers from send failure with stderr-only thread URL capture, config-only browser endpoint fallback, and stale per-label outputs already present", () => {
    mkdirSync(researchOutputRoot, { recursive: true });
    const tempRoot = mkdtempSync(path.join(researchOutputRoot, "tmp-research-helper-"));
    const outDir = path.join(tempRoot, "helper-failure-recovery");

    try {
      const initResult = runResearchInit("cold plunge", "--out-dir", outDir);
      expect(initResult.status).toBe(0);

      const stubBinDir = path.join(tempRoot, "bin");
      mkdirSync(stubBinDir, { recursive: true });

      const stubPnpmPath = path.join(stubBinDir, "pnpm");
      writeFileSync(
        stubPnpmPath,
        `#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ge 4 && "$1" == "exec" && "$2" == "cobuild-review-gpt" && "$3" == "thread" && "$4" == "wake" ]]; then
  output_dir=""
  chat_url=""
  browser_endpoint=""
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --output-dir)
        output_dir="$2"
        shift 2
        ;;
      --chat-url)
        chat_url="$2"
        shift 2
        ;;
      --browser-endpoint)
        browser_endpoint="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done

  mkdir -p "$output_dir/downloads"
  printf '%s\\n' 'artifact bytes' >"$output_dir/downloads/recovered.json"
  cat >"$output_dir/thread.json" <<JSON
{
  "chatUrl": "$chat_url",
  "browserEndpoint": "$browser_endpoint",
  "assistantSnapshots": [
    {
      "text": "Recovered intermediary thread snapshot that should not win"
    },
    {
      "text": "Recovered final thread snapshot"
    }
  ]
}
JSON
  cat >"$output_dir/status.json" <<JSON
{
  "chatUrl": "$chat_url",
  "downloadedArtifacts": ["$output_dir/downloads/recovered.json"]
}
JSON
  printf '%s\\n' '{"state":"completed"}'
  exit 0
fi

printf '%s\\n' '{"status":"sent"}'
printf '%s\\n' 'ChatGPT conversation URL: https://chatgpt.com/c/test-thread-123' >&2
printf '%s\\n' 'Draft staging failed' >&2
exit 17
`,
        "utf8",
      );
      chmodSync(stubPnpmPath, 0o755);

      const helperLabel = "99-recovery-check";
      const helperScriptPath = path.join(outDir, "commands", "_run-review-gpt.sh");
      const promptPath = path.join(outDir, "prompts", "01-charter.md");
      const responsePath = path.join(outDir, "responses", `${helperLabel}.md`);
      const chatUrlPath = path.join(outDir, "state", "chat-urls", `${helperLabel}.txt`);
      const threadExportPath = path.join(
        outDir,
        "state",
        "thread-exports",
        `${helperLabel}.thread.json`,
      );
      const wakeOutputDir = path.join(outDir, "downloads", helperLabel);
      mkdirSync(path.dirname(chatUrlPath), { recursive: true });
      mkdirSync(path.dirname(threadExportPath), { recursive: true });
      mkdirSync(wakeOutputDir, { recursive: true });
      writeTextFileSync(chatUrlPath, "https://chatgpt.com/c/stale-thread\n");
      writeTextFileSync(threadExportPath, '{"assistantSnapshots":[{"text":"stale export"}]}\n');
      writeTextFileSync(responsePath, "stale response\n");
      writeTextFileSync(path.join(wakeOutputDir, "status.json"), '{"downloadedArtifacts":["stale.json"]}\n');

      const helperSendResult = runGeneratedReviewGptSend(
        helperScriptPath,
        helperLabel,
        promptPath,
        {
          ...process.env,
          PATH: `${stubBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      );

      expect(helperSendResult.status).toBe(0);
      expect(helperSendResult.stderr).toBe("");
      expect(helperSendResult.stdout).toContain(
        `Result log: ${path.join(outDir, "logs", `${helperLabel}.send.result.json`)}`,
      );
      expect(helperSendResult.stdout).toContain("Recovered after send failure: yes");

      const helperHarvestResult = runGeneratedReviewGptHarvest(
        helperScriptPath,
        helperLabel,
        responsePath,
        {
          ...process.env,
          PATH: `${stubBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      );

      expect(helperHarvestResult.status).toBe(0);
      expect(helperHarvestResult.stderr).toBe("");
      expect(helperHarvestResult.stdout).toContain(`Response: ${responsePath}`);
      expect(helperHarvestResult.stdout).toContain(
        `Wake output: ${path.join(outDir, "downloads", helperLabel)}`,
      );

      const wakeThreadPath = path.join(outDir, "downloads", helperLabel, "thread.json");
      const wakeStatusPath = path.join(outDir, "downloads", helperLabel, "status.json");

      expect(existsSync(chatUrlPath)).toBe(true);
      expect(readFileSync(chatUrlPath, "utf8")).toBe("https://chatgpt.com/c/test-thread-123\n");
      expect(existsSync(threadExportPath)).toBe(true);
      expect(readFileSync(threadExportPath, "utf8")).toContain("Recovered final thread snapshot");
      expect(readFileSync(threadExportPath, "utf8")).toContain("http://127.0.0.1:9448");
      expect(existsSync(wakeThreadPath)).toBe(true);
      expect(existsSync(wakeStatusPath)).toBe(true);
      expect(readFileSync(responsePath, "utf8")).toContain("Recovered final thread snapshot");
      expect(readFileSync(responsePath, "utf8")).not.toContain("Recovered intermediary thread snapshot");
      expect(readFileSync(responsePath, "utf8")).not.toContain("stale response");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("normalizes a required discovery artifact into the canonical local filename", () => {
    mkdirSync(researchOutputRoot, { recursive: true });
    const tempRoot = mkdtempSync(path.join(researchOutputRoot, "tmp-research-helper-artifact-"));
    const outDir = path.join(tempRoot, "helper-artifact-success");

    try {
      expect(runResearchInit("cold plunge", "--out-dir", outDir).status).toBe(0);
      writeFileSync(path.join(outDir, "responses", "01-charter.md"), sampleCharterResponse, "utf8");
      expect(runResearchMaterialize("--workspace", outDir).status).toBe(0);

      const stubBinDir = path.join(tempRoot, "bin");
      mkdirSync(stubBinDir, { recursive: true });
      const stubPnpmPath = path.join(stubBinDir, "pnpm");
      writeFileSync(
        stubPnpmPath,
        `#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ge 4 && "$1" == "exec" && "$2" == "cobuild-review-gpt" && "$3" == "thread" && "$4" == "wake" ]]; then
  output_dir=""
  chat_url=""
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --output-dir)
        output_dir="$2"
        shift 2
        ;;
      --chat-url)
        chat_url="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done

  mkdir -p "$output_dir/downloads"
  cat >"$output_dir/downloads/unhelpful-export-name.json" <<'JSON'
{"records":[{"candidateId":"candidate:direct-cwi:001","title":"Example"}]}
JSON
  cat >"$output_dir/thread.json" <<JSON
{"chatUrl":"$chat_url","assistantSnapshots":[{"text":"Discovery finished."}]}
JSON
  cat >"$output_dir/status.json" <<JSON
{"chatUrl":"$chat_url","downloadedArtifacts":["$output_dir/downloads/unhelpful-export-name.json"]}
JSON
  exit 0
fi

printf '%s\\n' '{"status":"sent"}'
printf '%s\\n' 'ChatGPT conversation URL: https://chatgpt.com/c/test-thread-234' >&2
exit 0
`,
        "utf8",
      );
      chmodSync(stubPnpmPath, 0o755);

      const helperLabel = "02-discovery-direct-cwi";
      const helperScriptPath = path.join(outDir, "commands", "_run-review-gpt.sh");
      const promptPath = path.join(outDir, "prompts", `${helperLabel}.md`);
      const responsePath = path.join(outDir, "responses", `${helperLabel}.md`);
      const canonicalArtifactPath = path.join(
        outDir,
        "downloads",
        helperLabel,
        "source_candidates_v1.json",
      );
      const artifactStatusPath = path.join(
        outDir,
        "downloads",
        helperLabel,
        "artifact-contract-status.json",
      );

      const helperSendResult = runGeneratedReviewGptSend(
        helperScriptPath,
        helperLabel,
        promptPath,
        {
          ...process.env,
          PATH: `${stubBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      );
      expect(helperSendResult.status).toBe(0);

      const helperHarvestResult = runGeneratedReviewGptHarvest(
        helperScriptPath,
        helperLabel,
        null,
        {
          ...process.env,
          PATH: `${stubBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      );

      expect(helperHarvestResult.status).toBe(0);
      expect(helperHarvestResult.stderr).toBe("");
      expect(helperHarvestResult.stdout).toContain(`Artifact status: ${artifactStatusPath}`);
      expect(existsSync(canonicalArtifactPath)).toBe(true);
      expect(existsSync(responsePath)).toBe(false);
      expect(readFileSync(canonicalArtifactPath, "utf8")).toContain('"candidateId":"candidate:direct-cwi:001"');

      const artifactStatus = JSON.parse(readFileSync(artifactStatusPath, "utf8")) as {
        missingArtifacts: Array<unknown>;
        normalizedArtifacts: Array<{ logicalName: string; relativePath: string }>;
      };
      expect(artifactStatus.missingArtifacts).toEqual([]);
      expect(artifactStatus.normalizedArtifacts[0]?.logicalName).toBe("SOURCE_CANDIDATES_V1");
      expect(artifactStatus.normalizedArtifacts[0]?.relativePath).toBe(
        "downloads/02-discovery-direct-cwi/source_candidates_v1.json",
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("accepts a multi-artifact reducer seam from direct wake-output files without status-path hints", () => {
    mkdirSync(researchOutputRoot, { recursive: true });
    const tempRoot = mkdtempSync(path.join(researchOutputRoot, "tmp-research-helper-reducer-"));
    const outDir = path.join(tempRoot, "helper-reducer-success");

    try {
      expect(runResearchInit("cold plunge", "--out-dir", outDir).status).toBe(0);
      writeFileSync(path.join(outDir, "responses", "01-charter.md"), sampleCharterResponse, "utf8");
      expect(runResearchMaterialize("--workspace", outDir).status).toBe(0);

      const stubBinDir = path.join(tempRoot, "bin");
      mkdirSync(stubBinDir, { recursive: true });
      const stubPnpmPath = path.join(stubBinDir, "pnpm");
      writeFileSync(
        stubPnpmPath,
        `#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ge 4 && "$1" == "exec" && "$2" == "cobuild-review-gpt" && "$3" == "thread" && "$4" == "wake" ]]; then
  output_dir=""
  chat_url=""
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --output-dir)
        output_dir="$2"
        shift 2
        ;;
      --chat-url)
        chat_url="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done

  mkdir -p "$output_dir"
  cat >"$output_dir/canonical_source_ledger_v1.json" <<'JSON'
{"records":[{"sourceKey":"source_artifact:pmid-1"}]}
JSON
  cat >"$output_dir/source_extraction_batches_v1.json" <<'JSON'
{"batches":[{"batchId":"batch-001","sourceKeys":["source_artifact:pmid-1"]}]}
JSON
  cat >"$output_dir/thread.json" <<JSON
{"chatUrl":"$chat_url","assistantSnapshots":[{"text":"Reducer finished."}]}
JSON
  cat >"$output_dir/status.json" <<JSON
{"chatUrl":"$chat_url"}
JSON
  exit 0
fi

printf '%s\\n' '{"status":"sent"}'
printf '%s\\n' 'ChatGPT conversation URL: https://chatgpt.com/c/test-thread-456' >&2
exit 0
`,
        "utf8",
      );
      chmodSync(stubPnpmPath, 0o755);

      const helperLabel = "11-source-ledger-reducer";
      const helperScriptPath = path.join(outDir, "commands", "_run-review-gpt.sh");
      const promptPath = path.join(outDir, "prompts", `${helperLabel}.template.md`);
      const artifactStatusPath = path.join(
        outDir,
        "downloads",
        helperLabel,
        "artifact-contract-status.json",
      );

      const helperSendResult = runGeneratedReviewGptSend(
        helperScriptPath,
        helperLabel,
        promptPath,
        {
          ...process.env,
          PATH: `${stubBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      );
      expect(helperSendResult.status).toBe(0);

      const helperHarvestResult = runGeneratedReviewGptHarvest(
        helperScriptPath,
        helperLabel,
        null,
        {
          ...process.env,
          PATH: `${stubBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      );

      expect(helperHarvestResult.status).toBe(0);
      expect(helperHarvestResult.stderr).toBe("");
      expect(existsSync(path.join(outDir, "downloads", helperLabel, "canonical_source_ledger_v1.json"))).toBe(true);
      expect(
        existsSync(path.join(outDir, "downloads", helperLabel, "source_extraction_batches_v1.json")),
      ).toBe(true);

      const artifactStatus = JSON.parse(readFileSync(artifactStatusPath, "utf8")) as {
        missingArtifacts: Array<unknown>;
        normalizedArtifacts: Array<{ logicalName: string }>;
      };
      expect(artifactStatus.missingArtifacts).toEqual([]);
      expect(artifactStatus.normalizedArtifacts.map((entry) => entry.logicalName)).toEqual([
        "CANONICAL_SOURCE_LEDGER_V1",
        "SOURCE_EXTRACTION_BATCHES_V1",
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("accepts a page-builder seam from downloaded markdown and zip artifacts", () => {
    mkdirSync(researchOutputRoot, { recursive: true });
    const tempRoot = mkdtempSync(path.join(researchOutputRoot, "tmp-research-helper-page-builder-"));
    const outDir = path.join(tempRoot, "helper-page-builder-success");

    try {
      expect(runResearchInit("cold plunge", "--out-dir", outDir).status).toBe(0);
      writeFileSync(path.join(outDir, "responses", "01-charter.md"), sampleCharterResponse, "utf8");
      expect(runResearchMaterialize("--workspace", outDir).status).toBe(0);

      const stubBinDir = path.join(tempRoot, "bin");
      mkdirSync(stubBinDir, { recursive: true });
      const stubPnpmPath = path.join(stubBinDir, "pnpm");
      writeFileSync(
        stubPnpmPath,
        `#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ge 4 && "$1" == "exec" && "$2" == "cobuild-review-gpt" && "$3" == "thread" && "$4" == "wake" ]]; then
  output_dir=""
  chat_url=""
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --output-dir)
        output_dir="$2"
        shift 2
        ;;
      --chat-url)
        chat_url="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done

  mkdir -p "$output_dir/downloads"
  printf '%s\\n' '# cold plunge protocol draft' >"$output_dir/downloads/cold-plunge.md"
  printf '%s\\n' '# cold water immersion family draft' >"$output_dir/downloads/cold-water-immersion.md"
  cat >"$output_dir/downloads/research-artifacts.json" <<'JSON'
{"artifacts":[]}
JSON
  printf '%s\\n' 'PK' >"$output_dir/downloads/cold-water-immersion-package-draft.zip"
  cat >"$output_dir/thread.json" <<JSON
{"chatUrl":"$chat_url","assistantSnapshots":[{"text":"Attached the package draft files."}]}
JSON
  cat >"$output_dir/status.json" <<JSON
{"chatUrl":"$chat_url","downloadedArtifacts":["$output_dir/downloads/cold-plunge.md","$output_dir/downloads/cold-water-immersion.md","$output_dir/downloads/research-artifacts.json","$output_dir/downloads/cold-water-immersion-package-draft.zip"]}
JSON
  exit 0
fi

printf '%s\\n' '{"status":"sent"}'
printf '%s\\n' 'ChatGPT conversation URL: https://chatgpt.com/c/test-thread-678' >&2
exit 0
`,
        "utf8",
      );
      chmodSync(stubPnpmPath, 0o755);

      const helperLabel = "30-page-builder";
      const helperScriptPath = path.join(outDir, "commands", "_run-review-gpt.sh");
      const promptPath = path.join(outDir, "prompts", `${helperLabel}.template.md`);
      const artifactStatusPath = path.join(
        outDir,
        "downloads",
        helperLabel,
        "artifact-contract-status.json",
      );

      const helperSendResult = runGeneratedReviewGptSend(
        helperScriptPath,
        helperLabel,
        promptPath,
        {
          ...process.env,
          PATH: `${stubBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      );
      expect(helperSendResult.status).toBe(0);

      const helperHarvestResult = runGeneratedReviewGptHarvest(
        helperScriptPath,
        helperLabel,
        null,
        {
          ...process.env,
          PATH: `${stubBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      );

      expect(helperHarvestResult.status).toBe(0);
      expect(helperHarvestResult.stderr).toBe("");
      expect(existsSync(path.join(outDir, "downloads", helperLabel, "downloads", "cold-plunge.md"))).toBe(true);
      expect(existsSync(path.join(outDir, "downloads", helperLabel, "downloads", "cold-water-immersion.md"))).toBe(true);
      expect(
        existsSync(path.join(outDir, "downloads", helperLabel, "downloads", "research-artifacts.json")),
      ).toBe(true);
      expect(
        existsSync(
          path.join(outDir, "downloads", helperLabel, "downloads", "cold-water-immersion-package-draft.zip"),
        ),
      ).toBe(true);

      const artifactStatus = JSON.parse(readFileSync(artifactStatusPath, "utf8")) as {
        missingArtifacts: Array<unknown>;
        normalizedArtifacts: Array<{ logicalName: string }>;
      };
      expect(artifactStatus.missingArtifacts).toEqual([]);
      expect(artifactStatus.normalizedArtifacts.map((entry) => entry.logicalName)).toEqual([
        "PROTOCOL_PAGE_DRAFT",
        "FAMILY_PAGE_DRAFT",
        "ARTIFACT_MANIFEST_DRAFT",
        "PACKAGE_DRAFT_ARCHIVE",
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when a lone discovery attachment is not valid seam JSON", () => {
    mkdirSync(researchOutputRoot, { recursive: true });
    const tempRoot = mkdtempSync(path.join(researchOutputRoot, "tmp-research-helper-invalid-artifact-"));
    const outDir = path.join(tempRoot, "helper-artifact-invalid");

    try {
      expect(runResearchInit("cold plunge", "--out-dir", outDir).status).toBe(0);
      writeFileSync(path.join(outDir, "responses", "01-charter.md"), sampleCharterResponse, "utf8");
      expect(runResearchMaterialize("--workspace", outDir).status).toBe(0);

      const stubBinDir = path.join(tempRoot, "bin");
      mkdirSync(stubBinDir, { recursive: true });
      const stubPnpmPath = path.join(stubBinDir, "pnpm");
      writeFileSync(
        stubPnpmPath,
        `#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ge 4 && "$1" == "exec" && "$2" == "cobuild-review-gpt" && "$3" == "thread" && "$4" == "wake" ]]; then
  output_dir=""
  chat_url=""
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --output-dir)
        output_dir="$2"
        shift 2
        ;;
      --chat-url)
        chat_url="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done

  mkdir -p "$output_dir/downloads"
  printf '%s\\n' '# not json' >"$output_dir/downloads/stray.md"
  cat >"$output_dir/thread.json" <<JSON
{"chatUrl":"$chat_url","assistantSnapshots":[{"text":"Discovery finished with the wrong attachment."}]}
JSON
  cat >"$output_dir/status.json" <<JSON
{"chatUrl":"$chat_url","downloadedArtifacts":["$output_dir/downloads/stray.md"]}
JSON
  exit 0
fi

printf '%s\\n' '{"status":"sent"}'
printf '%s\\n' 'ChatGPT conversation URL: https://chatgpt.com/c/test-thread-567' >&2
exit 0
`,
        "utf8",
      );
      chmodSync(stubPnpmPath, 0o755);

      const helperLabel = "02-discovery-direct-cwi";
      const helperScriptPath = path.join(outDir, "commands", "_run-review-gpt.sh");
      const promptPath = path.join(outDir, "prompts", `${helperLabel}.md`);
      const artifactStatusPath = path.join(
        outDir,
        "downloads",
        helperLabel,
        "artifact-contract-status.json",
      );

      const helperSendResult = runGeneratedReviewGptSend(
        helperScriptPath,
        helperLabel,
        promptPath,
        {
          ...process.env,
          PATH: `${stubBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      );
      expect(helperSendResult.status).toBe(0);

      const helperHarvestResult = runGeneratedReviewGptHarvest(
        helperScriptPath,
        helperLabel,
        null,
        {
          ...process.env,
          PATH: `${stubBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      );

      expect(helperHarvestResult.status).toBe(68);
      expect(existsSync(artifactStatusPath)).toBe(true);

      const artifactStatus = JSON.parse(readFileSync(artifactStatusPath, "utf8")) as {
        missingArtifacts: Array<{ reason: string }>;
      };
      expect(artifactStatus.missingArtifacts[0]?.reason).toBe("invalid-json");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when a required discovery artifact never lands locally", () => {
    mkdirSync(researchOutputRoot, { recursive: true });
    const tempRoot = mkdtempSync(path.join(researchOutputRoot, "tmp-research-helper-missing-artifact-"));
    const outDir = path.join(tempRoot, "helper-artifact-missing");

    try {
      expect(runResearchInit("cold plunge", "--out-dir", outDir).status).toBe(0);
      writeFileSync(path.join(outDir, "responses", "01-charter.md"), sampleCharterResponse, "utf8");
      expect(runResearchMaterialize("--workspace", outDir).status).toBe(0);

      const stubBinDir = path.join(tempRoot, "bin");
      mkdirSync(stubBinDir, { recursive: true });
      const stubPnpmPath = path.join(stubBinDir, "pnpm");
      writeFileSync(
        stubPnpmPath,
        `#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ge 4 && "$1" == "exec" && "$2" == "cobuild-review-gpt" && "$3" == "thread" && "$4" == "wake" ]]; then
  output_dir=""
  chat_url=""
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --output-dir)
        output_dir="$2"
        shift 2
        ;;
      --chat-url)
        chat_url="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done

  mkdir -p "$output_dir"
  cat >"$output_dir/thread.json" <<JSON
{"chatUrl":"$chat_url","assistantSnapshots":[{"text":"Discovery finished but the attachment never persisted."}]}
JSON
  cat >"$output_dir/status.json" <<JSON
{"chatUrl":"$chat_url","downloadedArtifacts":[]}
JSON
  exit 0
fi

printf '%s\\n' '{"status":"sent"}'
printf '%s\\n' 'ChatGPT conversation URL: https://chatgpt.com/c/test-thread-345' >&2
exit 0
`,
        "utf8",
      );
      chmodSync(stubPnpmPath, 0o755);

      const helperLabel = "02-discovery-direct-cwi";
      const helperScriptPath = path.join(outDir, "commands", "_run-review-gpt.sh");
      const promptPath = path.join(outDir, "prompts", `${helperLabel}.md`);
      const artifactStatusPath = path.join(
        outDir,
        "downloads",
        helperLabel,
        "artifact-contract-status.json",
      );

      const helperSendResult = runGeneratedReviewGptSend(
        helperScriptPath,
        helperLabel,
        promptPath,
        {
          ...process.env,
          PATH: `${stubBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      );
      expect(helperSendResult.status).toBe(0);

      const helperHarvestResult = runGeneratedReviewGptHarvest(
        helperScriptPath,
        helperLabel,
        null,
        {
          ...process.env,
          PATH: `${stubBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      );

      expect(helperHarvestResult.status).toBe(68);
      expect(helperHarvestResult.stderr).toContain(
        "research step 02-discovery-direct-cwi is missing required local artifacts after thread wake",
      );
      expect(existsSync(artifactStatusPath)).toBe(true);

      const artifactStatus = JSON.parse(readFileSync(artifactStatusPath, "utf8")) as {
        missingArtifacts: Array<{ expectedFileName: string; logicalName: string }>;
      };
      expect(artifactStatus.missingArtifacts[0]?.logicalName).toBe("SOURCE_CANDIDATES_V1");
      expect(artifactStatus.missingArtifacts[0]?.expectedFileName).toBe(
        "source_candidates_v1.json",
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses to send when an override config resolves to a different workspace package script", () => {
    mkdirSync(researchOutputRoot, { recursive: true });
    const tempRoot = mkdtempSync(path.join(researchOutputRoot, "tmp-research-helper-mismatch-"));
    const outDir = path.join(tempRoot, "helper-config-mismatch");

    try {
      const initResult = runResearchInit("cold plunge", "--out-dir", outDir);
      expect(initResult.status).toBe(0);

      const wrongConfigPath = path.join(tempRoot, "wrong-review-gpt.config.sh");
      writeFileSync(
        wrongConfigPath,
        `#!/usr/bin/env bash
package_script="${path.join(tempRoot, "other-workspace", "scripts", "package-research-context.sh")}"
`,
        "utf8",
      );

      const stubBinDir = path.join(tempRoot, "bin");
      mkdirSync(stubBinDir, { recursive: true });
      const pnpmTouchedPath = path.join(tempRoot, "pnpm-touched");
      const stubPnpmPath = path.join(stubBinDir, "pnpm");
      writeFileSync(
        stubPnpmPath,
        `#!/usr/bin/env bash
set -euo pipefail
printf 'pnpm should not run\\n' >"${pnpmTouchedPath}"
exit 99
`,
        "utf8",
      );
      chmodSync(stubPnpmPath, 0o755);

      const helperLabel = "98-config-mismatch";
      const helperScriptPath = path.join(outDir, "commands", "_run-review-gpt.sh");
      const promptPath = path.join(outDir, "prompts", "01-charter.md");
      const helperResult = runGeneratedReviewGptSend(
        helperScriptPath,
        helperLabel,
        promptPath,
        {
          ...process.env,
          PATH: `${stubBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
          RESEARCH_REVIEW_GPT_CONFIG: wrongConfigPath,
        },
      );

      expect(helperResult.status).toBe(64);
      expect(helperResult.stderr).toContain(
        "review:gpt config resolves to a different research package script.",
      );
      expect(helperResult.stderr).toContain("Refusing to send because this would attach the wrong research workspace bundle.");
      expect(existsSync(pnpmTouchedPath)).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

function writeTextFileSync(filePath: string, content: string) {
  writeFileSync(filePath, content, "utf8");
}

function assertResearchReviewGptSupportFiles(outDir: string) {
  const configPath = path.join(outDir, "config", "review-gpt-research.config.sh");
  const workProfileConfigPath = path.join(outDir, "config", "review-gpt-work-profile.sh");
  const packageScriptPath = path.join(outDir, "scripts", "package-research-context.sh");

  expect(existsSync(configPath)).toBe(true);
  expect(existsSync(workProfileConfigPath)).toBe(true);
  expect(existsSync(packageScriptPath)).toBe(true);

  const researchConfig = readFileSync(configPath, "utf8");
  expect(researchConfig).toContain('package_script="${workspace_dir}/scripts/package-research-context.sh"');
  expect(researchConfig).toContain('repomix_attachment_format="${RESEARCH_REPOMIX_ATTACHMENT_FORMAT:-none}"');
  expect(researchConfig).toContain('research_thread_export_browser_endpoint="${RESEARCH_THREAD_EXPORT_BROWSER_ENDPOINT:-}"');
  expect(researchConfig).not.toContain('scripts/review-gpt.config.sh');

  const workProfileConfig = readFileSync(workProfileConfigPath, "utf8");
  expect(workProfileConfig).toContain('. "${script_dir}/review-gpt-research.config.sh"');
  expect(workProfileConfig).toContain('default_browser_binary="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"');
  expect(workProfileConfig).toContain('default_browser_user_data_dir="$HOME/Library/Application Support/MurphReviewGPT/Eragon"');
  expect(workProfileConfig).toContain('managed_browser_port="${RESEARCH_MANAGED_BROWSER_PORT:-9448}"');
  expect(workProfileConfig).toContain('research_thread_export_browser_endpoint="${RESEARCH_THREAD_EXPORT_BROWSER_ENDPOINT:-http://127.0.0.1:${managed_browser_port}}"');
  expect(workProfileConfig).not.toContain('scripts/review-gpt.config.sh');

  const packageScript = readFileSync(packageScriptPath, "utf8");
  expect(packageScript).toContain('add_file_if_exists "${workspace_relative}/workflow.json"');
  expect(packageScript).toContain('collect_workspace_dir "${workspace_relative}/prompts"');
  expect(packageScript).toContain('collect_workspace_dir "${workspace_relative}/responses"');
  expect(packageScript).toContain('collect_workspace_dir "${workspace_relative}/downloads"');
  expect(packageScript).toContain('collect_workspace_dir "${workspace_relative}/state/thread-exports"');
  expect(packageScript).toContain('agent-docs/product-specs/health-commons.md');
  expect(packageScript).toContain('packages/health-commons/content/protocols');
}
