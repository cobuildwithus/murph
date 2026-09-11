import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assessmentResponseSchema } from "@murphai/contracts";
import { expect, it } from "vitest";
import { importAssessmentResponse, initializeVault, listAssessmentResponses, readAssessmentResponse } from "../src/index.ts";

it("validates normalized assessment links before committing and preserves import evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "murph-assessment-contract-"));
  const vaultRoot = path.join(root, "vault");
  const sourcePath = path.join(root, "intake.json");
  const goalId = "goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8";
  try {
    await initializeVault({ vaultRoot });
    await writeFile(sourcePath, JSON.stringify({ energy: 4 }));
    await expect(importAssessmentResponse({ vaultRoot, sourcePath, relatedIds: ["not-a-contract-id"] }))
      .rejects.toMatchObject({ code: "ASSESSMENT_RESPONSE_INVALID" });
    expect(await listAssessmentResponses({ vaultRoot })).toEqual([]);
    const result = await importAssessmentResponse({
      vaultRoot, sourcePath, relatedIds: [goalId, ` ${goalId} `, " "],
    });
    expect(assessmentResponseSchema.parse(result.assessment)).toEqual(result.assessment);
    expect(result.assessment.relatedIds).toEqual([goalId]);
    expect(await readAssessmentResponse({ vaultRoot, assessmentId: result.assessment.id })).toEqual(result.assessment);
    expect(await readFile(path.join(vaultRoot, result.assessment.rawPath), "utf8"))
      .toBe(await readFile(sourcePath, "utf8"));
    const manifest = JSON.parse(await readFile(path.join(vaultRoot, result.manifestPath), "utf8"));
    expect(manifest.owner.id).toBe(result.assessment.id);
    expect(manifest.provenance.relatedIds).toEqual([goalId]);
    const audit = (await readFile(path.join(vaultRoot, result.auditPath), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line));
    expect(audit.filter((row) => row.action === "intake_import")).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps previously accepted assessment links readable without rewriting the ledger", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-assessment-legacy-"));
  try {
    await initializeVault({ vaultRoot });
    const record = {
      schemaVersion: "murph.assessment-response.v1", id: "asmt_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
      assessmentType: "intake", recordedAt: "2026-04-08T00:00:00.000Z", source: "import",
      rawPath: "raw/assessments/asmt_01JNW7YJ7MNE7M9Q2QWQK4Z3F8/source.json", responses: {},
      relatedIds: ["legacy-goal", "legacy-goal"], oldMetadata: true,
    };
    const ledgerPath = path.join(vaultRoot, "ledger/assessments/2026/2026-04.jsonl");
    await mkdir(path.dirname(ledgerPath), { recursive: true });
    const bytes = `${JSON.stringify(record)}\n`;
    await writeFile(ledgerPath, bytes);
    const read = await readAssessmentResponse({ vaultRoot, assessmentId: record.id });
    expect(read.relatedIds).toEqual(record.relatedIds);
    expect(read).not.toHaveProperty("oldMetadata");
    expect(await readFile(ledgerPath, "utf8")).toBe(bytes);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
