import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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
