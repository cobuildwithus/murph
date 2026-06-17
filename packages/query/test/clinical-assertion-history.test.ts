import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  CURRENT_VAULT_FORMAT_VERSION,
  HEALTH_HISTORY_EVENT_KINDS,
} from "@murphai/contracts";

import { readVault } from "../src/index.ts";
import { readHealthContext } from "../src/export-pack-health.ts";
import { projectHistoryEntity } from "../src/health/projectors/history.ts";

test("clinical assertion events project as health history entities", () => {
  assert.equal(HEALTH_HISTORY_EVENT_KINDS.includes("clinical_assertion"), true);

  const entity = projectHistoryEntity(
    {
      schemaVersion: "murph.event.v1",
      id: "evt_01JNV45RHN0TQ9ZXE0A7YSE1YU",
      kind: "clinical_assertion",
      occurredAt: "2026-03-12T08:15:00Z",
      recordedAt: "2026-03-12T08:16:00Z",
      dayKey: "2026-03-12",
      source: "import",
      title: "No known food allergies",
      assertion: "no_known_food_allergies",
      assertedOn: "2026-03-10",
      sourceLabel: "Uploaded intake PDF",
      tags: ["allergy-history"],
    },
    "ledger/events/2026-03.jsonl",
  );

  assert.notEqual(entity, null);
  assert.equal(entity?.kind, "clinical_assertion");
  assert.equal(entity?.date, "2026-03-12");
  assert.equal(entity?.status, null);
  assert.equal(entity?.attributes.assertion, "no_known_food_allergies");
  assert.equal(entity?.attributes.assertedOn, "2026-03-10");
});

test("readVault includes clinical assertion ledger rows in the event read model", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-clinical-assertion-"));

  try {
    await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });
    await writeFile(
      path.join(vaultRoot, "vault.json"),
      `${JSON.stringify({
        formatVersion: CURRENT_VAULT_FORMAT_VERSION,
        vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4B",
        createdAt: "2026-03-12T00:00:00.000Z",
        title: "Clinical assertion vault",
        timezone: "UTC",
      })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl"),
      `${JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_01JNV45RHN0TQ9ZXE0A7YSE1YV",
        kind: "clinical_assertion",
        occurredAt: "2026-03-12T08:15:00Z",
        recordedAt: "2026-03-12T08:16:00Z",
        dayKey: "2026-03-12",
        source: "import",
        title: "No known allergies",
        assertion: "no_known_allergies",
        assertedOn: "2026-03-10",
        sourceLabel: "Onboarding medical context",
        tags: ["allergy-history"],
      })}\n`,
      "utf8",
    );

    const vault = await readVault(vaultRoot);
    const entity = vault.events.find(
      (candidate) => candidate.entityId === "evt_01JNV45RHN0TQ9ZXE0A7YSE1YV",
    );

    assert.ok(entity);
    assert.equal(entity.kind, "clinical_assertion");
    assert.equal(entity.date, "2026-03-12");
    assert.deepEqual(entity.tags, ["allergy-history"]);
    assert.equal(entity.attributes.assertion, "no_known_allergies");
    assert.equal(entity.attributes.assertedOn, "2026-03-10");
    assert.equal(entity.attributes.sourceLabel, "Onboarding medical context");
    assert.equal(vault.byFamily.event?.includes(entity), true);

    const health = readHealthContext(vaultRoot, {
      from: "2026-03-01",
      to: "2026-03-31",
      experimentSlug: null,
    }).health;
    const healthEvent = health.healthEvents.find(
      (candidate) => candidate.id === "evt_01JNV45RHN0TQ9ZXE0A7YSE1YV",
    );

    assert.ok(healthEvent);
    assert.equal(healthEvent.kind, "clinical_assertion");
    assert.equal(healthEvent.data.assertion, "no_known_allergies");
    assert.equal(healthEvent.data.assertedOn, "2026-03-10");
    assert.deepEqual(health.allergies, []);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
