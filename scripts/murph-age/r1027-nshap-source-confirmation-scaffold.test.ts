import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1027_NSHAP_SOURCE_CONFIRMATION_SCAFFOLD_SCHEMA_VERSION,
  runR1027NshapSourceConfirmationScaffold,
} from "./r1027-nshap-source-confirmation-scaffold.ts";

describe("R1027 NSHAP source confirmation scaffold", () => {
  it("creates a false-by-default local confirmation template without unlocking source labels", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1027-"));
    try {
      const paths = pathsFor(tmp);
      const { output, outputPath } = await runR1027NshapSourceConfirmationScaffold({
        confirmationPath: paths.confirmationPath,
        createdAt: "2026-05-14T03:00:00.000Z",
        outputDir: paths.outputDir,
      });

      expect(path.basename(outputPath)).toBe("r1027-nshap-source-confirmation-scaffold.latest.json");
      expect(output.schemaVersion).toBe(R1027_NSHAP_SOURCE_CONFIRMATION_SCAFFOLD_SCHEMA_VERSION);
      expect(output.summary).toEqual({
        conclusion: "nshap_confirmation_template_created_blocking_by_default",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1027: false,
        sourceConfirmationUnlocked: false,
      });
      expect(output.confirmationScaffold).toMatchObject({
        existingConfirmationPreserved: false,
        falseFieldCountBand: "10+",
        status: "created_false_by_default",
        trueFieldCountBand: "0",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const template = JSON.parse(await readFile(paths.confirmationPath, "utf8"));
      expect(template.schema_version).toBe("murph.age.local.nshap-public-use-confirmation.v0");
      expect(Object.entries(template).filter(([key]) => key.startsWith("user_confirms_")).map(([, value]) => value))
        .toEqual(Array(11).fill(false));

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain(".dta");
      expect(persisted).not.toContain(".zip");
      expect(persisted).not.toContain("ICPSR_");
      expect(persisted).not.toContain("\"rowValues\":");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("preserves an existing local confirmation file by default", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1027-preserve-"));
    try {
      const paths = pathsFor(tmp);
      await mkdir(path.dirname(paths.confirmationPath), { recursive: true });
      await writeFile(paths.confirmationPath, `${JSON.stringify({
        schema_version: "murph.age.local.nshap-public-use-confirmation.v0",
        user_confirms_terms_allow_local_research_rows: true,
      }, null, 2)}\n`);

      const { output } = await runR1027NshapSourceConfirmationScaffold({
        confirmationPath: paths.confirmationPath,
        createdAt: "2026-05-14T03:00:00.000Z",
        outputDir: paths.outputDir,
      });

      expect(output.summary.conclusion).toBe("nshap_confirmation_template_preserved_existing_file");
      expect(output.confirmationScaffold).toMatchObject({
        existingConfirmationPreserved: true,
        falseFieldCountBand: "10+",
        status: "existing_confirmation_preserved",
        trueFieldCountBand: "1-9",
      });
      const preserved = JSON.parse(await readFile(paths.confirmationPath, "utf8"));
      expect(preserved.user_confirms_terms_allow_local_research_rows).toBe(true);
      expect("user_confirms_aggregate_output_permission_clear" in preserved).toBe(false);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("overwrites only when explicitly requested", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1027-overwrite-"));
    try {
      const paths = pathsFor(tmp);
      await mkdir(path.dirname(paths.confirmationPath), { recursive: true });
      await writeFile(paths.confirmationPath, `${JSON.stringify({
        schema_version: "murph.age.local.nshap-public-use-confirmation.v0",
        user_confirms_terms_allow_local_research_rows: true,
      }, null, 2)}\n`);

      const { output } = await runR1027NshapSourceConfirmationScaffold({
        confirmationPath: paths.confirmationPath,
        createdAt: "2026-05-14T03:00:00.000Z",
        outputDir: paths.outputDir,
        overwrite: true,
      });

      expect(output.summary.conclusion).toBe("nshap_confirmation_template_created_blocking_by_default");
      expect(output.confirmationScaffold.trueFieldCountBand).toBe("0");
      const template = JSON.parse(await readFile(paths.confirmationPath, "utf8"));
      expect(template.user_confirms_terms_allow_local_research_rows).toBe(false);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1027-cli-"));
    try {
      const paths = pathsFor(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1027-nshap-source-confirmation-scaffold.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_NSHAP_SOURCE_CONFIRMATION_PATH: paths.confirmationPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        conclusion: "nshap_confirmation_template_created_blocking_by_default",
        falseFieldCountBand: "10+",
        packetId: "r1027-nshap-source-confirmation-scaffold",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1027: false,
        schemaVersion: R1027_NSHAP_SOURCE_CONFIRMATION_SCAFFOLD_SCHEMA_VERSION,
        sourceConfirmationUnlocked: false,
        status: "research-local-aggregate-only",
        trueFieldCountBand: "0",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain(".local.json");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function pathsFor(tmp: string): { confirmationPath: string; outputDir: string } {
  return {
    confirmationPath: path.join(tmp, "source-confirmations", "nshap-confirmation.local.json"),
    outputDir: path.join(tmp, "out"),
  };
}
