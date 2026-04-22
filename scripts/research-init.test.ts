import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const scriptPath = path.join(repoRoot, "scripts", "research-init.mjs");

function runResearchInit(...args: string[]) {
  return spawnSync("node", [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
    },
  });
}

describe("research init scaffold", () => {
  const researchOutputRoot = path.join(repoRoot, "output-packages", "research");

  it("wires the root package script to the research init helper", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["research:init"]).toBe("node scripts/research-init.mjs");
  });

  it("creates a cold-plunge scaffold with runnable charter and discovery commands", () => {
    mkdirSync(researchOutputRoot, { recursive: true });
    const tempRoot = mkdtempSync(path.join(researchOutputRoot, "tmp-research-init-"));
    const outDir = path.join(tempRoot, "cold-plunge-pack");

    try {
      const result = runResearchInit("cold plunge", "--out-dir", outDir);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Initialized research orchestrator scaffold");
      expect(existsSync(path.join(outDir, "README.md"))).toBe(true);
      expect(existsSync(path.join(outDir, "workflow.json"))).toBe(true);
      expect(existsSync(path.join(outDir, "prompts", "01-charter.md"))).toBe(true);
      expect(existsSync(path.join(outDir, "commands", "01-charter.sh"))).toBe(true);
      expect(existsSync(path.join(outDir, "commands", "02-discovery-direct-cwi.sh"))).toBe(true);
      expect(existsSync(path.join(outDir, "prompts", "10-snowball-gap-fill.template.md"))).toBe(true);

      const workflow = JSON.parse(
        readFileSync(path.join(outDir, "workflow.json"), "utf8"),
      ) as {
        presetId: string;
        protocol: {
          familySlug: string;
          name: string;
          protocolKey: string;
          slug: string;
        };
        runnableCommands: string[];
      };

      expect(workflow.presetId).toBe("cold-plunge");
      expect(workflow.protocol.name).toBe("Cold Plunge");
      expect(workflow.protocol.slug).toBe("cold-plunge");
      expect(workflow.protocol.familySlug).toBe("cold-water-immersion");
      expect(workflow.protocol.protocolKey).toBe(
        "protocol_variant:cold-water-immersion/cold-plunge",
      );
      expect(workflow.runnableCommands).toContain("commands/01-charter.sh");
      expect(workflow.runnableCommands).toContain("commands/02-discovery-direct-cwi.sh");

      const charterPrompt = readFileSync(
        path.join(outDir, "prompts", "01-charter.md"),
        "utf8",
      );
      expect(charterPrompt).toContain("Protocol name: Cold Plunge");
      expect(charterPrompt).toContain("Family slug: cold-water-immersion");
      expect(charterPrompt).toContain("experimentOnboarding block if this protocol is expected to power Murph experiment creation");

      const discoveryPrompt = readFileSync(
        path.join(outDir, "prompts", "02-discovery-direct-cwi.md"),
        "utf8",
      );
      expect(discoveryPrompt).toContain("Shard ID: direct-cwi");
      expect(discoveryPrompt).toContain("\"cold water immersion randomized trial adults temperature duration\"");
      expect(discoveryPrompt).toContain("Randomized trials");

      const sectionPrompt = readFileSync(
        path.join(outDir, "prompts", "20-section-synthesis-dose-implementation.template.md"),
        "utf8",
      );
      expect(sectionPrompt).toContain("Section ID: dose-implementation");
      expect(sectionPrompt).toContain("Section focus: human steps, dose, frequency, timing, immersion depth, duration, setup, adherence, and logging fields");
      expect(sectionPrompt).toContain("TODO_CANONICAL_SOURCE_LEDGER_V1_SOURCE");

      const snowballPrompt = readFileSync(
        path.join(outDir, "prompts", "10-snowball-gap-fill.template.md"),
        "utf8",
      );
      expect(snowballPrompt).toContain("TODO_BACKBONE_SOURCE_KEYS_OR_TITLES");
      expect(snowballPrompt).toContain("TODO_KNOWN_GAPS");

      const pageBuilderPrompt = readFileSync(
        path.join(outDir, "prompts", "30-page-builder.template.md"),
        "utf8",
      );
      expect(pageBuilderPrompt).toContain("TODO_CHARTER_SOURCE");
      expect(pageBuilderPrompt).toContain("TODO_SECTION_SYNTHESIS_SOURCE");

      const helperScript = readFileSync(
        path.join(outDir, "commands", "_run-review-gpt.sh"),
        "utf8",
      );
      expect(helperScript).toContain("pnpm review:gpt");
      expect(helperScript).toContain("--no-zip");
      expect(helperScript).toContain("--send");
      expect(helperScript).toContain("--wait");
      expect(helperScript).toContain("murph-workspace");

      const readme = readFileSync(path.join(outDir, "README.md"), "utf8");
      expect(readme).toContain("bash commands/01-charter.sh");
      expect(readme).toContain("commands/02-discovery-direct-cwi.sh");
      expect(readme).toContain("Template-Only Later Stages");
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
});
