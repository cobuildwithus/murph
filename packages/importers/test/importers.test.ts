import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import * as coreRuntime from "@murphai/core";
import {
  addMeal,
  createSamplePresetRegistry,
  importCsvSamples,
  importDocument,
  parseDelimitedRows,
  prepareCsvSampleImport,
  prepareMealImport,
} from "../src/index.ts";
import type { DocumentImportPayload } from "../src/index.ts";
import { createCorePortSpy, createTempFile } from "./test-helpers.ts";

test("importDocument delegates a core-shaped document payload", async () => {
  const filePath = await createTempFile("labs.pdf", "pdf-placeholder");
  const { calls, corePort } = createCorePortSpy();

  const result = await importDocument<{ ok: boolean; kind: string }>(
    {
      filePath,
      note: "  annual lab packet  ",
      occurredAt: "2026-03-11T14:00:00-05:00",
    },
    { corePort },
  );

  const [documentPayload] = calls.documents;

  assert.ok(documentPayload);
  assert.deepEqual(result, { ok: true, kind: "document" });
  assert.equal(calls.documents.length, 1);
  assert.equal(documentPayload.sourcePath, filePath);
  assert.equal(documentPayload.title, "labs.pdf");
  assert.equal(documentPayload.note, "annual lab packet");
});

test("addMeal validates attachments and maps to addMeal-compatible input", async () => {
  const photoPath = await createTempFile("dinner.jpg", "image-placeholder");
  const audioPath = await createTempFile("dinner-note.m4a", "audio-placeholder");
  const { calls, corePort } = createCorePortSpy();

  await addMeal(
    {
      photoPath,
      audioPath,
      note: "  salmon and rice  ",
      occurredAt: new Date("2026-03-11T18:30:00Z"),
    },
    { corePort },
  );

  const [mealPayload] = calls.meals;

  assert.ok(mealPayload);
  assert.equal(calls.meals.length, 1);
  assert.equal(mealPayload.photoPath, photoPath);
  assert.equal(mealPayload.audioPath, audioPath);
  assert.equal(mealPayload.note, "salmon and rice");
});

test("addMeal accepts text-only meal notes without requiring a photo", async () => {
  const { calls, corePort } = createCorePortSpy();

  await addMeal(
    {
      note: "soup",
    },
    { corePort },
  );

  const [mealPayload] = calls.meals;
  assert.ok(mealPayload);
  assert.equal(mealPayload.photoPath, undefined);
  assert.equal(mealPayload.audioPath, undefined);
  assert.equal(mealPayload.note, "soup");
});

test("addMeal rejects requests without a photo, audio note, or meal note", async () => {
  const { corePort } = createCorePortSpy();

  await assert.rejects(
    () =>
      addMeal(
        {
        },
        { corePort },
      ),
    /photoPath, audioPath, or note/,
  );
});

test("importCsvSamples parses rows and emits recordedAt values for core", async () => {
  const filePath = await createTempFile(
    "heart-rate.csv",
    [
      "timestamp,bpm,device,context",
      "2026-03-11T08:00:00Z,72,watch,resting",
      "2026-03-11T08:05:00Z,75,watch,\"post, walk\"",
    ].join("\n"),
  );
  const { calls, corePort } = createCorePortSpy();
  const presetRegistry = createSamplePresetRegistry([
    {
      id: "vendor-watch-heart-rate",
      stream: "heart_rate",
      tsColumn: "timestamp",
      valueColumn: "bpm",
      unit: "bpm",
      metadataColumns: ["device", "context"],
      source: "device",
    },
  ]);

  await importCsvSamples(
    {
      filePath,
      presetId: "vendor-watch-heart-rate",
    },
    { corePort, presetRegistry },
  );

  const [samplePayload] = calls.samples;

  assert.ok(samplePayload);
  assert.equal(calls.samples.length, 1);
  assert.equal(samplePayload.stream, "heart_rate");
  assert.equal(samplePayload.unit, "bpm");
  assert.equal(samplePayload.source, "device");
  assert.equal(samplePayload.sourcePath, filePath);
  assert.equal(samplePayload.samples.length, 2);
  assert.equal(samplePayload.samples[1]?.recordedAt, "2026-03-11T08:05:00.000Z");
  assert.equal(samplePayload.batchProvenance?.sourceFileName, "heart-rate.csv");
  assert.equal(samplePayload.batchProvenance?.importConfig?.metadataColumns?.length, 2);
  assert.deepEqual(samplePayload.batchProvenance?.rows?.[0]?.metadata, {
    device: "watch",
    context: "resting",
  });
  assert.equal(samplePayload.batchProvenance?.rows?.[1]?.rowNumber, 3);
  assert.equal(samplePayload.batchProvenance?.rows?.[1]?.rawValue, "75");
});

test("createSamplePresetRegistry rejects duplicate preset ids", () => {
  const registry = createSamplePresetRegistry();

  registry.register({
    id: "duplicate",
    stream: "steps",
    tsColumn: "ts",
    valueColumn: "value",
    unit: "count",
  });

  assert.throws(
    () =>
      registry.register({
        id: "duplicate",
        stream: "steps",
        tsColumn: "ts",
        valueColumn: "value",
        unit: "count",
      }),
    /already registered/,
  );
});

test("parseDelimitedRows handles quoted commas", () => {
  const rows = parseDelimitedRows('a,b\n1,"two,three"\n', ",");
  assert.deepEqual(rows, [
    ["a", "b"],
    ["1", "two,three"],
  ]);
});

test("addMeal keeps canonical vaultRoot and ignores the removed vault alias", async () => {
  const photoPath = await createTempFile("breakfast.jpg", "image-placeholder");
  const photoDirectory = await mkdtemp(join(tmpdir(), "murph-importers-photo-"));
  const { calls, corePort } = createCorePortSpy();

  await addMeal(
    {
      photoPath,
      vault: "fixture-vault",
      note: "  oatmeal  ",
    },
    { corePort },
  );

  const [mealPayload] = calls.meals;
  assert.ok(mealPayload);
  assert.equal(mealPayload.vaultRoot, undefined);
  assert.equal(mealPayload.audioPath, undefined);
  assert.equal(mealPayload.note, "oatmeal");

  await assert.rejects(
    () =>
      addMeal(
        {
          photoPath: photoDirectory,
        },
        { corePort },
      ),
    /photoPath must point to a file/,
  );
});

test("importCsvSamples ignores the removed vault alias and still handles escaped quotes and CRLF rows", async () => {
  const filePath = await createTempFile(
    "sleep.csv",
    [
      "timestamp,bpm,context\r",
      '2026-03-11T08:00:00Z,72,"watch ""alpha"""\r',
      "2026-03-11T08:05:00Z,75,resting\r",
      "",
    ].join("\n"),
  );
  const { calls, corePort } = createCorePortSpy();

  await importCsvSamples(
    {
      filePath,
      vault: "fixture-vault",
      stream: "heart_rate",
      tsColumn: "timestamp",
      valueColumn: "bpm",
      unit: "bpm",
      delimiter: ",",
    },
    { corePort },
  );

  const [samplePayload] = calls.samples;
  assert.ok(samplePayload);
  assert.equal(samplePayload.vaultRoot, undefined);
  assert.equal(samplePayload.samples.length, 2);

  const escapedRows = parseDelimitedRows(
    'timestamp,bpm,context\r\n2026-03-11T08:00:00Z,72,"watch ""alpha"""',
    ",",
  );
  assert.deepEqual(escapedRows[1], [
    "2026-03-11T08:00:00Z",
    "72",
    'watch "alpha"',
  ]);
});

test("importCsvSamples rejects blank sample rows and unterminated quoted fields", async () => {
  const blankRowsPath = await createTempFile(
    "blank.csv",
    ["timestamp,bpm", "", "   ,   ", ""].join("\n"),
  );
  const brokenQuotesPath = await createTempFile(
    "broken.csv",
    ['timestamp,bpm', '"2026-03-11T08:00:00Z,72'].join("\n"),
  );
  const { corePort } = createCorePortSpy();

  await assert.rejects(
    () =>
      importCsvSamples(
        {
          filePath: blankRowsPath,
          stream: "heart_rate",
          tsColumn: "timestamp",
          valueColumn: "bpm",
          unit: "bpm",
        },
        { corePort },
      ),
    /did not contain any importable sample rows/,
  );

  await assert.throws(
    () => parseDelimitedRows('timestamp,bpm\n"2026-03-11T08:00:00Z,72', ","),
    /unterminated quoted field/,
  );

  await assert.rejects(
    () =>
      importCsvSamples(
        {
          filePath: brokenQuotesPath,
          stream: "heart_rate",
          tsColumn: "timestamp",
          valueColumn: "bpm",
          unit: "bpm",
        },
        { corePort },
      ),
    /unterminated quoted field/,
  );
});

test("importDocument accepts a narrow core port with only the called export", async () => {
  const filePath = await createTempFile("visit-note.txt", "note");

  const result = await importDocument<string>(
    { filePath },
    {
      corePort: {
        async importDocument(payload: DocumentImportPayload) {
          return payload.title;
        },
      },
    },
  );

  assert.equal(result, "visit-note.txt");
});

test("prepareMealImport requires canonical vaultRoot and omits missing audio", async () => {
  const photoPath = await createTempFile("breakfast.jpg", "image-placeholder");

  const payload = await prepareMealImport({
    photoPath,
    vaultRoot: "/tmp/example-vault",
    note: "  eggs and fruit  ",
  });

  assert.equal(payload.photoPath, photoPath);
  assert.equal(payload.audioPath, undefined);
  assert.equal(payload.vaultRoot, "/tmp/example-vault");
  assert.equal(payload.note, "eggs and fruit");
});

test("prepareMealImport accepts note-only meal input", async () => {
  const payload = await prepareMealImport({
    vaultRoot: "/tmp/example-vault",
    note: "  eggs and fruit  ",
  });

  assert.equal(payload.photoPath, undefined);
  assert.equal(payload.audioPath, undefined);
  assert.equal(payload.vaultRoot, "/tmp/example-vault");
  assert.equal(payload.note, "eggs and fruit");
});

test("prepareCsvSampleImport skips blank rows and omits empty metadata columns", async () => {
  const filePath = await createTempFile(
    "glucose.csv",
    [
      "recorded,value",
      "",
      "2026-03-11T08:00:00Z,92",
      "",
      "2026-03-11T09:00:00Z,95",
      "",
    ].join("\n"),
  );

  const payload = await prepareCsvSampleImport({
    filePath,
    vaultRoot: "/tmp/canonical-vault",
    vault: "/tmp/example-vault",
    stream: "glucose",
    tsColumn: "recorded",
    valueColumn: "value",
    unit: "mg_dL",
    delimiter: ",",
  });

  assert.equal(payload.vaultRoot, "/tmp/canonical-vault");
  assert.equal(payload.importConfig.metadataColumns, undefined);
  assert.equal(payload.samples.length, 2);
  assert.equal(payload.batchProvenance?.sourceFileName, "glucose.csv");
  assert.equal(payload.batchProvenance?.importConfig?.valueColumn, "value");
  assert.equal(payload.batchProvenance?.rows?.length, 2);
  assert.equal(payload.batchProvenance?.rows?.[0]?.rowNumber, 3);
  assert.equal(payload.batchProvenance?.rows?.[0]?.metadata, undefined);
  assert.equal(payload.samples[0]?.recordedAt, "2026-03-11T08:00:00.000Z");
  assert.equal(payload.samples[1]?.value, 95);
});

test("prepareCsvSampleImport rejects header-only files", async () => {
  const filePath = await createTempFile("header-only.csv", "recorded,value\n");

  await assert.rejects(
    () =>
      prepareCsvSampleImport({
        filePath,
        stream: "heart_rate",
        tsColumn: "recorded",
        valueColumn: "value",
        unit: "bpm",
        delimiter: ",",
      }),
    /header row and at least one data row/,
  );
});

test("parseDelimitedRows rejects malformed delimiters and unterminated quoted fields", () => {
  assert.throws(
    () => parseDelimitedRows("a|b\n1|2\n", "||"),
    /single character/,
  );
  assert.throws(
    () => parseDelimitedRows('a,b\n1,"two\n', ","),
    /unterminated quoted field/,
  );
});

test("importDocument with the real core runtime writes an immutable raw manifest sidecar", async () => {
  const vaultRoot = await mkdtemp(join(tmpdir(), "murph-vault-"));
  const filePath = await createTempFile("labs.pdf", "pdf-placeholder");

  await coreRuntime.initializeVault({ vaultRoot });

  const result = await importDocument<{
    documentId: string;
    raw: {
      relativePath: string;
    };
    manifestPath: string;
  }>(
    {
      filePath,
      vaultRoot,
      note: "baseline import",
    },
    { corePort: coreRuntime },
  );

  assert.match(result.manifestPath, /^raw\/documents\/.+\/manifest\.json$/u);

  const manifest = JSON.parse(
    await readFile(join(vaultRoot, result.manifestPath), "utf8"),
  ) as {
    importKind: string;
    importId: string;
    artifacts: Array<{
      relativePath: string;
      sha256: string;
    }>;
  };

  assert.equal(manifest.importKind, "document");
  assert.equal(manifest.importId, result.documentId);
  assert.equal(manifest.artifacts[0]?.relativePath, result.raw.relativePath);
  assert.match(String(manifest.artifacts[0]?.sha256), /^[a-f0-9]{64}$/u);
});

test("importCsvSamples with the real core runtime writes a batch manifest with row provenance", async () => {
  const vaultRoot = await mkdtemp(join(tmpdir(), "murph-vault-"));
  const filePath = await createTempFile(
    "heart-rate.csv",
    [
      "timestamp,bpm,device,context",
      "2026-03-11T08:00:00Z,72,watch,resting",
      "2026-03-11T08:05:00Z,75,watch,walk",
    ].join("\n"),
  );

  await coreRuntime.initializeVault({ vaultRoot });

  const result = await importCsvSamples<{
    count: number;
    manifestPath: string;
  }>(
    {
      filePath,
      vaultRoot,
      stream: "heart_rate",
      tsColumn: "timestamp",
      valueColumn: "bpm",
      unit: "bpm",
      delimiter: ",",
      metadataColumns: ["device", "context"],
    },
    { corePort: coreRuntime },
  );

  assert.equal(result.count, 2);
  assert.match(result.manifestPath, /^raw\/samples\/heart_rate\/.+\/manifest\.json$/u);

  const manifest = JSON.parse(
    await readFile(join(vaultRoot, result.manifestPath), "utf8"),
  ) as {
    importKind: string;
    provenance: {
      importedCount: number;
      rowCount: number;
      importConfig: {
        metadataColumns?: string[];
      };
      rows: Array<{
        rowNumber: number;
        metadata?: Record<string, string>;
      }>;
    };
  };

  assert.equal(manifest.importKind, "sample_batch");
  assert.equal(manifest.provenance.importedCount, 2);
  assert.equal(manifest.provenance.rowCount, 2);
  assert.deepEqual(manifest.provenance.importConfig.metadataColumns, [
    "device",
    "context",
  ]);
  assert.equal(manifest.provenance.rows[0]?.rowNumber, 2);
  assert.deepEqual(manifest.provenance.rows[0]?.metadata, {
    device: "watch",
    context: "resting",
  });
});
