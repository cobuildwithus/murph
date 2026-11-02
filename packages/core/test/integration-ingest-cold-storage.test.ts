import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { resolveHostedMediaReferenceCataloguePath, HOSTED_MEDIA_REFS_SCHEMA } from "@murphai/runtime-state/node";
import { initializeVault, validateVault, buildIntegrationIngestRecord, readIntegrationIngestEntries, withIntegrationIngestMaterializer, appendJsonlRecord } from "../src/index.ts";

const record = (importedAt: string) => buildIntegrationIngestRecord({ id: "xfm_synthetic", provider: "synthetic", source: "device", importedAt,
  parts: [], eventOutputs: [], eventIdsComplete: true, sampleIds: [], sampleIdsComplete: true, eventCount: 0, sampleCount: 0 });
const logicalPath = "ledger/integration-ingests/2020/2020-01.jsonl";

test("missing cold shards cannot become empty history or new append targets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cold-core-"));
  try {
    await initializeVault({ vaultRoot: root });
    const cataloguePath = resolveHostedMediaReferenceCataloguePath(root);
    await mkdir(path.dirname(cataloguePath), { recursive: true });
    await writeFile(cataloguePath, JSON.stringify({ schema: HOSTED_MEDIA_REFS_SCHEMA, entries: [{
      relativePath: `${logicalPath}.br`, mediaKind: "integration-ingest", expiresAt: null,
      sha256: "a".repeat(64), mediaId: "b".repeat(64), byteSize: 4,
    }] }));
    await expect(readIntegrationIngestEntries(root)).rejects.toMatchObject({ retryable: true });
    await expect(validateVault({ vaultRoot: root })).rejects.toMatchObject({ retryable: true, code: "HOSTED_COLD_HISTORY_UNAVAILABLE" });
    const materialize = vi.fn(async () => {});
    await expect(withIntegrationIngestMaterializer(`${root}/other`, materialize, () => readIntegrationIngestEntries(root)))
      .rejects.toMatchObject({ retryable: true });
    expect(materialize).not.toHaveBeenCalled();
    await expect(appendJsonlRecord({ vaultRoot: root, relativePath: logicalPath, record: record("2020-01-01T00:00:00.000Z") }))
      .rejects.toMatchObject({ code: "INTEGRATION_INGEST_COLD_MONTH_CLOSED" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("hosted writes admit unreferenced historical and current months", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cold-core-write-"));
  try {
    await initializeVault({ vaultRoot: root });
    await withIntegrationIngestMaterializer(root, async () => {}, async () => {
      await appendJsonlRecord({ vaultRoot: root, relativePath: logicalPath, record: record("2020-01-01T00:00:00.000Z") });
      const month = new Date().toISOString().slice(0, 7);
      await appendJsonlRecord({ vaultRoot: root, relativePath: `ledger/integration-ingests/${month.slice(0, 4)}/${month}.jsonl`, record: record(new Date().toISOString()) });
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});
