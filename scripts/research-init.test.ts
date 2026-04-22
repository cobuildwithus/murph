import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
      expect(existsSync(path.join(outDir, "README.md"))).toBe(true);
      expect(existsSync(path.join(outDir, "workflow.json"))).toBe(true);
      expect(existsSync(path.join(outDir, "prompts", "01-charter.md"))).toBe(true);
      expect(existsSync(path.join(outDir, "commands", "01-charter.sh"))).toBe(true);
      expect(existsSync(path.join(outDir, "commands", "02-discovery-direct-cwi.sh"))).toBe(false);

      const initWorkflow = JSON.parse(
        readFileSync(path.join(outDir, "workflow.json"), "utf8"),
      ) as {
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

      expect(initWorkflow.schemaVersion).toBe("murph.research.orchestrator.init.v2");
      expect(initWorkflow.status).toBe("charter_pending");
      expect(initWorkflow.topic).toBe("cold plunge");
      expect(initWorkflow.protocol.name).toBe("Cold Plunge");
      expect(initWorkflow.protocol.slug).toBe("cold-plunge");
      expect(initWorkflow.protocol.familySlug).toBe("cold-plunge");
      expect(initWorkflow.protocol.protocolKey).toBe("protocol_variant:cold-plunge/cold-plunge");
      expect(initWorkflow.protocol.provisional).toBe(true);
      expect(initWorkflow.promptFiles).toEqual(["prompts/01-charter.md"]);
      expect(initWorkflow.runnableCommands).toEqual(["commands/01-charter.sh"]);

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

      const helperScript = readFileSync(
        path.join(outDir, "commands", "_run-review-gpt.sh"),
        "utf8",
      );
      expect(helperScript).toContain("pnpm review:gpt");
      expect(helperScript).toContain("--send");
      expect(helperScript).toContain("--wait");
      expect(helperScript).toContain("murph-workspace");

      const initReadme = readFileSync(path.join(outDir, "README.md"), "utf8");
      expect(initReadme).toContain("Only the charter stage is runnable right now.");
      expect(initReadme).toContain("bash commands/01-charter.sh");
      expect(initReadme).toContain(`pnpm research:materialize --workspace ${path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep)}`);

      writeTextFileSync(path.join(outDir, "prompts", "02-discovery-stale.md"), "stale\n");
      writeTextFileSync(path.join(outDir, "commands", "02-discovery-stale.sh"), "#!/usr/bin/env bash\n");
      writeTextFileSync(
        path.join(outDir, "prompts", "20-section-synthesis-stale.template.md"),
        "stale\n",
      );

      const legacyWorkflow = {
        ...initWorkflow,
        schemaVersion: "murph.research.orchestrator.init.v1",
        status: "charter_pending",
        promptFiles: [
          "prompts/01-charter.md",
          "prompts/02-discovery-stale.md",
          "prompts/20-section-synthesis-stale.template.md",
        ],
        runnableCommands: ["commands/01-charter.sh", "commands/02-discovery-stale.sh"],
      };
      writeFileSync(
        path.join(outDir, "workflow.json"),
        JSON.stringify(legacyWorkflow, null, 2) + "\n",
        "utf8",
      );

      writeFileSync(
        path.join(outDir, "responses", "01-charter.md"),
        sampleCharterResponse,
        "utf8",
      );

      const materializeResult = runResearchMaterialize("--workspace", outDir);

      expect(materializeResult.status).toBe(0);
      expect(materializeResult.stderr).toBe("");
      expect(materializeResult.stdout).toContain("Materialized post-charter prompts");
      expect(existsSync(path.join(outDir, "commands", "02-discovery-direct-cwi.sh"))).toBe(true);
      expect(
        existsSync(path.join(outDir, "commands", "03-discovery-cardiovascular-safety.sh")),
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

      const materializedWorkflow = JSON.parse(
        readFileSync(path.join(outDir, "workflow.json"), "utf8"),
      ) as {
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
        runnableCommands: string[];
      };

      expect(materializedWorkflow.schemaVersion).toBe("murph.research.orchestrator.init.v2");
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
      expect(materializedWorkflow.discoveryShards).toHaveLength(2);
      expect(materializedWorkflow.discoveryShards[0]?.id).toBe("direct-cwi");
      expect(materializedWorkflow.sectionSeams).toHaveLength(2);
      expect(materializedWorkflow.sectionSeams[0]?.id).toBe("dose-implementation");
      expect(materializedWorkflow.sourceExtractionSchema.fields).toContain("researchEvidence");
      expect(materializedWorkflow.initialFilePlan.files[0]?.path).toBe(
        "packages/health-commons/content/protocols/cold-water-immersion/cold-plunge.md",
      );
      expect(materializedWorkflow.runnableCommands).toContain("commands/02-discovery-direct-cwi.sh");

      const discoveryPrompt = readFileSync(
        path.join(outDir, "prompts", "02-discovery-direct-cwi.md"),
        "utf8",
      );
      expect(discoveryPrompt).toContain("Shard ID: direct-cwi");
      expect(discoveryPrompt).toContain(
        "\"cold water immersion randomized trial adults temperature duration\"",
      );

      const sectionPrompt = readFileSync(
        path.join(outDir, "prompts", "20-section-synthesis-dose-implementation.template.md"),
        "utf8",
      );
      expect(sectionPrompt).toContain("Section ID: dose-implementation");
      expect(sectionPrompt).toContain("TODO_CANONICAL_SOURCE_LEDGER_V1_SOURCE");

      const pageBuilderPrompt = readFileSync(
        path.join(outDir, "prompts", "30-page-builder.template.md"),
        "utf8",
      );
      expect(pageBuilderPrompt).toContain("TODO_CHARTER_SOURCE");
      expect(pageBuilderPrompt).toContain("TODO_SECTION_SYNTHESIS_SOURCE");

      const materializedReadme = readFileSync(path.join(outDir, "README.md"), "utf8");
      expect(materializedReadme).toContain("materialized from the charter response");
      expect(materializedReadme).toContain("commands/02-discovery-direct-cwi.sh");
      expect(materializedReadme).toContain("Template-Only Later Stages");
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
});

function writeTextFileSync(filePath: string, content: string) {
  writeFileSync(filePath, content, "utf8");
}
