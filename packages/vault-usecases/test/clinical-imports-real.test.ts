import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { EventRecord } from "@murphai/contracts";
import { initializeVault, readJsonlRecords } from "@murphai/core";
import { describe, expect, it } from "vitest";

import {
  type ClinicalImportResult,
  importAssertionRecord,
  importClinicalNoteRecord,
  importDiagnosticTestRecord,
  importSocialHistoryRecord,
  importVitalsRecord,
} from "../src/usecases/clinical-imports.js";

async function createVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-clinical-imports-real-"));
  await initializeVault({
    vaultRoot,
    createdAt: "2026-06-17T12:00:00.000Z",
    timezone: "America/New_York",
  });
  return vaultRoot;
}

async function writePayload(vaultRoot: string, name: string, payload: unknown): Promise<string> {
  const inputFile = path.join(vaultRoot, `${name}.json`);
  await writeFile(inputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return `@${inputFile}`;
}

async function readImportedEvents(
  vaultRoot: string,
  result: ClinicalImportResult,
): Promise<EventRecord[]> {
  const ids = new Set(result.eventIds);
  const ledgerFiles = [...new Set(result.ledgerFiles)];
  const records = await Promise.all(
    ledgerFiles.map((relativePath) => readJsonlRecords({ vaultRoot, relativePath })),
  );
  return records.flat().filter((record): record is EventRecord =>
    typeof record === "object" &&
    record !== null &&
    "id" in record &&
    ids.has(String(record.id)),
  );
}

describe("clinical imports real vault roundtrips", () => {
  it("persists assertion, vitals, diagnostic-test, clinical-note, and social-history imports", async () => {
    const vaultRoot = await createVault();

    const assertion = await importAssertionRecord({
      vault: vaultRoot,
      inputFile: await writePayload(vaultRoot, "assertion", {
        eventId: "evt_01JQ9R7WF97M1WAB2B4QF2A201",
        occurredAt: "2026-06-17T14:00:00.000Z",
        source: "import",
        title: "Synthetic assertion",
        assertion: "denial_asserted",
        domain: "social",
        polarity: "denied",
        subject: "alcohol",
        assertionText: "Synthetic alcohol denial statement.",
        assertedOn: "2026-06-17",
        rawRefs: ["raw/documents/2026/06/synthetic-clinical-summary.pdf"],
        evidence: [{
          rawRef: "raw/documents/2026/06/synthetic-clinical-summary.pdf",
          page: 2,
          excerpt: "Synthetic alcohol denial excerpt.",
        }],
      }),
    });

    const vitals = await importVitalsRecord({
      vault: vaultRoot,
      inputFile: await writePayload(vaultRoot, "vitals", {
        eventId: "evt_01JQ9R7WF97M1WAB2B4QF2V201",
        occurredAt: "2026-06-17T14:05:00.000Z",
        source: "import",
        title: "Synthetic vitals",
        measurements: [
          { metric: "systolic-blood-pressure", value: 128, unit: "mmHg" },
          { metric: "heart-rate", value: 72, unit: "bpm" },
        ],
        rawRefs: ["raw/documents/2026/06/synthetic-clinical-summary.pdf"],
      }),
    });

    const diagnosticTest = await importDiagnosticTestRecord({
      vault: vaultRoot,
      inputFile: await writePayload(vaultRoot, "diagnostic-test", {
        eventId: "evt_01JQ9R7WF97M1WAB2B4QF2T201",
        occurredAt: "2026-06-17T15:00:00.000Z",
        source: "import",
        testName: "Synthetic urinalysis",
        resultStatus: "normal",
        summary: "Synthetic diagnostic-test summary.",
        testCategory: "urinalysis",
        specimenType: "urine",
        reportedAt: "2026-06-17T18:00:00.000Z",
        rawRefs: ["raw/documents/2026/06/synthetic-clinical-summary.pdf"],
      }),
    });

    const clinicalNote = await importClinicalNoteRecord({
      vault: vaultRoot,
      inputFile: await writePayload(vaultRoot, "clinical-note", {
        eventId: "evt_01JQ9R7WF97M1WAB2B4QF2N201",
        occurredAt: "2026-06-17T16:00:00.000Z",
        source: "import",
        title: "Synthetic clinical note",
        noteType: "progress_note",
        author: "Example clinician",
        sections: [
          { kind: "assessment", heading: "Assessment", text: "Synthetic assessment text." },
          { kind: "plan", heading: "Plan", text: "Synthetic plan text." },
        ],
        rawRefs: ["raw/documents/2026/06/synthetic-clinical-summary.pdf"],
      }),
    });

    const socialHistory = await importSocialHistoryRecord({
      vault: vaultRoot,
      inputFile: await writePayload(vaultRoot, "social-history", {
        occurredAt: "2026-06-17T17:00:00.000Z",
        source: "import",
        sourceLabel: "Synthetic social-history section",
        rawRefs: ["raw/documents/2026/06/synthetic-clinical-summary.pdf"],
        entries: [
          {
            category: "alcohol",
            status: "denied",
            statement: "Synthetic alcohol denial.",
            substance: "alcohol",
          },
          {
            category: "tobacco",
            status: "former",
            statement: "Synthetic former tobacco statement.",
            substance: "tobacco",
            frequency: "historical",
          },
          {
            category: "occupation",
            statement: "Synthetic occupation statement.",
          },
        ],
      }),
    });

    const imported = await readImportedEvents(vaultRoot, {
      vault: vaultRoot,
      eventIds: [
        ...assertion.eventIds,
        ...vitals.eventIds,
        ...diagnosticTest.eventIds,
        ...clinicalNote.eventIds,
        ...socialHistory.eventIds,
      ],
      lookupId: assertion.lookupId,
      ledgerFiles: [
        ...assertion.ledgerFiles,
        ...vitals.ledgerFiles,
        ...diagnosticTest.ledgerFiles,
        ...clinicalNote.ledgerFiles,
        ...socialHistory.ledgerFiles,
      ],
      auditPaths: [],
    });

    expect(imported).toHaveLength(7);
    expect(imported.find((event) => event.id === assertion.lookupId)).toMatchObject({
      kind: "clinical_assertion",
      assertion: "denial_asserted",
      evidence: [expect.objectContaining({ rawRef: "raw/documents/2026/06/synthetic-clinical-summary.pdf" })],
    });
    expect(imported.find((event) => event.id === vitals.lookupId)).toMatchObject({
      kind: "measurement",
      measurements: expect.arrayContaining([
        expect.objectContaining({ metric: "systolic-blood-pressure", value: 128 }),
      ]),
    });
    expect(imported.find((event) => event.id === diagnosticTest.lookupId)).toMatchObject({
      kind: "test",
      testName: "Synthetic urinalysis",
      summary: "Synthetic diagnostic-test summary.",
    });
    expect(imported.find((event) => event.id === clinicalNote.lookupId)).toMatchObject({
      kind: "note",
      note: "Structured clinical note with 2 sections.",
      sections: expect.arrayContaining([
        expect.objectContaining({ heading: "Assessment", text: "Synthetic assessment text." }),
      ]),
    });

    const socialKinds = imported
      .filter((event) => socialHistory.eventIds.includes(event.id))
      .map((event) => event.kind)
      .sort();
    expect(socialKinds).toEqual(["clinical_assertion", "exposure", "note"]);
  });
});
