import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  hostedColdIngestMonth, readHostedColdIngestReferences,
  resolveHostedMediaReferenceCataloguePath, HOSTED_MEDIA_REFS_SCHEMA,
} from "../src/hosted-media-references.ts";

const reference = { relativePath: "ledger/integration-ingests/2020/2020-01.jsonl.br",
  mediaKind: "integration-ingest", expiresAt: null, byteSize: 4,
  sha256: "a".repeat(64), mediaId: "b".repeat(64) };

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
