import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "vitest";
import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import { listAssessments, readAssessment, showAssessment } from "../src/health/assessments.ts";
import { collectCanonicalEntities } from "../src/health/canonical-collector.ts";
import { listHabitatAspects, readHabitatAspect, showHabitatAspect } from "../src/health/habitat.ts";
import { listImmunizations, readImmunization, showImmunization } from "../src/health/immunizations.ts";

const createdVaultRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdVaultRoots.splice(0).map(async (vaultRoot) => {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }),
  );
});

async function createVaultRoot(prefix: string): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  createdVaultRoots.push(vaultRoot);
  return vaultRoot;
}

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  contents: string,
) {
  await mkdir(path.dirname(path.join(vaultRoot, relativePath)), {
    recursive: true,
  });
  await writeFile(path.join(vaultRoot, relativePath), contents, "utf8");
}

test("assessment readers filter canonical responses and resolve ids and titles", async () => {
  const vaultRoot = await createVaultRoot("murph-query-assessment-");

  await writeVaultFile(
    vaultRoot,
    "ledger/assessments/2026/2026-04.jsonl",
    [
      JSON.stringify({
        id: "asmt_alpha",
        title: "Morning intake",
        recordedAt: "2026-04-10T09:00:00Z",
        questionnaireSlug: "sleep-check",
        source: "manual",
        relatedIds: ["goal_sleep"],
        tags: ["sleep", "sleep"],
        responses: { energy: "good" },
      }),
      JSON.stringify({
        id: "asmt_beta",
        occurredAt: "2026-04-09T09:00:00Z",
        importedAt: "2026-04-09T10:00:00Z",
        title: "Imported follow-up",
        source: "import",
        response: { soreness: "low" },
      }),
    ].join("\n"),
  );

  const listed = await listAssessments(vaultRoot, {
    from: "2026-04-09",
    text: "sleep",
  });
  assert.deepEqual(listed.map((record) => record.id), ["asmt_alpha"]);
  assert.equal((await readAssessment(vaultRoot, "asmt_beta"))?.id, "asmt_beta");
  assert.equal((await readAssessment(vaultRoot, "missing")) ?? null, null);
  assert.equal((await showAssessment(vaultRoot, " morning intake "))?.id, "asmt_alpha");
});

test("canonical collector omits habitat records stored outside their aspect path", async () => {
  const vaultRoot = await createVaultRoot("murph-query-habitat-path-");

  await writeVaultFile(
    vaultRoot,
    "bank/habitat/zzz.md",
    [
      "---",
      "schemaVersion: murph.frontmatter.habitat.v1",
      "docType: habitat",
      "habitatId: hab_01JNV422Y2M5ZBV64ZP4N1DRB1",
      "slug: sleep-environment",
      "title: Bedroom & sleep",
      "status: active",
      "domain: environment",
      "aspect: sleep-environment",
      "indicators:",
      "  night_temp_c: 19",
      "indicatorRecordedAt:",
      "  night_temp_c: 2026-07-01",
      "---",
      "# Bedroom & sleep",
      "",
    ].join("\n"),
  );

  const collection = await collectCanonicalEntities(vaultRoot, {
    mode: "tolerant",
  });

  assert.equal(collection.habitatAspects.length, 0);
  assert.equal(collection.entities.some((entity) => entity.family === "habitat"), false);
  assert.equal((await listHabitatAspects(vaultRoot)).length, 0);
  assert.equal(await readHabitatAspect(vaultRoot, "hab_01JNV422Y2M5ZBV64ZP4N1DRB1"), null);
  assert.equal(await showHabitatAspect(vaultRoot, "sleep-environment"), null);
});

test("immunization readers cover sorting and lookup helpers", async () => {
  const vaultRoot = await createVaultRoot("murph-query-immunizations-");

  await writeVaultFile(
    vaultRoot,
    "vault.json",
    `${JSON.stringify({
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      vaultId: "vault_01K9MGQX75Q5WF9G3HKR1CCX6Q",
      createdAt: "2026-04-01T00:00:00.000Z",
      title: "Immunization vault",
      timezone: "UTC",
    })}\n`,
  );
  await writeVaultFile(
    vaultRoot,
    "CORE.md",
    "---\ntitle: Core\n---\n# Core\n",
  );
  await writeVaultFile(
    vaultRoot,
    "ledger/events/2026/2026-04.jsonl",
    [
      JSON.stringify({
        id: "evt_flu",
        kind: "immunization",
        occurredAt: "2026-04-10T08:00:00.000Z",
        title: "Influenza vaccine",
        vaccineName: "Influenza",
        manufacturer: "Example manufacturer",
        lotNumber: "LOT123",
        targetDiseases: ["influenza"],
        relatedIds: ["doc_source", 5],
        tags: ["vaccine", 2],
      }),
      JSON.stringify({
        id: "evt_tdap",
        kind: "immunization",
        occurredAt: "2026-04-09T08:00:00.000Z",
        title: "Tdap",
        vaccineName: "Tdap",
      }),
      JSON.stringify({
        id: "evt_local_day",
        kind: "immunization",
        occurredAt: "2026-04-08T23:30:00.000Z",
        dayKey: "2026-04-09",
        title: "Local-day vaccine",
        vaccineName: "Local-day vaccine",
      }),
      JSON.stringify({
        id: "evt_skip",
        kind: "immunization",
        occurredAt: "2026-04-08T08:00:00.000Z",
        title: "Missing vaccine name",
      }),
    ].join("\n"),
  );

  assert.deepEqual(
    (await listImmunizations(vaultRoot)).map((record) => record.id),
    ["evt_flu", "evt_tdap", "evt_local_day"],
  );
  assert.deepEqual(
    (await listImmunizations(vaultRoot, {
      from: "2026-04-09",
      to: "2026-04-09",
    })).map((record) => record.id),
    ["evt_tdap", "evt_local_day"],
  );
  assert.equal((await readImmunization(vaultRoot, "evt_flu"))?.lotNumber, "LOT123");
  assert.equal((await showImmunization(vaultRoot, " influenza "))?.id, "evt_flu");
  assert.equal((await showImmunization(vaultRoot, "LOT123"))?.id, "evt_flu");
});
