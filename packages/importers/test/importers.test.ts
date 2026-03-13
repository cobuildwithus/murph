import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import type {
  DocumentImportPayload,
  MealImportPayload,
  SampleImportPayload,
} from "../src/index.js";
import {
  createSamplePresetRegistry,
  importCsvSamples,
  importDocument,
  importMeal,
  parseDelimitedRows,
  prepareCsvSampleImport,
  prepareMealImport,
} from "../src/index.js";

async function createTempFile(name: string, contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "healthybob-importers-"));
  const filePath = join(directory, name);
  await writeFile(filePath, contents);
  return filePath;
}

interface CorePortSpyCalls {
  documents: DocumentImportPayload[];
  meals: MealImportPayload[];
  samples: SampleImportPayload[];
}

function createCorePortSpy() {
  const calls: CorePortSpyCalls = {
    documents: [],
    meals: [],
    samples: [],
  };

  return {
    calls,
    corePort: {
      async importDocument(payload: DocumentImportPayload) {
        calls.documents.push(payload);
        return { ok: true, kind: "document" as const };
      },
      async addMeal(payload: MealImportPayload) {
        calls.meals.push(payload);
        return { ok: true, kind: "meal" as const };
      },
      async importSamples(payload: SampleImportPayload) {
        calls.samples.push(payload);
        return { ok: true, kind: "samples" as const };
      },
    },
  };
}

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

test("importMeal validates attachments and maps to addMeal-compatible input", async () => {
  const photoPath = await createTempFile("dinner.jpg", "image-placeholder");
  const audioPath = await createTempFile("dinner-note.m4a", "audio-placeholder");
  const { calls, corePort } = createCorePortSpy();

  await importMeal(
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

test("importMeal rejects requests without a baseline photo attachment", async () => {
  const { corePort } = createCorePortSpy();

  await assert.rejects(
    () =>
      importMeal(
        {
          note: "soup",
        },
        { corePort },
      ),
    /photoPath/,
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

test("importMeal accepts vault aliases and rejects directory photo paths", async () => {
  const photoPath = await createTempFile("breakfast.jpg", "image-placeholder");
  const photoDirectory = await mkdtemp(join(tmpdir(), "healthybob-importers-photo-"));
  const { calls, corePort } = createCorePortSpy();

  await importMeal(
    {
      photoPath,
      vault: "fixture-vault",
      note: "  oatmeal  ",
    },
    { corePort },
  );

  const [mealPayload] = calls.meals;
  assert.ok(mealPayload);
  assert.equal(mealPayload.vaultRoot, "fixture-vault");
  assert.equal(mealPayload.audioPath, undefined);
  assert.equal(mealPayload.note, "oatmeal");

  await assert.rejects(
    () =>
      importMeal(
        {
          photoPath: photoDirectory,
        },
        { corePort },
      ),
    /photoPath must point to a file/,
  );
});

test("importCsvSamples handles vault aliases, escaped quotes, and CRLF rows", async () => {
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
  assert.equal(samplePayload.vaultRoot, "fixture-vault");
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

test("prepareMealImport accepts the vault alias and omits missing audio", async () => {
  const photoPath = await createTempFile("breakfast.jpg", "image-placeholder");

  const payload = await prepareMealImport({
    photoPath,
    vault: "/tmp/example-vault",
    note: "  eggs and fruit  ",
  });

  assert.equal(payload.photoPath, photoPath);
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
    vault: "/tmp/example-vault",
    stream: "glucose",
    tsColumn: "recorded",
    valueColumn: "value",
    unit: "mg_dL",
    delimiter: ",",
  });

  assert.equal(payload.vaultRoot, "/tmp/example-vault");
  assert.equal(payload.importConfig.metadataColumns, undefined);
  assert.equal(payload.samples.length, 2);
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
