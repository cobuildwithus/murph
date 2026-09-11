import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { importEventBatch, initializeVault, listHistoryEvents, findEventByExternalRef } from "../src/index.ts";

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

  it("invalidates older facets on newer source receipts and permits same-content reassertion at the new source revision", async () => {
    const vaultRoot = await vault();
    await importEventBatch({ vaultRoot, apply: true, decisions: [child()] });
    const receipt = { action: "upsert", invalidateFacetPrefixes: ["document-extraction"], payload: {
      kind: "note", occurredAt: v1, title: "Synthetic source document", note: "Source document attached.",
      noteType: "clinical-document-receipt", source: "import", externalRef: parent(v2),
    } };
    expect((await importEventBatch({ vaultRoot, apply: true, decisions: [receipt] })).retractedCount).toBe(1);
    expect(await rows(vaultRoot)).toEqual([]);
    await expect(importEventBatch({ vaultRoot, apply: true, decisions: [child()] })).rejects.toMatchObject({ code: "EVENT_SOURCE_PARENT_STALE" });
    await importEventBatch({ vaultRoot, apply: true, decisions: [child(v2)] });
    expect(await rows(vaultRoot)).toHaveLength(1);
    expect((await importEventBatch({ vaultRoot, apply: true, decisions: [receipt] })).retractedCount).toBe(0);
    expect(await rows(vaultRoot)).toHaveLength(1);
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
