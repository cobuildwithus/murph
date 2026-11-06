import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  hostedColdIngestMonth, readHostedColdIngestReferences,
  resolveHostedMediaReferenceCataloguePath, HOSTED_MEDIA_REFS_SCHEMA,
  parseHostedMediaReference, readHostedMediaReferenceCatalogueValue,
} from "../src/hosted-media-references.ts";

const reference = { relativePath: "ledger/integration-ingests/2020/2020-01.jsonl.br",
  mediaKind: "integration-ingest", expiresAt: null, byteSize: 4,
  sha256: "a".repeat(64), mediaId: "b".repeat(64) };

test.each(["raw/measurements/check/photo.jpg", "raw/meals/check/photo.jpg", "raw/inbox/check/photo.jpg"])(
  "shared reader preserves explicit pending and legacy settled semantics for %s", relativePath => {
    const value = { ...reference, relativePath, mediaKind: "image" };
    expect(parseHostedMediaReference(value).pendingUpload).toBeUndefined();
    for (const pendingUpload of [true, false]) {
      expect(parseHostedMediaReference({ ...value, pendingUpload }).pendingUpload).toBe(pendingUpload);
    }
    expect(parseHostedMediaReference({ ...value, relativePath: "raw/meals/check/thumbnail-v2-test.jpg" }).pendingUpload).toBe(true);
  },
);

test("malformed sole-copy image descriptors fail closed instead of disappearing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "media-catalogue-"));
  try {
    const cataloguePath = resolveHostedMediaReferenceCataloguePath(root);
    await mkdir(path.dirname(cataloguePath), { recursive: true });
    const valid = { ...reference, relativePath: "raw/measurements/check/photo.jpg", mediaKind: "image" };
    for (const change of [{ relativePath: "raw/measurements/../outside.jpg" }, { byteSize: -1 },
      { sha256: "bad" }, { pendingUpload: "true" }, { expiresAt: "invalid" }, { mediaKind: "audio" }]) {
      const raw = JSON.stringify({ schema: HOSTED_MEDIA_REFS_SCHEMA, entries: [{ ...valid, ...change }] });
      await writeFile(cataloguePath, raw);
      await expect(readHostedMediaReferenceCatalogueValue(root)).rejects.toMatchObject({ code: "HOSTED_MEDIA_REFERENCE_UNAVAILABLE" });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a stray inbox or capture entry cannot block a checkpoint, while photo and cold references stay strict", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "murph-media-catalogue-tolerance-"));
  const catalogue = resolveHostedMediaReferenceCataloguePath(root);
  await mkdir(path.dirname(catalogue), { recursive: true });
  const good = { relativePath: "raw/inbox/a/good.png", mediaKind: "image", mediaId: "a".repeat(64), sha256: "b".repeat(64),
    byteSize: 4, expiresAt: null, mimeType: "image/png", recordedAt: "2026-01-01T00:00:00.000Z" };
  const write = (entries: unknown[]) => writeFile(catalogue, JSON.stringify({ schema: HOSTED_MEDIA_REFS_SCHEMA, entries }));
  try {
    await write([good, { ...good, relativePath: "raw/inbox/a/bad.png", sha256: "not-a-digest" },
      { ...good, relativePath: "raw/captures/a/bad.png", byteSize: -1 }, good]);
    expect((await readHostedMediaReferenceCatalogueValue(root)).entries.map(entry => entry.relativePath)).toEqual([good.relativePath]);
    for (const relativePath of ["raw/meals/a/bad.png", "raw/measurements/a/bad.png"]) {
      await write([{ ...good, relativePath, sha256: "not-a-digest" }]);
      await expect(readHostedMediaReferenceCatalogueValue(root)).rejects.toMatchObject({ code: "HOSTED_MEDIA_REFERENCE_UNAVAILABLE" });
      await write([{ ...good, relativePath }, { ...good, relativePath }]);
      await expect(readHostedMediaReferenceCatalogueValue(root)).rejects.toMatchObject({ code: "HOSTED_MEDIA_REFERENCE_UNAVAILABLE" });
    }
    await write([{ ...reference, sha256: "not-a-digest" }]);
    await expect(readHostedMediaReferenceCatalogueValue(root)).rejects.toMatchObject({ code: "HOSTED_COLD_HISTORY_UNAVAILABLE" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("old inline snapshots have no cold references; malformed catalogues fail closed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cold-catalogue-"));
  try {
    expect(await readHostedColdIngestReferences(root)).toEqual([]);
    const cataloguePath = resolveHostedMediaReferenceCataloguePath(root);
    await mkdir(path.dirname(cataloguePath), { recursive: true });
    const write = (value: unknown) => writeFile(cataloguePath, JSON.stringify(value));
    await write({ schema: HOSTED_MEDIA_REFS_SCHEMA, entries: [reference] });
    expect(await readHostedColdIngestReferences(root)).toEqual([reference]);
    for (const value of [
      {}, { schema: "unknown", entries: [reference] },
      { schema: HOSTED_MEDIA_REFS_SCHEMA, entries: [reference, reference] },
      ...[{ expiresAt: "2030-01-01" }, { byteSize: -1 }, { sha256: "bad" },
        { relativePath: "../outside" }, { mediaKind: "image" }].map((change) => ({
        schema: HOSTED_MEDIA_REFS_SCHEMA, entries: [{ ...reference, ...change }],
      })),
    ]) {
      await write(value);
      await expect(readHostedColdIngestReferences(root)).rejects.toMatchObject({ retryable: true, code: "HOSTED_COLD_HISTORY_UNAVAILABLE" });
    }
    await writeFile(cataloguePath, "{");
    await expect(readHostedColdIngestReferences(root)).rejects.toMatchObject({ retryable: true });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("cold month paths are canonical Brotli monthly shards only", () => {
  expect(hostedColdIngestMonth(reference.relativePath)).toBe("2020-01");
  for (const value of ["ledger/integration-ingests/2021/2020-01.jsonl.br",
    "ledger/integration-ingests/2020/2020-13.jsonl.br", "ledger/integration-ingests/2020/2020-01.jsonl",
    "ledger/events/2020/2020-01.jsonl.br"]) expect(hostedColdIngestMonth(value)).toBeNull();
});
