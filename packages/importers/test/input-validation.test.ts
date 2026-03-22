import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  defineSampleImportPreset,
  prepareAssessmentResponseImport,
  prepareDocumentImport,
  prepareMealImport,
  resolveSampleImportConfig,
} from "../src/index.js";

async function createTempFile(name: string, contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "healthybob-importers-zod-"));
  const filePath = join(directory, name);
  await writeFile(filePath, contents);
  return filePath;
}

test("defineSampleImportPreset trims fields and applies defaults", () => {
  const preset = defineSampleImportPreset({
    id: "  vendor-watch  ",
    label: "  Vendor Watch  ",
    source: "  wearable  ",
    stream: "  heart_rate  ",
    tsColumn: "  timestamp  ",
    valueColumn: "  bpm  ",
    unit: "  bpm  ",
    metadataColumns: [" device ", " context "],
  });

  assert.deepEqual(preset, {
    id: "vendor-watch",
    label: "Vendor Watch",
    source: "wearable",
    stream: "heart_rate",
    tsColumn: "timestamp",
    valueColumn: "bpm",
    unit: "bpm",
    delimiter: ",",
    metadataColumns: ["device", "context"],
  });
  assert.equal(Object.isFrozen(preset), true);
});

test("resolveSampleImportConfig preserves preset metadata fallback until explicitly overridden", () => {
  const config = resolveSampleImportConfig(
    {
      presetId: "  vendor-watch  ",
      source: "  manual  ",
    },
    {
      get(id) {
        assert.equal(id, "vendor-watch");
        return {
          id,
          stream: "heart_rate",
          tsColumn: "timestamp",
          valueColumn: "bpm",
          unit: "bpm",
          delimiter: ",",
          metadataColumns: ["device", "context"],
          source: "wearable",
        };
      },
    },
  );

  assert.deepEqual(config, {
    presetId: "vendor-watch",
    source: "manual",
    stream: "heart_rate",
    tsColumn: "timestamp",
    valueColumn: "bpm",
    unit: "bpm",
    delimiter: ",",
    metadataColumns: ["device", "context"],
  });
});

test("prepareDocumentImport parses and normalizes object input with zod", async () => {
  const filePath = await createTempFile("labs.pdf", "pdf-placeholder");

  const payload = await prepareDocumentImport({
    filePath: `  ${filePath}  `,
    vault: "  fixture-vault  ",
    title: "  Annual Labs  ",
    occurredAt: "2026-03-11T14:00:00-05:00",
    note: "  annual lab packet  ",
    source: "  manual  ",
  });

  assert.deepEqual(payload, {
    vaultRoot: "fixture-vault",
    sourcePath: filePath,
    title: "Annual Labs",
    occurredAt: "2026-03-11T19:00:00.000Z",
    note: "annual lab packet",
    source: "manual",
  });
});

test("prepareMealImport and assessment import reject invalid typed fields with stable messages", async () => {
  const photoPath = await createTempFile("meal.jpg", "image-placeholder");
  const assessmentPath = await createTempFile("assessment.json", "{\"ok\":true}");

  await assert.rejects(
    () =>
      prepareMealImport({
        photoPath,
        note: 42,
      }),
    /note must be a string when provided/,
  );

  await assert.rejects(
    () =>
      prepareAssessmentResponseImport({
        filePath: assessmentPath,
        importedAt: true,
      }),
    /importedAt must be a valid timestamp/,
  );

  await assert.rejects(
    () =>
      prepareAssessmentResponseImport({
        filePath: assessmentPath,
        occurredAt: "2024-02-31",
      }),
    /occurredAt must be a valid timestamp/,
  );
});
