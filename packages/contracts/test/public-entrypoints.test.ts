import { describe, expect, it } from "vitest";
import { z } from "zod";

import * as contracts from "../src/index.ts";
import { bankEntityDefinitionByKind } from "../src/bank-entities.ts";
import {
  collapseEventRevisions,
  compareEventRevisionPriority,
  eventRevisionFromLifecycle,
  parseEventLifecycle,
} from "../src/event-lifecycle.ts";
import { parseFrontmatterDocument } from "../src/frontmatter.ts";
import {
  buildMemoryPromptBlock,
  createEmptyMemoryDocument,
  createMemoryRecordId,
  forgetMemoryRecord,
  parseMemoryDocument,
  renderMemoryDocument,
  upsertMemoryRecord,
} from "../src/memory.ts";
import { createEmptyPreferencesDocument } from "../src/preferences.ts";
import {
  addDaysToIsoDate,
  extractIsoDatePrefix,
  formatTimeZoneDateTimeParts,
  isStrictIsoDateTime,
  normalizeIanaTimeZone,
  normalizeStrictIsoTimestamp,
  parseDailyTime,
  resolveSystemTimeZone,
  toLocalDayKey,
} from "../src/time.ts";
import {
  assertContract,
  safeParseContract,
} from "../src/validate.ts";
import {
  hasHealthEntityRegistry,
  healthEntityDefinitionByKind,
} from "../src/health-entities.ts";

describe("@murphai/contracts public entrypoint", () => {
  it("re-exports the curated helpers and registry maps from the source owners", () => {
    expect(contracts.bankEntityDefinitionByKind).toBe(bankEntityDefinitionByKind);
    expect(contracts.healthEntityDefinitionByKind).toBe(healthEntityDefinitionByKind);
    expect(contracts.parseFrontmatterDocument).toBe(parseFrontmatterDocument);
    expect(contracts.hasHealthEntityRegistry).toBe(hasHealthEntityRegistry);
    expect(
      contracts.healthEntityDefinitions.map((definition) => String(definition.kind)),
    ).not.toContain("history");
    expect(contracts.healthEntityDefinitionByKind.has("blood_test")).toBe(true);
  });

  it("exposes representative package surfaces through the root module", () => {
    expect(contracts.VAULT_LAYOUT.memoryDocument).toBe("bank/memory.md");
    expect(contracts.VAULT_SHARDS.events).toBe("ledger/events/YYYY/YYYY-MM.jsonl");
    expect(contracts.exampleVaultMetadata.formatVersion).toBe(
      contracts.CURRENT_VAULT_FORMAT_VERSION,
    );
    expect(contracts.safeParseContract(contracts.vaultMetadataSchema, contracts.exampleVaultMetadata)).toEqual({
      success: true,
      data: contracts.exampleVaultMetadata,
    });
  });

  it("covers the contracts helper seams exposed through the public package", () => {
    expect(createEmptyPreferencesDocument(new Date("2026-04-08T10:11:12.000Z"))).toEqual({
      schemaVersion: 1,
      updatedAt: "2026-04-08T10:11:12.000Z",
      workoutUnitPreferences: {},
    });

    expect(isStrictIsoDateTime("2026-04-08T10:11:12.000Z")).toBe(true);
    expect(normalizeStrictIsoTimestamp(new Date("2026-04-08T10:11:12.000Z"))).toBe(
      "2026-04-08T10:11:12.000Z",
    );
    expect(normalizeStrictIsoTimestamp(1_711_000_000_000)).toBe("2024-03-21T05:46:40.000Z");
    expect(normalizeStrictIsoTimestamp("2026-04-08")).toBe("2026-04-08T00:00:00.000Z");
    expect(normalizeStrictIsoTimestamp("not-a-timestamp")).toBeNull();
    expect(extractIsoDatePrefix(" 2026-04-08T10:11:12Z ")).toBe("2026-04-08");
    expect(normalizeIanaTimeZone("UTC")).toBe("UTC");
    expect(normalizeIanaTimeZone("Mars/Olympus")).toBeNull();
    expect(parseDailyTime("08:30")).toEqual({ hour: 8, minute: 30 });
    expect(addDaysToIsoDate("2026-04-08", 2)).toBe("2026-04-10");
    expect(toLocalDayKey("2026-04-08", "UTC")).toBe("2026-04-08");
    expect(formatTimeZoneDateTimeParts("2026-04-08T10:11:12.000Z", "UTC")).toMatchObject({
      dayKey: "2026-04-08",
      hour: 10,
      minute: 11,
      second: 12,
    });
    expect(resolveSystemTimeZone("UTC")).toMatch(/\S+/u);

    const contractResult = safeParseContract(
      z.union([
        z.object({ kind: z.literal("a"), value: z.string() }),
        z.object({ kind: z.literal("b"), count: z.number() }),
      ]),
      { kind: "c" },
    );
    expect(contractResult).toMatchObject({ success: false });
    if (!contractResult.success) {
      expect(contractResult.errors).toEqual(
        expect.arrayContaining([expect.stringContaining("$.kind")]),
      );
    }
    expect(
      safeParseContract(
        z.object({
          items: z.array(z.object({ name: z.string() })),
        }),
        {
          items: [{ name: 1 }],
        },
      ),
    ).toEqual({
      success: false,
      errors: [
        "$.items[0].name: Invalid input: expected string, received number",
      ],
    });
    expect(assertContract(z.object({ name: z.string().min(1) }), { name: "ok" })).toEqual({
      name: "ok",
    });

    expect(parseEventLifecycle(undefined)).toEqual({ state: "missing" });
    expect(eventRevisionFromLifecycle({ revision: 2, state: "deleted" })).toBe(2);
    expect(
      compareEventRevisionPriority(
        {
          lifecycle: { revision: 1 },
          occurredAt: "2026-04-08T00:00:00.000Z",
          recordedAt: "2026-04-08T00:00:00.000Z",
          relativePath: "ledger/events/a.jsonl",
        },
        {
          lifecycle: { revision: 2 },
          occurredAt: "2026-04-08T00:00:00.000Z",
          recordedAt: "2026-04-08T00:00:00.000Z",
          relativePath: "ledger/events/b.jsonl",
        },
      ),
    ).toBeLessThan(0);
    expect(
      collapseEventRevisions(
        [
          {
            eventId: "evt_01",
            lifecycle: { revision: 1 },
            occurredAt: "2026-04-08T00:00:00.000Z",
            recordedAt: "2026-04-08T00:00:00.000Z",
            relativePath: "ledger/events/a.jsonl",
          },
          {
            eventId: "evt_01",
            lifecycle: { revision: 2, state: "deleted" },
            occurredAt: "2026-04-08T00:01:00.000Z",
            recordedAt: "2026-04-08T00:01:00.000Z",
            relativePath: "ledger/events/b.jsonl",
          },
        ],
        (value) => value,
      ),
    ).toEqual([]);

    const memoryDocument = createEmptyMemoryDocument(new Date("2026-04-08T00:00:00.000Z"));
    const inserted = upsertMemoryRecord(memoryDocument, {
      now: new Date("2026-04-08T00:00:00.000Z"),
      section: "Context",
      text: "  Structured answers only  ",
    });
    expect(createMemoryRecordId({
      section: "Context",
      text: "Structured answers only",
    })).toBe(inserted.record.id);
    expect(buildMemoryPromptBlock(inserted.document)).toContain("Context:");
    expect(renderMemoryDocument({ document: inserted.document })).toContain("# Memory");
    expect(parseMemoryDocument({
      text: renderMemoryDocument({ document: inserted.document }),
      sourcePath: "bank/memory.md",
    })).toMatchObject({
      records: [
        expect.objectContaining({
          section: "Context",
          text: "Structured answers only",
        }),
      ],
    });
    expect(forgetMemoryRecord(inserted.document, { recordId: inserted.record.id }).record?.id).toBe(
      inserted.record.id,
    );

    expect(createEmptyPreferencesDocument(new Date("2026-04-08T00:00:00.000Z"))).toEqual({
      schemaVersion: 1,
      updatedAt: "2026-04-08T00:00:00.000Z",
      workoutUnitPreferences: {},
    });
    expect(contracts.VAULT_LAYOUT.preferencesDocument).toBe("bank/preferences.json");
  });
});
