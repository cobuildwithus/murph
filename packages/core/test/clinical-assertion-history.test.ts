import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  appendHistoryEvent,
  initializeVault,
  listHistoryEvents,
  VaultError,
} from "../src/index.ts";

test("appendHistoryEvent accepts dated negative allergy assertions", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-core-clinical-assertion-"));

  try {
    await initializeVault({
      vaultRoot,
      createdAt: "2026-03-12T08:00:00.000Z",
    });

    const result = await appendHistoryEvent({
      vaultRoot,
      kind: "clinical_assertion",
      occurredAt: "2026-03-12T08:15:00.000Z",
      source: "import",
      title: "No known drug allergies",
      assertion: "no_known_drug_allergies",
      assertedOn: "2026-03-10",
      sourceLabel: "Uploaded visit summary",
      tags: ["allergy-history"],
    });

    if (result.record.kind !== "clinical_assertion") {
      throw new Error(`Expected clinical_assertion, got ${result.record.kind}.`);
    }

    assert.equal(result.record.assertion, "no_known_drug_allergies");
    assert.equal(result.record.assertedOn, "2026-03-10");
    assert.equal(result.record.sourceLabel, "Uploaded visit summary");

    const listed = await listHistoryEvents({
      vaultRoot,
      kinds: ["clinical_assertion"],
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.kind, "clinical_assertion");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("appendHistoryEvent requires an assertion source date", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-core-clinical-assertion-"));

  try {
    await initializeVault({
      vaultRoot,
      createdAt: "2026-03-12T08:00:00.000Z",
    });

    await assert.rejects(
      () => appendHistoryEvent({
        vaultRoot,
        kind: "clinical_assertion",
        occurredAt: "2026-03-12T08:15:00.000Z",
        title: "No known allergies",
        assertion: "no_known_allergies",
        assertedOn: "",
      }),
      (error) => error instanceof VaultError && /assertedOn is required/u.test(error.message),
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
