import { describe, expect, it, vi } from "vitest";

import {
  AUTOMATION_SCHEMA_VERSION,
  automationScheduleSchema,
  automationTimeScheduleSchema,
  automationTriggerSchema,
  automationScaffoldPayloadSchema,
} from "../src/automation.ts";
import {
  collapseEventRevisions,
  compareEventRevisionPriority,
  eventRevisionFromLifecycle,
  hasInvalidEventLifecycle,
  parseEventLifecycle,
} from "../src/event-lifecycle.ts";
import { isContractId } from "../src/ids.ts";
import {
  buildMemoryPromptBlock,
  createEmptyMemoryDocument,
  createMemoryRecordId,
  forgetMemoryRecord,
  upsertMemoryRecord,
} from "../src/memory.ts";
import { foodUpsertPayloadSchema } from "../src/shares.ts";
import { eventRecordSchema } from "../src/zod.ts";

describe("automation contract seams", () => {
  it("uses the canonical Murph automation frontmatter schema", () => {
    expect(AUTOMATION_SCHEMA_VERSION).toBe("murph.frontmatter.automation.v1");
  });

  it("applies scaffold defaults while preserving parsed schedule and route fields", () => {
    const parsed = automationScaffoldPayloadSchema.parse({
      instructions: "Summarize the day",
      route: {
        channel: "email",
        deliveryTarget: "thread_123",
        identityId: null,
        participantId: null,
        threadId: null,
      },
      schedule: {
        kind: "dailyLocal",
        localTime: "08:30",
      },
      title: "Daily summary",
    });

    expect(parsed).toMatchObject({
      continuityPolicy: "preserve",
      instructions: "Summarize the day",
      route: {
        channel: "email",
        deliveryTarget: "thread_123",
      },
      schedule: {
        kind: "dailyLocal",
        localTime: "08:30",
      },
      status: "active",
      title: "Daily summary",
    });
  });

  it("rejects invalid recurring automation schedule time zones", () => {
    expect(() =>
      automationScheduleSchema.parse({
        expression: "0 8 * * *",
        kind: "cron",
        timeZone: "Mars/Olympus",
      }),
    ).toThrow(/Expected an IANA time zone/u);
  });

  it("rejects malformed cron expressions at the automation contract boundary", () => {
    expect(() =>
      automationScheduleSchema.parse({
        expression: "*/2/ignored 8 * * *",
        kind: "cron",
      }),
    ).toThrow(/Expected a five-field cron expression/u);
    expect(() =>
      automationScheduleSchema.parse({
        expression: "5junk 8 * * *",
        kind: "cron",
      }),
    ).toThrow(/Expected a five-field cron expression/u);
  });

  it("rejects sub-minute recurring automation intervals at the contract boundary", () => {
    expect(() =>
      automationScheduleSchema.parse({
        everyMs: 59_999,
        kind: "every",
      }),
    ).toThrow(/Too small/u);
  });

  it("accepts canonical recurring schedules with or without an explicit time zone", () => {
    expect(
      automationScheduleSchema.parse({
        everyMs: 60_000,
        kind: "every",
      }),
    ).toEqual({
      everyMs: 60_000,
      kind: "every",
    });

    expect(
      automationScheduleSchema.parse({
        expression: "0 8 * * *",
        kind: "cron",
        timeZone: "America/Chicago",
      }),
    ).toEqual({
      expression: "0 8 * * *",
      kind: "cron",
      timeZone: "America/Chicago",
    });

    expect(
      automationScheduleSchema.parse({
        kind: "dailyLocal",
        localTime: "08:30",
        timeZone: "UTC",
      }),
    ).toEqual({
      kind: "dailyLocal",
      localTime: "08:30",
      timeZone: "UTC",
    });

    expect(() =>
      automationScheduleSchema.parse({
        kind: "dailyLocal",
        localTime: "08:30",
        timeZone: "Invalid/Timezone",
      }),
    ).toThrow(/Expected an IANA time zone/u);
  });

  it("keeps device activity in the canonical trigger schema but out of time schedules", () => {
    const schedule = {
      activityKind: "basketball",
      after: "2026-06-07T12:00:00.000Z",
      kind: "deviceActivity",
      source: "whoop_v2",
    } as const;

    expect(automationScheduleSchema.parse(schedule)).toEqual(schedule);
    expect(automationTriggerSchema.parse(schedule)).toEqual(schedule);
    expect(() => automationTimeScheduleSchema.parse(schedule)).toThrow();

    expect(
      automationScheduleSchema.parse({
        activityKind: "sleep",
        after: "2026-06-07T12:00:00.000Z",
        kind: "deviceActivity",
      }),
    ).toEqual({
      activityKind: "sleep",
      after: "2026-06-07T12:00:00.000Z",
      kind: "deviceActivity",
    });
    expect(
      automationScheduleSchema.parse({
        activityKind: "surfing",
        after: "2026-06-07T12:00:00.000Z",
        kind: "deviceActivity",
      }),
    ).toEqual({
      activityKind: "surfing",
      after: "2026-06-07T12:00:00.000Z",
      kind: "deviceActivity",
    });
    expect(() =>
      automationScheduleSchema.parse({
        activityKind: "strength training",
        after: "2026-06-07T12:00:00.000Z",
        kind: "deviceActivity",
      }),
    ).toThrow(/lowercase kebab-case/u);
  });
});

describe("memory contract seams", () => {
  it("upserts records with canonical ids, preserves createdAt, and renders prompt sections in canonical order", () => {
    const createdAt = new Date("2026-04-08T00:00:00.000Z");
    const revisedAt = new Date("2026-04-08T00:05:00.000Z");
    const instructionsAt = new Date("2026-04-08T00:10:00.000Z");
    const baseDocument = createEmptyMemoryDocument(createdAt);

    const firstInsert = upsertMemoryRecord(baseDocument, {
      now: createdAt,
      section: "Context",
      text: "  Likes   concise  answers  ",
    });

    expect(firstInsert.created).toBe(true);
    expect(isContractId(firstInsert.record.id, "mem")).toBe(true);
    expect(isContractId(createMemoryRecordId({
      section: "Context",
      text: "Likes concise answers",
    }), "mem")).toBe(true);
    expect(firstInsert.record).toMatchObject({
      createdAt: "2026-04-08T00:00:00.000Z",
      section: "Context",
      sourceLine: 1,
      sourcePath: "bank/memory.md",
      text: "Likes concise answers",
      updatedAt: "2026-04-08T00:00:00.000Z",
    });

    const revisedInsert = upsertMemoryRecord(firstInsert.document, {
      now: revisedAt,
      recordId: firstInsert.record.id,
      section: "Identity",
      text: "Uses Murph daily",
    });

    expect(revisedInsert.created).toBe(false);
    expect(revisedInsert.record).toMatchObject({
      createdAt: "2026-04-08T00:00:00.000Z",
      id: firstInsert.record.id,
      section: "Identity",
      sourceLine: 1,
      sourcePath: "bank/memory.md",
      text: "Uses Murph daily",
      updatedAt: "2026-04-08T00:05:00.000Z",
    });

    const instructionsInsert = upsertMemoryRecord(revisedInsert.document, {
      now: instructionsAt,
      section: "Instructions",
      text: "Always mention the next step",
    });

    expect(instructionsInsert.document.frontmatter.updatedAt).toBe(
      "2026-04-08T00:10:00.000Z",
    );
    expect(instructionsInsert.document.records.map((record) => record.section)).toEqual([
      "Identity",
      "Instructions",
    ]);
    expect(buildMemoryPromptBlock(instructionsInsert.document)).toBe([
      "Memory lives in the canonical vault and is safe to rely on for durable user context.",
      "Memory:\nIdentity:\n- Uses Murph daily\n\nInstructions:\n- Always mention the next step",
    ].join("\n\n"));
  });

  it("forgets existing records with a deterministic timestamp and leaves missing ids unchanged", () => {
    vi.useFakeTimers();
    try {
      const document = upsertMemoryRecord(
        createEmptyMemoryDocument(new Date("2026-04-08T00:00:00.000Z")),
        {
          now: new Date("2026-04-08T00:00:00.000Z"),
          section: "Preferences",
          text: "Prefers direct answers",
        },
      ).document;

      vi.setSystemTime(new Date("2026-04-08T01:00:00.000Z"));
      const forgotten = forgetMemoryRecord(document, {
        recordId: document.records[0]?.id ?? "",
      });

      expect(forgotten.record?.text).toBe("Prefers direct answers");
      expect(forgotten.document.records).toEqual([]);
      expect(forgotten.document.frontmatter.updatedAt).toBe("2026-04-08T01:00:00.000Z");
      expect(buildMemoryPromptBlock(forgotten.document)).toBeNull();

      const missing = forgetMemoryRecord(forgotten.document, {
        recordId: "mem_missing",
      });

      expect(missing.record).toBeNull();
      expect(missing.document).toBe(forgotten.document);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("event lifecycle seams", () => {
  it("parses missing, valid, and invalid lifecycle values through the public helpers", () => {
    expect(parseEventLifecycle(undefined)).toEqual({ state: "missing" });
    expect(parseEventLifecycle(null)).toEqual({ state: "invalid" });
    expect(
      parseEventLifecycle({
        revision: 2,
        state: "deleted",
      }),
    ).toEqual({
      lifecycle: {
        revision: 2,
        state: "deleted",
      },
      state: "valid",
    });
    expect(parseEventLifecycle({ revision: 0 })).toEqual({ state: "invalid" });
    expect(parseEventLifecycle({ revision: 1, state: "archived" })).toEqual({
      state: "invalid",
    });
    expect(hasInvalidEventLifecycle({ revision: 0 })).toBe(true);
    expect(eventRevisionFromLifecycle({ revision: 0 })).toBe(1);
  });

  it("compares revision ties by recordedAt, occurredAt, and relativePath", () => {
    expect(
      compareEventRevisionPriority(
        {
          lifecycle: { revision: 3 },
          recordedAt: "2026-04-08T00:00:00.000Z",
        },
        {
          lifecycle: { revision: 2 },
          recordedAt: "2026-04-08T23:59:59.000Z",
        },
      ),
    ).toBeGreaterThan(0);

    expect(
      compareEventRevisionPriority(
        {
          lifecycle: { revision: 1 },
          recordedAt: "2026-04-08T00:00:00.000Z",
          occurredAt: "2026-04-08T00:02:00.000Z",
        },
        {
          lifecycle: { revision: 1 },
          recordedAt: "2026-04-08T00:00:00.000Z",
          occurredAt: "2026-04-08T00:01:00.000Z",
        },
      ),
    ).toBeGreaterThan(0);

    expect(
      compareEventRevisionPriority(
        {
          lifecycle: { revision: 1 },
          recordedAt: "2026-04-08T00:30:00+01:00",
        },
        {
          lifecycle: { revision: 1 },
          recordedAt: "2026-04-08T00:00:00.000Z",
        },
      ),
    ).toBeLessThan(0);

    expect(
      compareEventRevisionPriority(
        {
          lifecycle: { revision: 1 },
          recordedAt: "2026-04-08T00:00:00.000Z",
          occurredAt: "2026-04-08T00:00:00.000Z",
          relativePath: "ledger/events/z.jsonl",
        },
        {
          lifecycle: { revision: 1 },
          recordedAt: "2026-04-08T00:00:00.000Z",
          occurredAt: "2026-04-08T00:00:00.000Z",
          relativePath: "ledger/events/a.jsonl",
        },
      ),
    ).toBeGreaterThan(0);
  });

  it("collapses revisions, prefers the latest surviving record, and skips invalid lifecycle entries", () => {
    const collapsed = collapseEventRevisions(
      [
        {
          eventId: "evt-invalid",
          lifecycle: { revision: 0 },
          name: "invalid revision",
          occurredAt: "2026-04-08T00:00:00.000Z",
          recordedAt: "2026-04-08T00:00:00.000Z",
          relativePath: "ledger/events/invalid.jsonl",
        },
        {
          eventId: "evt-keep",
          lifecycle: { revision: 1 },
          name: "older revision",
          occurredAt: "2026-04-08T00:00:00.000Z",
          recordedAt: "2026-04-08T00:00:00.000Z",
          relativePath: "ledger/events/keep-1.jsonl",
        },
        {
          eventId: "evt-keep",
          lifecycle: { revision: 2 },
          name: "latest revision",
          occurredAt: "2026-04-08T00:01:00.000Z",
          recordedAt: "2026-04-08T00:01:00.000Z",
          relativePath: "ledger/events/keep-2.jsonl",
        },
        {
          eventId: "evt-tie",
          lifecycle: undefined,
          name: "earlier recordedAt",
          occurredAt: "2026-04-08T00:00:00.000Z",
          recordedAt: "2026-04-08T00:00:00.000Z",
          relativePath: "ledger/events/tie-a.jsonl",
        },
        {
          eventId: "evt-tie",
          lifecycle: undefined,
          name: "later recordedAt",
          occurredAt: "2026-04-08T00:00:00.000Z",
          recordedAt: "2026-04-08T00:02:00.000Z",
          relativePath: "ledger/events/tie-b.jsonl",
        },
        {
          eventId: "evt-delete",
          lifecycle: { revision: 1 },
          name: "before delete",
          occurredAt: "2026-04-08T00:00:00.000Z",
          recordedAt: "2026-04-08T00:00:00.000Z",
          relativePath: "ledger/events/delete-1.jsonl",
        },
        {
          eventId: "evt-delete",
          lifecycle: { revision: 2, state: "deleted" },
          name: "deleted revision",
          occurredAt: "2026-04-08T00:03:00.000Z",
          recordedAt: "2026-04-08T00:03:00.000Z",
          relativePath: "ledger/events/delete-2.jsonl",
        },
      ],
      (value) => value,
    );

    expect(collapsed).toEqual([
      {
        eventId: "evt-keep",
        lifecycle: { revision: 2 },
        name: "latest revision",
        occurredAt: "2026-04-08T00:01:00.000Z",
        recordedAt: "2026-04-08T00:01:00.000Z",
        relativePath: "ledger/events/keep-2.jsonl",
      },
      {
        eventId: "evt-tie",
        lifecycle: undefined,
        name: "later recordedAt",
        occurredAt: "2026-04-08T00:00:00.000Z",
        recordedAt: "2026-04-08T00:02:00.000Z",
        relativePath: "ledger/events/tie-b.jsonl",
      },
    ]);
  });

  it("skips blank event ids during collapse", () => {
    expect(
      collapseEventRevisions(
        [
          {
            eventId: "   ",
            lifecycle: { revision: 1 },
            value: "ignored",
          },
        ],
        (value) => value,
      ),
    ).toEqual([]);
  });
});

describe("shares schema seam", () => {
  it("applies the food payload default status", () => {
    expect(
      foodUpsertPayloadSchema.parse({
        title: "Greek yogurt",
      }),
    ).toMatchObject({
      status: "active",
      title: "Greek yogurt",
    });
  });

  it("accepts optional nutrition on food payloads and meal events", () => {
    expect(
      foodUpsertPayloadSchema.parse({
        title: "Greek yogurt",
        nutrition: {
          perServing: {
            calories: 160,
            proteinGrams: 15,
            carbsGrams: 9,
            fatGrams: 5,
          },
          provenance: {
            source: "label",
            confidence: "high",
            sourceDetail: "Container label",
          },
        },
      }),
    ).toMatchObject({
      nutrition: {
        perServing: {
          calories: 160,
          proteinGrams: 15,
          carbsGrams: 9,
          fatGrams: 5,
        },
        provenance: {
          source: "label",
          confidence: "high",
          sourceDetail: "Container label",
        },
      },
    });

    expect(
      eventRecordSchema.parse({
        schemaVersion: "murph.event.v1",
        id: "evt_01JQ1A0M6R6ZXQX3C2D8K6YV0A",
        kind: "meal",
        occurredAt: "2026-04-13T12:00:00Z",
        recordedAt: "2026-04-13T12:01:00Z",
        dayKey: "2026-04-13",
        source: "manual",
        title: "Lunch",
        mealId: "meal_01JQ1A0M6R6ZXQX3C2D8K6YV0B",
        nutrition: {
          totals: {
            calories: 620,
            proteinGrams: 40,
            carbsGrams: 55,
            fatGrams: 25,
            fiberGrams: 8,
          },
          provenance: {
            source: "estimated",
            confidence: "medium",
            sourceDetail: "Estimated from note",
          },
        },
      }),
    ).toMatchObject({
      kind: "meal",
      nutrition: {
        totals: {
          calories: 620,
          proteinGrams: 40,
          carbsGrams: 55,
          fatGrams: 25,
          fiberGrams: 8,
        },
        provenance: {
          source: "estimated",
          confidence: "medium",
          sourceDetail: "Estimated from note",
        },
      },
    });
  });
});
