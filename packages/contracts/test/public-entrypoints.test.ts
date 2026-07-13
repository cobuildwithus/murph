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
    expect(contracts.healthEntityDefinitionByKind.has("immunization")).toBe(true);
  });

  it("exposes representative package surfaces through the root module", () => {
    expect(contracts.VAULT_LAYOUT.memoryDocument).toBe("bank/memory.md");
    expect(contracts.VAULT_SHARDS.events).toBe("ledger/events/YYYY/YYYY-MM.jsonl");
    expect("sharePack" in contracts.CONTRACT_SCHEMA_VERSION).toBe(false);
    expect("sharePackSchema" in contracts).toBe(false);
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
      wearablePreferences: {
        desiredProviders: [],
      },
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
    expect(contracts.isContractId(inserted.record.id, "mem")).toBe(true);
    expect(contracts.isContractId(createMemoryRecordId({
      section: "Context",
      text: "Structured answers only",
    }), "mem")).toBe(true);
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
      wearablePreferences: {
        desiredProviders: [],
      },
    });
    expect(
      contracts.safeParseContract(contracts.preferencesDocumentSchema, {
        schemaVersion: 1,
        updatedAt: "2026-04-08T00:00:00.000Z",
        workoutUnitPreferences: {
          weight: "kg",
        },
        wearablePreferences: {
          desiredProviders: [],
        },
      }),
    ).toEqual({
      success: true,
      data: {
        schemaVersion: 1,
        updatedAt: "2026-04-08T00:00:00.000Z",
        workoutUnitPreferences: {
          weight: "kg",
        },
        wearablePreferences: {
          desiredProviders: [],
        },
      },
    });
    expect(contracts.isWearablePreferenceProvider('oura')).toBe(true);
    expect(contracts.isWearablePreferenceProvider('fitbit')).toBe(false);
    expect(contracts.normalizeWearablePreferenceProviders(undefined)).toEqual([]);
    expect(
      contracts.normalizeWearablePreferenceProviders(['whoop', 'garmin', 'whoop']),
    ).toEqual(['garmin', 'whoop']);
    expect(contracts.assistantVoiceOptions.map((option) => ({
      elevenLabsVoiceId: option.elevenLabsVoiceId,
      gender: option.gender,
      id: option.id,
      label: option.label,
      previewPath: option.previewPath,
    }))).toEqual([
      {
        elevenLabsVoiceId: "tnSpp4vdxKPjI9w0GnoV",
        gender: "female",
        id: "upbeat",
        label: "Classic Murph",
        previewPath: "/audio/murph-voices/upbeat.mp3",
      },
      {
        elevenLabsVoiceId: null,
        gender: "male",
        id: "classic",
        label: "New York",
        previewPath: "/audio/murph-voices/classic.mp3",
      },
      {
        elevenLabsVoiceId: "DGzg6RaUqxGRTHSBjfgF",
        gender: "male",
        id: "drill-sergeant",
        label: "Drill sergeant",
        previewPath: "/audio/murph-voices/drill-sergeant.mp3",
      },
      {
        elevenLabsVoiceId: "NOpBlnGInO9m6vDvFkFC",
        gender: "male",
        id: "grandpa",
        label: "Grandpa",
        previewPath: "/audio/murph-voices/grandpa.mp3",
      },
      {
        elevenLabsVoiceId: "Bj9UqZbhQsanLzgalpEG",
        gender: "male",
        id: "country",
        label: "Country",
        previewPath: "/audio/murph-voices/country.mp3",
      },
      {
        elevenLabsVoiceId: "dhwafD61uVd8h85wAZSE",
        gender: "male",
        id: "jamaican",
        label: "Jamaican, deep",
        previewPath: "/audio/murph-voices/jamaican.mp3",
      },
      {
        elevenLabsVoiceId: "nrD2uNU2IUYtedZegcGx",
        gender: "male",
        id: "radio-host",
        label: "Radio host",
        previewPath: "/audio/murph-voices/radio-host.mp3",
      },
      {
        elevenLabsVoiceId: "Gubgw9l4dtIoQA9YZHgx",
        gender: "male",
        id: "deep-calm",
        label: "Deep and calming",
        previewPath: "/audio/murph-voices/deep-calm.mp3",
      },
      {
        elevenLabsVoiceId: "EST9Ui6982FZPSi7gCHi",
        gender: "female",
        id: "warm",
        label: "Warm and friendly",
        previewPath: "/audio/murph-voices/warm.mp3",
      },
      {
        elevenLabsVoiceId: "EkK5I93UQWFDigLMpZcX",
        gender: "male",
        id: "husky",
        label: "Husky and bold",
        previewPath: "/audio/murph-voices/husky.mp3",
      },
      {
        elevenLabsVoiceId: "NNl6r8mD7vthiJatiJt1",
        gender: "male",
        id: "storyteller",
        label: "British storyteller",
        previewPath: "/audio/murph-voices/storyteller.mp3",
      },
      {
        elevenLabsVoiceId: "exsUS4vynmxd379XN4yO",
        gender: "female",
        id: "british-warm",
        label: "British, warm",
        previewPath: "/audio/murph-voices/british-warm.mp3",
      },
      {
        elevenLabsVoiceId: "BpjGufoPiobT79j2vtj4",
        gender: "female",
        id: "late-night",
        label: "Late night radio",
        previewPath: "/audio/murph-voices/late-night.mp3",
      },
      {
        elevenLabsVoiceId: "1SM7GgM6IMuvQlz2BwM3",
        gender: "male",
        id: "easygoing",
        label: "Easygoing",
        previewPath: "/audio/murph-voices/easygoing.mp3",
      },
      {
        elevenLabsVoiceId: "wo6udizrrtpIxWGp2qJk",
        gender: "male",
        id: "northern",
        label: "Eccentric northerner",
        previewPath: "/audio/murph-voices/northern.mp3",
      },
      {
        elevenLabsVoiceId: "gU0LNdkMOQCOrPrwtbee",
        gender: "male",
        id: "football-announcer",
        label: "Football announcer",
        previewPath: "/audio/murph-voices/football-announcer.mp3",
      },
      {
        elevenLabsVoiceId: "OZxMHsGaBmV5pjMIDIn0",
        gender: "female",
        id: "sweet",
        label: "Sweet and natural",
        previewPath: "/audio/murph-voices/sweet.mp3",
      },
      {
        elevenLabsVoiceId: "Z3R5wn05IrDiVCyEkUrK",
        gender: "female",
        id: "mysterious",
        label: "Mysterious",
        previewPath: "/audio/murph-voices/mysterious.mp3",
      },
      {
        elevenLabsVoiceId: "RILOU7YmBhvwJGDGjNmP",
        gender: "female",
        id: "narrator",
        label: "Audiobook narrator",
        previewPath: "/audio/murph-voices/narrator.mp3",
      },
      {
        elevenLabsVoiceId: "rCmVtv8cYU60uhlsOo1M",
        gender: "female",
        id: "expressive",
        label: "Warm and expressive",
        previewPath: "/audio/murph-voices/expressive.mp3",
      },
      {
        elevenLabsVoiceId: "uYXf8XasLslADfZ2MB4u",
        gender: "female",
        id: "bubbly",
        label: "Bubbly",
        previewPath: "/audio/murph-voices/bubbly.mp3",
      },
      {
        elevenLabsVoiceId: "aRlmTYIQo6Tlg5SlulGC",
        gender: "female",
        id: "smooth",
        label: "Smooth and sweet",
        previewPath: "/audio/murph-voices/smooth.mp3",
      },
    ]);
    expect(contracts.isAssistantVoiceOptionId("drill-sergeant")).toBe(true);
    expect(contracts.isAssistantVoiceOptionId("bright")).toBe(false);
    expect(contracts.defaultAssistantVoiceOptionId).toBe("upbeat");
    expect(contracts.resolveAssistantVoiceOptionElevenLabsVoiceId("classic")).toBeNull();
    expect(contracts.resolveAssistantVoiceOptionElevenLabsVoiceId("warm")).toBe(
      "EST9Ui6982FZPSi7gCHi",
    );
    // A retired roster id must fall back to the env voice rather than fail the
    // voice memo, so stale stored preferences stay harmless.
    expect(contracts.resolveAssistantVoiceOptionElevenLabsVoiceId("retired-voice")).toBeNull();
    // No stored preference resolves to the shared default voice instead of the
    // env fallback.
    expect(contracts.resolveAssistantVoiceOptionElevenLabsVoiceId(null)).toBe(
      "tnSpp4vdxKPjI9w0GnoV",
    );
    expect(contracts.resolveAssistantVoiceOptionElevenLabsVoiceId(undefined)).toBe(
      "tnSpp4vdxKPjI9w0GnoV",
    );
    expect(contracts.VAULT_LAYOUT.preferencesDocument).toBe("bank/preferences.json");
    expect(contracts.VAULT_LAYOUT.assistantPreferenceMutationStateDocument).toBe(
      "bank/assistant-preference-mutations.json",
    );
  });
});
