import { describe, expect, it } from "vitest";
import {
  createEmptyMemoryDocument, createMemoryRecordId, forgetMemoryRecord,
  resolveMemoryDemographics, setMemoryDemographics, upsertMemoryRecord,
  validateMemoryDemographicsPatch, type MemoryDocument,
} from "../src/memory.ts";
import { companionDemographicsRequestSchema, parseMemberActionRequestV1, parseMemberActionOutcomeV1 } from "../src/member-action.ts";

const now = new Date("2026-11-04T12:00:00Z");
function document(...texts: string[]): MemoryDocument {
  const empty = createEmptyMemoryDocument(now);
  return { ...empty, records: texts.map(text => ({
    id: createMemoryRecordId({ section: "Identity", text }), section: "Identity", text,
    createdAt: now.toISOString(), updatedAt: now.toISOString(), sourceLine: 1, sourcePath: "bank/memory.md",
  })) };
}
const resolve = (...texts: string[]) => resolveMemoryDemographics(document(...texts));

describe("canonical memory demographics", () => {
  it("distinguishes absence and unrelated gender prose from constrained evidence", async () => {
    expect(await resolve("Gender: woman", "Is 39 years old")).toMatchObject({ birthYear: null, biologicalSex: null, status: "resolved" });
  });
  it.each([
    [["Date of birth: 1986-07-12"], 1986, "exact"],
    [["Date of birth: 1986-07-12", "Birth year: 1986"], 1986, "exact"],
    [["Age: 39 (as of 2025-12-31)"], 1986, "approximate"],
    [["Date of birth: 1986-07-12", "Age: 39 (as of 2026-01-01)"], 1986, "exact"],
  ] as const)("resolves birth facts %j", async (texts, birthYear, birthYearPrecision) => {
    expect(await resolve(...texts)).toMatchObject({ birthYear, birthYearPrecision, status: "resolved" });
  });
  it.each([
    ["Date of birth: 1986-02-30"], ["Birth year: unknown"], ["Biological sex: woman"],
    ["Age: 39"], ["Age: 39 (as of 2026-02-30)"],
    ["Date of birth: 1986-07-12", "Date of birth: 1986-07-12"],
    ["Birth year: 1986", "Birth year: 1986"],
    ["Biological sex: female", "Biological sex: female"],
    ["Date of birth: 1986-07-12", "Birth year: 1980"],
    ["Date of birth: 1986-07-12", "Age: 20 (as of 2026-01-01)"],
  ])("never arbitrarily selects malformed, duplicate or conflicting facts: %j", async (...texts) => {
    expect((await resolve(...texts)).status).toBe("unresolved");
  });
  it("keeps resolution per field while marking the snapshot unresolved", async () => {
    expect(await resolve("Birth year: bad", "Biological sex: female")).toMatchObject({ birthYear: null, biologicalSex: "female", status: "unresolved" });
  });
  it("preserves a matching DOB without fabricating or rewriting month/day", async () => {
    const original = document("Date of birth: 1986-07-12", "Likes hiking");
    expect(setMemoryDemographics(original, { birthYear: 1986, now })).toBe(original);
    const conflict = setMemoryDemographics(original, { birthYear: 1980, now });
    expect(conflict.records.map(r => r.text)).toContain("Date of birth: 1986-07-12");
    expect((await resolveMemoryDemographics(conflict)).status).toBe("unresolved");
  });
  it("repairs duplicates, preserves omission, clears one field, and keeps exact retries unchanged", async () => {
    const original = document("Birth year: 1980", "Birth year: 1981", "Biological sex: female", "Likes hiking");
    const changed = setMemoryDemographics(original, { birthYear: 1986, now });
    expect(setMemoryDemographics(changed, { birthYear: 1986, now })).toBe(changed);
    const cleared = setMemoryDemographics(changed, { biologicalSex: null, now });
    expect(await resolveMemoryDemographics(cleared)).toMatchObject({ birthYear: 1986, biologicalSex: null, status: "resolved" });
    expect(cleared.records.map(r => r.text)).toContain("Likes hiking");
    expect((await resolveMemoryDemographics(setMemoryDemographics(cleared, { age: null, now }))).birthYear).toBeNull();
  });
  it("uses source date across New Year and replaces approximate age with exact year", async () => {
    const aged = setMemoryDemographics(document(), { age: 39, asOf: "2025-12-31", now });
    expect(await resolveMemoryDemographics(aged)).toMatchObject({ birthYear: 1986, birthYearPrecision: "approximate" });
    const exact = setMemoryDemographics(aged, { birthYear: 1985, now });
    expect(exact.records.map(r => r.text)).toEqual(["Birth year: 1985"]);
    const generic = upsertMemoryRecord(aged, { section: "Identity", text: "Birth year: 1985", now }).document;
    expect(generic.records.map(r => r.text)).toEqual(["Birth year: 1985"]);
    const dob = upsertMemoryRecord(aged, { section: "Identity", text: "Date of birth: 1985-12-10", now }).document;
    expect(dob.records.map(r => r.text)).toEqual(["Date of birth: 1985-12-10"]);
  });
  it("generic updates validate recognized text, keep Identity, deduplicate, and forget clears duplicates", async () => {
    const original = document("Birth year: 1980", "Birth year: 1981");
    const recordId = original.records[0]!.id;
    for (const replacement of [
      { section: "Identity", text: "Birth year: bad" },
      { section: "Context", text: "Birth year: 1986" },
      { section: "Identity", text: "Born around 1986" },
    ] as const) expect(() => upsertMemoryRecord(original, { ...replacement, recordId, now })).toThrow();
    const changed = upsertMemoryRecord(original, { section: "Identity", text: "Birth year: 1986", recordId, now }).document;
    expect(changed.records).toHaveLength(1);
    expect(await resolveMemoryDemographics(changed)).toMatchObject(await resolveMemoryDemographics(setMemoryDemographics(original, { birthYear: 1986, now })));
    expect(forgetMemoryRecord(original, { recordId }).document.records).toEqual([]);
    const wrongSection = document("Birth year: 1986"); wrongSection.records[0]!.section = "Context";
    expect((await resolveMemoryDemographics(wrongSection)).status).toBe("unresolved");
  });
  it("a newer scheduling DOB supersedes an older bare year or dated age", async () => {
    const initial = document("Birth year: 1986");
    const scheduled = upsertMemoryRecord(initial, { section: "Identity", text: "Date of birth: 1985-12-10", now }).document;
    expect(scheduled.records.map(r => r.text)).toEqual(["Date of birth: 1985-12-10"]);
    expect(await resolveMemoryDemographics(scheduled)).toMatchObject({
      birthYear: 1985, birthYearPrecision: "exact", status: "resolved",
    });
    const repaired = setMemoryDemographics(scheduled, { birthYear: 1985, now });
    expect(repaired.records.map(r => r.text)).toEqual(["Date of birth: 1985-12-10"]);
  });
  it("a newer stated age supersedes an older bare year but must agree with a full DOB", async () => {
    const stale = setMemoryDemographics(document("Birth year: 1980"), { age: 35, now });
    expect(stale.records.map(r => r.text)).toEqual([`Age: 35 (as of ${now.toISOString().slice(0, 10)})`]);
    expect((await resolveMemoryDemographics(stale)).status).toBe("resolved");
    const withDob = setMemoryDemographics(document("Date of birth: 1980-03-01"), { age: 35, now });
    expect((await resolveMemoryDemographics(withDob)).status).toBe("unresolved");
  });
  it("fingerprints only recognized evidence, including revision metadata", async () => {
    const initial = document("Birth year: 1986");
    const unrelated = upsertMemoryRecord(initial, { section: "Preferences", text: "Likes walking", now }).document;
    expect(await resolveMemoryDemographics(unrelated)).toEqual(await resolveMemoryDemographics(initial));
    const edited = structuredClone(initial); edited.records[0]!.updatedAt = "2026-11-05T00:00:00Z";
    expect((await resolveMemoryDemographics(edited)).revision).not.toBe((await resolveMemoryDemographics(initial)).revision);
  });
  it("bounds admission and preserves the closed member-action contract", () => {
    for (const patch of [{}, { age: 12 }, { age: 121 }, { birthYear: 1899 }, { birthYear: 2027 }, { age: 39, birthYear: null }, { biologicalSex: "woman" }]) {
      expect(() => validateMemoryDemographicsPatch(patch, now)).toThrow();
    }
    const actionId = "d8653d1f-fb8d-400b-8efe-d3fbdc9f9830";
    const requestedAt = now.toISOString();
    expect(companionDemographicsRequestSchema.safeParse({ actionId, requestedAt }).success).toBe(false);
    expect(parseMemberActionRequestV1({ actionId, requestedAt, schemaVersion: 1,
      action: { kind: "demographics.set", version: 1, patch: { biologicalSex: null } },
    }).action.kind).toBe("demographics.set");
    expect(parseMemberActionOutcomeV1({ actionId, completedAt: requestedAt, schemaVersion: 1,
      status: "rejected", reason: "demographics_unresolved" }).status).toBe("rejected");
  });
});
