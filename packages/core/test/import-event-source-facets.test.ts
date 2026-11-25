import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { hasClinicalRunChanges, clinicalChangeRunRef, listClinicalChangeReceipts, importEventBatch, initializeVault, listHistoryEvents, findEventByExternalRef } from "../src/index.ts";

const roots: string[] = [];
const v1 = "2026-07-01T12:00:00Z";
const v2 = "2026-07-02T12:00:00Z";
const v3 = "2026-07-03T12:00:00Z";
const parent = (version = v1, resourceId = "synthetic-parent") => ({ system: "synthetic-fhir", resourceType: "document-reference", resourceId, version });
const payload = (version = v1, facet?: string, resourceId?: string) => ({
  kind: "test", occurredAt: v1, title: "Synthetic source fact", testName: "Synthetic test", resultStatus: "normal", summary: "Synthetic clinical fact.", source: "import",
  externalRef: { ...parent(version, resourceId), ...(facet ? { facet } : {}) },
});
const child = (version = v1, facet = "document-extraction-first") => ({ action: "upsert", payload: payload(version, facet), sourceParent: parent(version) });
const withdraw = (version = v2) => ({ action: "retract", externalRef: parent(version), reason: "Synthetic source withdrawn", retractFacetPrefixes: ["document-extraction"] });
async function vault() {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "event-source-facets-")); roots.push(vaultRoot);
  await initializeVault({ vaultRoot, timezone: "UTC", createdAt: v1 }); return vaultRoot;
}
const rows = (vaultRoot: string) => listHistoryEvents({ vaultRoot, kinds: ["test"], limit: 100 });
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("explicit imported source facet lifecycle", () => {
  it("enumerates only committed fact revisions and binds replay to the frozen input", async () => {
    const vaultRoot = await vault();
    const origin = { connectionId: "source-a", runId: "run-a", inputDigest: "a".repeat(64) };
    const identity = (batch: number) => ({ ...origin, unit: { kind: "retrieval" as const, batch, generation: 1 } });
    const imports = (batch: number, decisions: Record<string, unknown>[]) =>
      importEventBatch({ vaultRoot, apply: true, decisions, receiptIdentity: identity(batch) });
    const group = { vaultRoot, runRef: clinicalChangeRunRef(origin.runId) };
    expect(await listClinicalChangeReceipts(group)).toEqual({ receipts: [], nextCursor: null });
    expect(await hasClinicalRunChanges(vaultRoot, origin.runId)).toBe(false);
    const marker = await imports(0, [withdraw()]);
    expect(marker).toMatchObject({ retractedCount: 1, receipt: { changes: [] } });
    expect(await hasClinicalRunChanges(vaultRoot, origin.runId)).toBe(false);
    const replay = await imports(0, []);
    expect(replay.receipt).toEqual(marker.receipt);
    const fact = { action: "upsert", payload: payload(v1, undefined, "fact-b") };
    const created = await imports(1, [fact]);
    expect(await hasClinicalRunChanges(vaultRoot, origin.runId)).toBe(true);
    expect(await hasClinicalRunChanges(vaultRoot, "other-run")).toBe(false);
    const eventId = created.eventIds[0];
    expect(created.receipt?.changes).toEqual([{ action: "created", eventId, revision: 1, externalRef: fact.payload.externalRef }]);
    const skipped = await imports(2, [fact]);
    expect(skipped).toMatchObject({ applied: false, skippedExistingCount: 1, receipt: { changes: [] } });
    expect((await imports(2, [])).receipt).toEqual(skipped.receipt);
    const amended = await imports(3, [{ ...fact, payload: { ...fact.payload, summary: "Revised synthetic fact.", externalRef: parent(v2, "fact-b") } }]);
    expect(amended.receipt?.changes).toEqual([{ action: "superseded", eventId, revision: 2, externalRef: parent(v2, "fact-b") }]);
    const withdrawn = await imports(4, [{ ...withdraw(v3), externalRef: parent(v3, "fact-b") }]);
    expect(withdrawn.receipt?.changes).toEqual([{ action: "retracted", eventId, revision: 3, externalRef: parent(v3, "fact-b") }]);
    for (const different of [{ ...identity(1), inputDigest: "b".repeat(64) }, { ...identity(1), connectionId: "source-b" }]) {
      await expect(importEventBatch({ vaultRoot, apply: true, decisions: [], receiptIdentity: different }))
        .rejects.toMatchObject({ code: "CLINICAL_RECEIPT_CONFLICT" });
    }
    const first = await listClinicalChangeReceipts({ ...group, limit: 2 });
    expect(first.receipts).toEqual([marker.receipt, created.receipt]);
    expect(await listClinicalChangeReceipts({ ...group, cursor: first.nextCursor! })).toEqual({
      receipts: [skipped.receipt, amended.receipt, withdrawn.receipt], nextCursor: null,
    });
  });

  it("ignores additive fields throughout v1 rows and refuses incompatible replay before a write", async () => {
    const vaultRoot = await vault();
    const identity = { connectionId: "source-b", runId: "skew", inputDigest: "d".repeat(64),
      unit: { kind: "retrieval" as const, batch: 0 } };
    const batch = { vaultRoot, apply: true, receiptIdentity: identity };
    const { receipt } = await importEventBatch({ ...batch, decisions: [{ action: "upsert", payload: payload() }] });
    const group = { vaultRoot, runRef: clinicalChangeRunRef(identity.runId) };
    const file = path.join(vaultRoot, "ledger/clinical-change-receipts", `${group.runRef}.jsonl`);
    const change = receipt!.changes[0]!;
    const extended = { ...receipt, future: true, identity: { ...identity, future: true, unit: { ...identity.unit, future: true } },
      changes: [{ ...change, future: true, externalRef: { ...change.externalRef, future: true } }] };
    await writeFile(file, JSON.stringify(extended) + "\n");
    expect((await importEventBatch({ ...batch, decisions: [] })).receipt).toEqual(receipt);
    expect((await listClinicalChangeReceipts(group)).receipts).toEqual([receipt]);
    await expect(importEventBatch({ ...batch, receiptIdentity: { ...extended.identity }, decisions: [] })).rejects.toThrow();
    for (const [row, code] of [
      [{ ...extended, schema: "murph.clinical-change-receipt.v2" }, "CLINICAL_RECEIPT_UNSUPPORTED_VERSION"],
      [{ ...extended, changes: [{}] }, "CLINICAL_RECEIPT_INVALID"],
    ] as const) {
      const bytes = JSON.stringify(row) + "\n";
      await writeFile(file, bytes);
      await expect(importEventBatch({ ...batch, decisions: [] })).rejects.toMatchObject({ code });
      expect(await readFile(file, "utf8")).toBe(bytes);
    }
  });

  it("distinguishes an exact facet-free source lookup from the legacy wildcard", async () => {
    const vaultRoot = await vault();
    await importEventBatch({ vaultRoot, apply: true, decisions: [child()] });
    expect(await findEventByExternalRef({ vaultRoot, ...parent(), facet: null })).toBeNull();
    expect(await findEventByExternalRef({ vaultRoot, ...parent() })).toMatchObject({ externalRef: { facet: "document-extraction-first" } });
    await importEventBatch({ vaultRoot, apply: true, decisions: [{ action: "upsert", payload: payload() }] });
    const exact = await findEventByExternalRef({ vaultRoot, ...parent(), facet: null });
    expect(exact).not.toBeNull();
    expect(exact?.externalRef?.facet).toBeUndefined();
  });

  it("retracts only owned parent facets, preserves unrelated sources and replays without new tombstones", async () => {
    const vaultRoot = await vault();
    await importEventBatch({ vaultRoot, apply: true, decisions: [child(), child(v1, "document-extraction-second"),
      { action: "upsert", payload: payload(v1, "unrelated-facet") },
      { action: "upsert", payload: payload(v1, "document-extractionx") },
      { action: "upsert", payload: payload(v1, "document-extraction-first", "other-parent") }] });
    expect((await importEventBatch({ vaultRoot, apply: true, decisions: [withdraw()] })).retractedCount).toBe(3);
    expect((await rows(vaultRoot)).map((row) => row.externalRef?.facet)).toEqual(expect.arrayContaining(["unrelated-facet", "document-extractionx", "document-extraction-first"]));
    expect(await rows(vaultRoot)).toHaveLength(3);
    expect((await importEventBatch({ vaultRoot, apply: true, decisions: [withdraw()] })).retractedCount).toBe(0);
  });

  it("rejects a newly discovered old facet after withdrawal even when no canonical parent ever existed", async () => {
    const vaultRoot = await vault();
    await importEventBatch({ vaultRoot, apply: true, decisions: [withdraw()] });
    await expect(importEventBatch({ vaultRoot, apply: true, decisions: [child(v1, "document-extraction-later")] })).rejects.toMatchObject({ code: "EVENT_SOURCE_PARENT_WITHDRAWN" });
    await expect(importEventBatch({ vaultRoot, apply: true, decisions: [child(v2)] })).rejects.toMatchObject({ code: "EVENT_SOURCE_PARENT_WITHDRAWN" });
    expect(await rows(vaultRoot)).toEqual([]);
    await importEventBatch({ vaultRoot, apply: true, decisions: [child(v3)] });
    expect(await rows(vaultRoot)).toHaveLength(1);
  });

  it("rejects stale parent revisions and permits matching revisions and absent source notes", async () => {
    const vaultRoot = await vault();
    await importEventBatch({ vaultRoot, apply: true, decisions: [{ action: "upsert", payload: payload(v2) }] });
    await expect(importEventBatch({ vaultRoot, apply: true, decisions: [child()] })).rejects.toMatchObject({ code: "EVENT_SOURCE_PARENT_STALE" });
    await importEventBatch({ vaultRoot, apply: true, decisions: [child(v2)] });
    expect(await rows(vaultRoot)).toHaveLength(2);
  });

  it.each([false, true])("rejects mixed stale-source batches atomically regardless of order (%s)", async (reverse) => {
    const vaultRoot = await vault();
    const decisions = [withdraw(), child()];
    await expect(importEventBatch({ vaultRoot, apply: true, decisions: reverse ? decisions.reverse() : decisions })).rejects.toMatchObject({ code: "EVENT_SOURCE_PARENT_WITHDRAWN" });
    // No root withdrawal or child was written; the previously valid child is still admissible.
    await importEventBatch({ vaultRoot, apply: true, decisions: [child()] });
    expect(await rows(vaultRoot)).toHaveLength(1);
  });

  it("does not let an older withdrawal remove newer derived facts", async () => {
    const vaultRoot = await vault();
    await importEventBatch({ vaultRoot, apply: true, decisions: [child(v3)] });
    await importEventBatch({ vaultRoot, apply: true, decisions: [withdraw(v2)] });
    expect(await rows(vaultRoot)).toHaveLength(1);
  });

  it("keeps legacy exact-facet retraction semantics unless the caller opts in", async () => {
    const vaultRoot = await vault();
    await importEventBatch({ vaultRoot, apply: true, decisions: [child()] });
    const { retractFacetPrefixes: _prefix, ...exact } = withdraw();
    await importEventBatch({ vaultRoot, apply: true, decisions: [exact] });
    expect(await rows(vaultRoot)).toHaveLength(1);
  });

  it.each([false, true])("invalidates older facets and compares reasserted clinical content (changed=%s)", async (changed) => {
    const vaultRoot = await vault();
    await importEventBatch({ vaultRoot, apply: true, decisions: [child()] });
    const receipt = { action: "upsert", invalidateFacetPrefixes: ["document-extraction"], payload: {
      kind: "note", occurredAt: v1, title: "Synthetic source document", note: "Source document attached.",
      noteType: "clinical-document-receipt", source: "import", externalRef: parent(v2),
    } };
    const invalidation = await importEventBatch({ vaultRoot, apply: true, decisions: [receipt],
      receiptIdentity: { connectionId: "example", runId: "invalidate", inputDigest: "c".repeat(64), unit: { kind: "retrieval", batch: 0 } } });
    expect(invalidation).toMatchObject({ retractedCount: 1, receipt: { changes: [] } });
    expect(await rows(vaultRoot)).toEqual([]);
    await expect(importEventBatch({ vaultRoot, apply: true, decisions: [child()] })).rejects.toMatchObject({ code: "EVENT_SOURCE_PARENT_STALE" });
    const identity = { connectionId: "example", runId: "invalidate", inputDigest: "b".repeat(64), unit: { kind: "enrichment" as const, batch: 0, jobId: "d".repeat(64), sourceId: "a".repeat(64), page: 1 } };
    const reassertion = child(v2);
    if (changed) reassertion.payload.summary = "Revised synthetic test interpretation.";
    const restored = await importEventBatch({ vaultRoot, apply: true, decisions: [reassertion], receiptIdentity: identity });
    expect(restored.createdCount).toBe(1);
    expect(restored.receipt?.changes).toMatchObject(changed ? [{ action: "created", eventId: restored.eventIds[0] }] : []);
    expect(await rows(vaultRoot)).toHaveLength(1);
    expect((await importEventBatch({ vaultRoot, apply: true, decisions: [receipt] })).retractedCount).toBe(0);
    expect(await rows(vaultRoot)).toHaveLength(1);
  });

  it("records a real creation when a withdrawn facet returns with identical content", async () => {
    const vaultRoot = await vault();
    await importEventBatch({ vaultRoot, apply: true, decisions: [child()] });
    await importEventBatch({ vaultRoot, apply: true, decisions: [withdraw()] });
    const restored = await importEventBatch({ vaultRoot, apply: true, decisions: [child(v3)],
      receiptIdentity: { connectionId: "example", runId: "restored", inputDigest: "a".repeat(64), unit: { kind: "retrieval", batch: 0 } } });
    expect(restored.receipt?.changes).toMatchObject([{ action: "created", revision: 1 }]);
  });

  it("materializes a truthful source receipt at the same revision and preserves full content on receipt replay", async () => {
    const vaultRoot = await vault();
    const receipt = { action: "upsert", payload: { kind: "note", occurredAt: v1, title: "Synthetic source document", note: "Source document attached.",
      noteType: "clinical-document-receipt", source: "import", externalRef: parent() } };
    const full = { action: "upsert", payload: { ...receipt.payload, noteType: "fhir_document_reference", note: "Synthetic complete report text." } };
    await importEventBatch({ vaultRoot, apply: true, decisions: [receipt] });
    expect((await importEventBatch({ vaultRoot, apply: true, decisions: [full] })).supersededCount).toBe(1);
    expect((await importEventBatch({ vaultRoot, apply: true, decisions: [receipt] })).skippedExistingCount).toBe(1);
    expect(await findEventByExternalRef({ vaultRoot, ...parent() })).toMatchObject({ note: full.payload.note });
    await expect(importEventBatch({ vaultRoot, apply: true, decisions: [{ ...full, payload: { ...full.payload, note: "Different report text." } }] })).rejects.toMatchObject({ code: "EVENT_SOURCE_REVISION_CONFLICT" });
  });

  it("rejects mismatched identities, revisions and faceted retraction authority before writes", async () => {
    const vaultRoot = await vault();
    const invalid = [
      { ...child(), sourceParent: parent(v2) },
      { ...child(), sourceParent: parent(v1, "other-parent") },
      { ...child(), sourceParent: { ...parent(), facet: "other" } },
      { ...withdraw(), externalRef: { ...parent(v2), facet: "unrelated" } },
    ];
    for (const decision of invalid) await expect(importEventBatch({ vaultRoot, apply: true, decisions: [decision] })).rejects.toMatchObject({ code: "EVENT_BATCH_INVALID" });
    expect(await rows(vaultRoot)).toEqual([]);
  });
});
