import { describe, expect, it, vi } from "vitest";

import {
  automationScheduleSchema,
  automationScaffoldPayloadSchema,
} from "../src/automation.ts";
import {
  collapseEventRevisions,
  compareEventRevisionPriority,
  eventRevisionFromLifecycle,
  hasInvalidEventLifecycle,
  parseEventLifecycle,
} from "../src/event-lifecycle.ts";
import {
  buildMemoryPromptBlock,
  createEmptyMemoryDocument,
  createMemoryRecordId,
  forgetMemoryRecord,
  upsertMemoryRecord,
} from "../src/memory.ts";
import { foodUpsertPayloadSchema } from "../src/shares.ts";

describe("automation contract seams", () => {
  it("applies scaffold defaults while preserving parsed schedule and route fields", () => {
    const parsed = automationScaffoldPayloadSchema.parse({
      prompt: "Summarize the day",
      route: {
        channel: "email",
        deliverResponse: true,
        deliveryTarget: "thread_123",
        identityId: null,
        participantId: null,
        sourceThreadId: null,
      },
      schedule: {
        kind: "dailyLocal",
        localTime: "08:30",
        timeZone: "UTC",
      },
      title: "Daily summary",
    });

    expect(parsed).toMatchObject({
      continuityPolicy: "preserve",
      prompt: "Summarize the day",
      route: {
        channel: "email",
        deliverResponse: true,
        deliveryTarget: "thread_123",
      },
      schedule: {
        kind: "dailyLocal",
        localTime: "08:30",
        timeZone: "UTC",
      },
      status: "active",
      title: "Daily summary",
    });
  });

  it("rejects invalid automation time zones during schedule parsing", () => {
    expect(() =>
      automationScheduleSchema.parse({
        expression: "0 8 * * *",
        kind: "cron",
        timeZone: "Mars/Olympus",
      }),
    ).toThrow(/IANA timezone/u);
  });
});

describe("memory contract seams", () => {
  it("upserts records deterministically, preserves createdAt, and renders prompt sections in canonical order", () => {
    const createdAt = new Date("2026-04-08T00:00:00.000Z");
    const revisedAt = new Date("2026-04-08T00:05:00.000Z");
    const instructionsAt = new Date("2026-04-08T00:10:00.000Z");
    const baseDocument = createEmptyMemoryDocument(createdAt);

    const firstInsert = upsertMemoryRecord(baseDocument, {
      now: createdAt,
      section: "Context",
      text: "  Likes   concise  answers  ",
    });
    const expectedFirstRecordId = createMemoryRecordId({
      section: "Context",
      text: "Likes concise answers",
    });

    expect(firstInsert.created).toBe(true);
    expect(firstInsert.record).toMatchObject({
      createdAt: "2026-04-08T00:00:00.000Z",
      id: expectedFirstRecordId,
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
      id: expectedFirstRecordId,
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
});
