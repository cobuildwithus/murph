import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  defineSampleImportPreset,
  importAssessmentResponse,
  prepareAssessmentResponseImport,
  prepareDocumentImport,
  prepareMealImport,
  resolveSampleImportConfig,
} from "../src/index.ts";

async function createTempFile(name: string, contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "murph-importers-zod-"));
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
    vaultRoot: "  canonical-vault  ",
    title: "  Annual Labs  ",
    occurredAt: "2026-03-11T14:00:00-05:00",
    note: "  annual lab packet  ",
    source: "  manual  ",
  });

  assert.deepEqual(payload, {
    vaultRoot: "canonical-vault",
    sourcePath: filePath,
    title: "Annual Labs",
    occurredAt: "2026-03-11T19:00:00.000Z",
    note: "annual lab packet",
    source: "manual",
  });
});

test("importAssessmentResponse normalizes the payload and ignores the removed vault alias", async () => {
  const filePath = await createTempFile("assessment.json", "{\"ok\":true}");
  let receivedPayload: Record<string, unknown> | undefined;

  const result = await importAssessmentResponse<{ ok: boolean }>(
    {
      filePath: `  ${filePath}  `,
      vault: "  legacy-vault  ",
      title: "  Sleep Survey  ",
      occurredAt: "2026-03-11T14:00:00-05:00",
      importedAt: "2026-03-11T19:05:00Z",
      source: "  manual  ",
    },
    {
      corePort: {
        async importAssessmentResponse(payload: Record<string, unknown>) {
          receivedPayload = payload;
          return { ok: true };
        },
      },
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(receivedPayload, {
    sourcePath: filePath,
    title: "Sleep Survey",
    occurredAt: "2026-03-11T19:00:00.000Z",
    importedAt: "2026-03-11T19:05:00.000Z",
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
