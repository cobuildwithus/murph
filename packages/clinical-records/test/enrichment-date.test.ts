import { describe, expect, it } from "vitest";
import { clinicalDateEvidenceMatches } from "../src/enrichment-date.ts";

describe("clinical document date evidence", () => {
  it.each(["UTC", "America/New_York", "Asia/Tokyo"])("preserves calendar-only dates in %s", (zone) => {
    expect(clinicalDateEvidenceMatches("2020-03-12", "March 12, 2020", zone)).toBe(true);
    expect(clinicalDateEvidenceMatches("2020-03-12", "March 11, 2020", zone)).toBe(false);
    expect(clinicalDateEvidenceMatches("2020-03-12", undefined, zone)).toBe(false);
  });
  it.each([
    "2020-03-12", "Exam: 2020-03-12T12:00:00Z.", "2020/03/12",
    "March 12, 2020", "Mar. 12th, 2020", "12 March 2020", "12-Mar-2020",
    "03/12/2020", "12/03/2020", "3-12-2020",
  ])("preserves the supported full date in %s", (evidence) => {
    expect(clinicalDateEvidenceMatches("2020-03-12T12:00:00Z", evidence, "UTC")).toBe(true);
  });

  it.each([
    undefined, "", "Date unknown", "March 2020", "03/12/20", "March 12, 2019",
    "2026-07-10", "2020-02-30", "02/30/2020", "February 30, 2020",
    "Exam: 2020-03-12. Exported: 2026-07-10.",
  ])("holds missing, invalid, partial or contradictory evidence: %s", (evidence) => {
    expect(clinicalDateEvidenceMatches("2020-03-12T12:00:00Z", evidence, "UTC")).toBe(false);
  });

  it.each([
    { at: "2020-03-13T01:30:00Z", evidence: "2020-03-12T21:30:00-04:00", zone: "America/New_York" },
    { at: "2020-03-13T01:30:00Z", evidence: "2020-03-12T21:30-0400", zone: "America/New_York" },
    { at: "2020-03-13T01:30:00Z", evidence: "March 12, 2020", zone: "America/New_York" },
    { at: "2020-03-12T20:30:00Z", evidence: "March 13, 2020", zone: "Asia/Tokyo" },
    { at: "2020-03-12T00:00:00Z", evidence: "March 12, 2020", zone: "America/New_York" },
  ])("retains timezone and date-only conventions: $at / $evidence", ({ at, evidence, zone }) => {
    expect(clinicalDateEvidenceMatches(at, evidence, zone)).toBe(true);
  });
});
