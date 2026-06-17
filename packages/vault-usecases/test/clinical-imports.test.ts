import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertionImportPayloadSchema,
  importSocialHistoryRecord,
  saveAssertionPayload,
  scaffoldAssertionImportPayload,
  scaffoldClinicalNoteImportPayload,
  scaffoldDiagnosticTestImportPayload,
  scaffoldSocialHistoryImportPayload,
  scaffoldVitalsImportPayload,
  socialHistoryImportPayloadSchema,
} from "../src/usecases/clinical-imports.js";

const mocks = vi.hoisted(() => ({
  appendHistoryEvent: vi.fn(),
  upsertEvent: vi.fn(),
  importEventBatch: vi.fn(),
}));

vi.mock("../src/runtime-import.js", () => ({
  loadRuntimeModule: vi.fn(async () => ({
    appendHistoryEvent: mocks.appendHistoryEvent,
    upsertEvent: mocks.upsertEvent,
    importEventBatch: mocks.importEventBatch,
  })),
}));

function createHistoryResult(input: { eventId?: string }) {
  return {
    record: { id: input.eventId ?? "evt_01JQ9R7WF97M1WAB2B4QF2H100" },
    relativePath: "ledger/events/2026/2026-06.jsonl",
    auditPath: "system/audit/2026-06.jsonl",
  };
}

function createUpsertResult(input: { payload: Record<string, unknown> }) {
  return {
    eventId: typeof input.payload.eventId === "string" ? input.payload.eventId : "evt_01JQ9R7WF97M1WAB2B4QF2U100",
    ledgerFile: "ledger/events/2026/2026-06.jsonl",
    created: true,
  };
}

async function writePayload(payload: unknown): Promise<{ inputFile: string; vaultRoot: string }> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-clinical-imports-"));
  const inputFile = path.join(vaultRoot, "payload.json");
  await writeFile(inputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return { inputFile, vaultRoot };
}

describe("clinical import usecases", () => {
  beforeEach(() => {
    mocks.appendHistoryEvent.mockReset();
    mocks.upsertEvent.mockReset();
    mocks.importEventBatch.mockReset();
    mocks.appendHistoryEvent.mockImplementation(async (input: { eventId?: string }) =>
      createHistoryResult(input),
    );
    mocks.upsertEvent.mockImplementation(async (input: { payload: Record<string, unknown> }) =>
      createUpsertResult(input),
    );
    mocks.importEventBatch.mockResolvedValue({
      applied: true,
      receivedCount: 3,
      createdCount: 3,
      skippedExistingCount: 0,
      supersededCount: 0,
      eventIds: [
        "evt_01JQ9R7WF97M1WAB2B4QF2S100",
        "evt_01JQ9R7WF97M1WAB2B4QF2S101",
        "evt_01JQ9R7WF97M1WAB2B4QF2S102",
      ],
      eventShardPaths: ["ledger/events/2026/2026-06.jsonl"],
      auditPath: "system/audit/2026-06.jsonl",
    });
  });

  it("emits schema-valid synthetic scaffolds", () => {
    expect(assertionImportPayloadSchema.safeParse(scaffoldAssertionImportPayload()).success).toBe(true);
    expect(scaffoldVitalsImportPayload().measurements.length).toBeGreaterThan(0);
    expect(scaffoldDiagnosticTestImportPayload().testName).toBe("Urinalysis");
    expect(scaffoldClinicalNoteImportPayload().sections?.[0]?.kind).toBe("assessment");
    expect(socialHistoryImportPayloadSchema.safeParse(scaffoldSocialHistoryImportPayload()).success).toBe(true);
    expect(socialHistoryImportPayloadSchema.safeParse({
      occurredAt: "2026-06-17T14:00:00.000Z",
      entries: [
        {
          category: "tobacco",
          status: "former",
          statement: "Synthetic missing external ref.",
        },
      ],
    }).success).toBe(false);
  });

  it("saves expanded clinical assertions with bounded evidence refs", async () => {
    const payload = assertionImportPayloadSchema.parse({
      eventId: "evt_01JQ9R7WF97M1WAB2B4QF2A101",
      occurredAt: "2026-06-17T14:00:00.000Z",
      source: "import",
      title: "Synthetic denial",
      assertion: "denial_asserted",
      domain: "social",
      polarity: "denied",
      subject: "alcohol",
      assertionText: "Synthetic denial statement.",
      assertedOn: "2026-06-17",
      sourceLabel: "Synthetic social history section",
      evidence: [
        {
          sourceDocumentId: "doc_01ARZ3NDEKTSV4RRFFQ69G5FAV",
          page: 4,
          spanStart: 80,
          spanEnd: 120,
          excerpt: "Synthetic denial excerpt.",
        },
      ],
    });

    const result = await saveAssertionPayload({
      vault: "/tmp/murph-synthetic-vault",
      payload,
    });

    expect(result.eventIds).toEqual(["evt_01JQ9R7WF97M1WAB2B4QF2A101"]);
    expect(mocks.appendHistoryEvent).toHaveBeenCalledWith(expect.objectContaining({
      vaultRoot: "/tmp/murph-synthetic-vault",
      kind: "clinical_assertion",
      assertion: "denial_asserted",
      domain: "social",
      polarity: "denied",
      subject: "alcohol",
      assertionText: "Synthetic denial statement.",
      evidence: [
        expect.objectContaining({
          sourceDocumentId: "doc_01ARZ3NDEKTSV4RRFFQ69G5FAV",
          page: 4,
        }),
      ],
    }));
  });

  it("maps social history entries onto canonical assertion, exposure, and note events", async () => {
    const { inputFile, vaultRoot } = await writePayload({
      occurredAt: "2026-06-17T14:00:00.000Z",
      source: "import",
      sourceLabel: "Synthetic social history section",
      rawRefs: ["raw/documents/2026/06/synthetic-clinical-summary.pdf"],
      entries: [
        {
          category: "alcohol",
          status: "denied",
          statement: "Synthetic alcohol denial.",
          externalRef: {
            system: "synthetic-pdf",
            resourceType: "social-history-entry",
            resourceId: "synthetic-clinical-summary",
            facet: "alcohol",
          },
          substance: "alcohol",
        },
        {
          category: "tobacco",
          status: "former",
          statement: "Synthetic former tobacco statement.",
          externalRef: {
            system: "synthetic-pdf",
            resourceType: "social-history-entry",
            resourceId: "synthetic-clinical-summary",
            facet: "tobacco",
          },
          substance: "tobacco",
          frequency: "historical",
          startedOn: "2010-01-01",
          endedOn: "2020-01-01",
        },
        {
          category: "occupation",
          statement: "Synthetic occupation statement.",
          externalRef: {
            system: "synthetic-pdf",
            resourceType: "social-history-entry",
            resourceId: "synthetic-clinical-summary",
            facet: "occupation",
          },
        },
      ],
    });

    const result = await importSocialHistoryRecord({
      vault: vaultRoot,
      inputFile: `@${inputFile}`,
    });

    expect(result.eventIds).toEqual([
      "evt_01JQ9R7WF97M1WAB2B4QF2S100",
      "evt_01JQ9R7WF97M1WAB2B4QF2S101",
      "evt_01JQ9R7WF97M1WAB2B4QF2S102",
    ]);
    expect(mocks.appendHistoryEvent).not.toHaveBeenCalled();
    expect(mocks.upsertEvent).not.toHaveBeenCalled();
    expect(mocks.importEventBatch).toHaveBeenCalledTimes(1);
    const payloads = mocks.importEventBatch.mock.calls[0]?.[0].payloads as Record<string, unknown>[];
    expect(payloads[0]).toEqual(expect.objectContaining({
      kind: "clinical_assertion",
      assertion: "denial_asserted",
      domain: "social",
      polarity: "denied",
      subject: "alcohol",
      assertedOn: "2026-06-17",
      externalRef: {
        system: "synthetic-pdf",
        resourceType: "social-history-entry",
        resourceId: "synthetic-clinical-summary",
        facet: "alcohol",
      },
    }));
    expect(payloads[1]).toEqual(expect.objectContaining({
      kind: "exposure",
      exposureType: "tobacco",
      substance: "tobacco",
      duration: "historical; 2010-01-01; 2020-01-01",
      note: expect.stringContaining("status: former"),
      externalRef: {
        system: "synthetic-pdf",
        resourceType: "social-history-entry",
        resourceId: "synthetic-clinical-summary",
        facet: "tobacco",
      },
    }));
    expect(String(payloads[1]?.note)).toContain("startedOn: 2010-01-01");
    expect(String(payloads[1]?.note)).toContain("endedOn: 2020-01-01");
    expect(payloads[2]).toEqual(expect.objectContaining({
      kind: "note",
      noteType: "social_history",
      tags: ["social-history", "occupation"],
      externalRef: {
        system: "synthetic-pdf",
        resourceType: "social-history-entry",
        resourceId: "synthetic-clinical-summary",
        facet: "occupation",
      },
    }));
  });

  it("rejects duplicate social-history externalRef identities before batch import", async () => {
    const payload = {
      occurredAt: "2026-06-17T14:00:00.000Z",
      source: "import",
      entries: [
        {
          category: "tobacco",
          status: "former",
          statement: "Synthetic former tobacco statement.",
          externalRef: {
            system: "synthetic-pdf",
            resourceType: "social-history-entry",
            resourceId: "synthetic-clinical-summary",
            version: "first",
            facet: "tobacco",
          },
          substance: "tobacco",
        },
        {
          category: "tobacco",
          status: "current",
          statement: "Synthetic current tobacco statement.",
          externalRef: {
            system: "synthetic-pdf",
            resourceType: "social-history-entry",
            resourceId: "synthetic-clinical-summary",
            version: "second",
            facet: "tobacco",
          },
          substance: "tobacco",
        },
      ],
    };
    const parsed = socialHistoryImportPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error("Expected duplicate social-history externalRef identity to fail validation.");
    }
    expect(parsed.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ["entries", 1, "externalRef"],
        message: expect.stringContaining("Duplicate social-history externalRef identity"),
      }),
    ]));

    const { inputFile, vaultRoot } = await writePayload(payload);
    await expect(importSocialHistoryRecord({
      vault: vaultRoot,
      inputFile: `@${inputFile}`,
    })).rejects.toThrow("social-history payload is invalid.");
    expect(mocks.importEventBatch).not.toHaveBeenCalled();
  });

  it("keeps unknown social-history exposure categories as notes instead of positive exposure events", async () => {
    const { inputFile, vaultRoot } = await writePayload({
      occurredAt: "2026-06-17T14:00:00.000Z",
      source: "import",
      entries: [
        {
          category: "tobacco",
          status: "unknown",
          statement: "Synthetic tobacco status unknown.",
          externalRef: {
            system: "synthetic-pdf",
            resourceType: "social-history-entry",
            resourceId: "synthetic-clinical-summary",
            facet: "tobacco-unknown",
          },
          substance: "tobacco",
        },
      ],
    });

    await importSocialHistoryRecord({
      vault: vaultRoot,
      inputFile: `@${inputFile}`,
    });

    const payloads = mocks.importEventBatch.mock.calls[0]?.[0].payloads as Record<string, unknown>[];
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual(expect.objectContaining({
      kind: "note",
      noteType: "social_history",
      note: expect.stringContaining("status: unknown"),
    }));
  });
});
