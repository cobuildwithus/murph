import { describe, expect, it } from "vitest";
import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { buildJournalView } from "../src/journal-view.ts";
import { createVaultReadModel } from "../src/read-model.ts";

const importedAt = "2026-08-25T13:00:00.000Z";
const historicalAt = "2026-06-10T16:00:00.000Z";
function record(id: string, options: { kind?: string; at?: string; facet?: string; resourceId?: string; version?: string; attributes?: Record<string, unknown> } = {}): CanonicalEntity {
  const at = options.at ?? historicalAt;
  return {
    entityId: id, primaryLookupId: id, lookupIds: [id], family: "event", recordClass: "ledger",
    kind: options.kind ?? "note", occurredAt: at, date: at.slice(0, 10), title: "Synthetic report",
    status: null, body: null, path: "ledger/events/synthetic.jsonl", frontmatter: null,
    links: [], relatedIds: [], stream: null, experimentSlug: null, tags: [],
    attributes: { source: "import", recordedAt: importedAt, note: "A documented finding.",
      externalRef: { system: "epic-fhir-synthetic", resourceType: "diagnostic-report", resourceId: options.resourceId ?? "example-report",
        version: options.version ?? importedAt, ...(options.facet ? { facet: options.facet } : {}) }, ...options.attributes },
  };
}
function journal(events: CanonicalEntity[]) {
  return buildJournalView(createVaultReadModel({ vaultRoot: "test://clinical-journal", entities: events, metadata: { timezone: "America/New_York" } }), [], { asOf: "2026-08-25T18:00:00.000Z" });
}

describe("clinical Journal presentation", () => {
  it("keeps ambiguous retrieval-day extraction out of dated bands without changing evidence", () => {
    const parent = record("parent", { attributes: { noteType: "clinical-document-receipt" } });
    const test = record("test", { kind: "test", at: "2026-08-25T00:00:00.000Z", facet: "document-extraction-test" });
    const note = record("note", { at: "2026-08-25T00:00:00.000Z", facet: "document-extraction-history" });
    const before = structuredClone([parent, test, note]);
    const view = journal([parent, test, note]);
    expect(view.days.map((day) => day.date)).toEqual(["2026-06-10"]);
    expect(view.eventCount).toBe(1);
    expect(view.days[0]?.events[0]).toMatchObject({ kind: "note", summary: "Imported health record", occurredAt: historicalAt });
    expect(view.days[0]?.events[0]?.records).toHaveLength(1);
    expect(view.days[0]?.events[0]?.records.every((row) => row.source === "Hospital records")).toBe(true);
    expect([parent, test, note]).toEqual(before);
  });

  it("groups correctly dated derived reports while preserving every source record", () => {
    const parent = record("parent", { attributes: { noteType: "clinical-document-receipt" } });
    const test = record("test", { kind: "test", facet: "document-extraction-test" });
    const note = record("note", { facet: "document-extraction-history" });
    const view = journal([parent, test, note]);
    expect(view.eventCount).toBe(1);
    expect(view.days[0]?.events[0]).toMatchObject({ kind: "test", summary: "A documented finding.", occurredAt: historicalAt });
    expect(view.days[0]?.events[0]?.records).toHaveLength(3);
  });

  it("preserves an explicitly supported import-day follow-up in an older document", () => {
    const child = record("follow-up", { at: importedAt, facet: "document-extraction-follow-up" });
    child.tags = ["clinical-date-document"];
    expect(journal([record("parent"), child]).days.map((day) => day.date)).toEqual(["2026-08-25", "2026-06-10"]);
  });

  it("does not surface old reports today when their true dates are outside the history window", () => {
    const parent = record("parent", { at: "2020-02-03T12:00:00.000Z" });
    const child = record("child", { at: "2026-08-25T00:00:00.000Z", facet: "document-extraction-history" });
    expect(journal([parent, child]).eventCount).toBe(0);
  });

  it("preserves a different documented historical date within the same source", () => {
    const parent = record("parent");
    const child = record("child", { at: "2026-07-10T12:00:00.000Z", facet: "document-extraction-history" });
    expect(journal([parent, child]).days.map((day) => day.date)).toEqual(["2026-07-10", "2026-06-10"]);
  });

  it("does not join similar titles from different source records or revisions", () => {
    expect(journal([record("a"), record("b", { resourceId: "other-report" }), record("c", { version: "2026-08-24T12:00:00Z" })]).eventCount).toBe(3);
  });

  it("keeps source-only dates out of daily bands without deleting canonical records", () => {
    const careTeam = record("care-team", { at: importedAt, attributes: {
      noteType: "fhir_careteam", note: `Provider CareTeam record.\n\nRecord retrieved: ${importedAt}. Clinical event date is not available.\n\n{"status":"active"}`,
    } });
    expect(journal([careTeam]).eventCount).toBe(0);
    expect(careTeam.attributes.note).toContain("Clinical event date is not available.");
  });

  it("shows readable source labels instead of JSON, codes and internal identifiers", () => {
    const visit = record("visit", { attributes: {
      noteType: "fhir_encounter", note: `Provider Encounter record.\n\nClinical record date: ${historicalAt}\n\n${JSON.stringify({ status: "finished", type: [{ text: "Office visit" }], serviceProvider: { display: "Example clinic", reference: "Organization/internal-key" }, category: [{ coding: [{ system: "urn:example", code: "internal-code", display: "Outpatient" }] }] })}`,
    } });
    const entry = journal([visit]).days[0]?.events[0];
    expect(entry).toMatchObject({ title: "Office visit", summary: "Status: finished" });
    expect(entry?.details).toEqual(["Category: Outpatient", "Provider: Example clinic"]);
    expect(JSON.stringify(entry)).not.toContain("internal-key");
    expect(JSON.stringify(entry)).not.toContain("internal-code");
    expect(JSON.stringify(entry)).not.toContain("urn:example");
  });

  it("preserves date-only precision and ordinary non-clinical notes", () => {
    const note = record("manual", { at: "2026-08-25", attributes: { externalRef: undefined, source: "manual", note: "Personal note." } });
    expect(journal([note]).days[0]?.events[0]).toMatchObject({ summary: "Personal note.", timing: "all_day" });
  });
});
