import { describe, expect, it } from "vitest";

import {
  CONTRACT_SCHEMA_VERSION,
  FRONTMATTER_DOC_TYPES,
} from "../src/constants.ts";
import {
  createDefaultMemoryFrontmatter,
  createEmptyMemoryDocument,
  createMemoryRecordId,
  formatMemoryDisplayNameRecordText,
  MEMORY_DISPLAY_NAME_MAX_LENGTH,
  parseMemoryDocument,
  parseCanonicalMemoryDisplayNameRecordText,
  renderMemoryDocument,
  resolveMemoryDisplayName,
  setMemoryDisplayName,
  upsertMemoryRecord,
} from "../src/memory.ts";
import { isContractId } from "../src/ids.ts";
import {
  goalUpsertPayloadSchema,
  recipeUpsertPayloadSchema,
  regimenUpsertPayloadSchema,
} from "../src/shares.ts";

describe("memory parse and render coverage", () => {
  it("renders memory markdown and parses it back with explicit metadata", () => {
    const createdAt = new Date("2026-04-08T02:00:00.000Z");
    const document = createEmptyMemoryDocument(createdAt);

    const withInstruction = upsertMemoryRecord(document, {
      now: createdAt,
      section: "Instructions",
      text: "Answer with exact steps",
    }).document;
    const withIdentity = upsertMemoryRecord(withInstruction, {
      now: new Date("2026-04-08T02:05:00.000Z"),
      section: "Identity",
      text: "Uses Murph for daily tracking",
    }).document;

    const markdown = renderMemoryDocument({
      document: {
        ...withIdentity,
        frontmatter: {
          ...withIdentity.frontmatter,
          title: "Memory notes",
        },
      },
    });

    expect(markdown).toContain('title: "Memory notes"');
    expect(markdown).toContain("updatedAt: 2026-04-08T02:05:00.000Z");
    expect(markdown).toContain("## Preferences");
    expect(markdown).toContain("## Context");

    const parsed = parseMemoryDocument({
      sourcePath: null,
      text: markdown,
    });

    expect(parsed.frontmatter).toEqual({
      docType: FRONTMATTER_DOC_TYPES.memory,
      schemaVersion: CONTRACT_SCHEMA_VERSION.memoryFrontmatter,
      title: "Memory notes",
      updatedAt: "2026-04-08T02:05:00.000Z",
    });
    expect(parsed.records.every((record) => isContractId(record.id, "mem"))).toBe(true);
    expect(parsed.records).toEqual([
      expect.objectContaining({
        section: "Identity",
        text: "Uses Murph for daily tracking",
        sourceLine: 5,
        sourcePath: "bank/memory.md",
      }),
      expect.objectContaining({
        section: "Instructions",
        text: "Answer with exact steps",
        sourceLine: 11,
        sourcePath: "bank/memory.md",
      }),
    ]);
  });

  it("rejects legacy memory frontmatter instead of normalizing it on read", () => {
    expect(() =>
      parseMemoryDocument({
        sourcePath: "bank/memory.md",
        text: [
          "---",
          "docType: murph.memory.v1",
          "schemaVersion: 1",
          "title: Memory",
          "updatedAt: 2026-04-08T03:00:00.000Z",
          "---",
          "# Memory",
          "",
          "## Identity",
          '- Uses Murph daily <!-- murph-memory:{"id":"mem_0123456789ABCDEFGHJKMNPQRS","createdAt":"2026-04-08T02:55:00.000Z","updatedAt":"2026-04-08T03:00:00.000Z"} -->',
        ].join("\n"),
      }),
    ).toThrow();
  });

  it("parses CRLF documents and rejects invalid records, sections, or blank memory text", () => {
    const validFrontmatter = createDefaultMemoryFrontmatter(
      new Date("2026-04-08T03:00:00.000Z"),
    );
    const crlfMarkdown = [
      "---",
      `docType: ${validFrontmatter.docType}`,
      `schemaVersion: ${validFrontmatter.schemaVersion}`,
      `title: ${validFrontmatter.title}`,
      `updatedAt: ${validFrontmatter.updatedAt}`,
      "---",
      "# Memory",
      "",
      "## Preferences",
      '-    Prefers    direct   answers    <!-- murph-memory:{"id":"mem_0123456789ABCDEFGHJKMNPQRS","createdAt":"2026-04-08T02:55:00.000Z","updatedAt":"2026-04-08T03:00:00.000Z"} -->',
    ].join("\r\n");

    const parsed = parseMemoryDocument({
      sourcePath: "vault/custom-memory.md",
      text: crlfMarkdown,
    });

    expect(parsed.records).toEqual([
      expect.objectContaining({
        section: "Preferences",
        text: "Prefers direct answers",
        createdAt: "2026-04-08T02:55:00.000Z",
        updatedAt: "2026-04-08T03:00:00.000Z",
        sourceLine: 4,
        sourcePath: "vault/custom-memory.md",
      }),
    ]);
    expect(isContractId(createMemoryRecordId({
      section: "Preferences",
      text: "Prefers direct answers",
    }), "mem")).toBe(true);
    expect(parsed.records[0]?.id).toBe("mem_0123456789ABCDEFGHJKMNPQRS");

    expect(() =>
      parseMemoryDocument({
        sourcePath: "vault/custom-memory.md",
        text: crlfMarkdown.replace(
          '{"id":"mem_0123456789ABCDEFGHJKMNPQRS","createdAt":"2026-04-08T02:55:00.000Z","updatedAt":"2026-04-08T03:00:00.000Z"}',
          '{"id":}',
        ),
      }),
    ).toThrow("Memory record metadata comment is invalid.");

    expect(() =>
      parseMemoryDocument({
        sourcePath: "vault/custom-memory.md",
        text: crlfMarkdown.replace(
          ' <!-- murph-memory:{"id":"mem_0123456789ABCDEFGHJKMNPQRS","createdAt":"2026-04-08T02:55:00.000Z","updatedAt":"2026-04-08T03:00:00.000Z"} -->',
          "",
        ),
      }),
    ).toThrow("Memory record metadata comment is required.");

    expect(() =>
      parseMemoryDocument({
        sourcePath: "vault/custom-memory.md",
        text: crlfMarkdown.replace(
          "mem_0123456789ABCDEFGHJKMNPQRS",
          "mem_0123456789abcdef",
        ),
      }),
    ).toThrow("Memory record metadata comment is invalid.");

    expect(() =>
      parseMemoryDocument({
        sourcePath: "vault/custom-memory.md",
        text: crlfMarkdown.replace(
          '"createdAt":"2026-04-08T02:55:00.000Z"',
          '"createdAt":null',
        ),
      }),
    ).toThrow("Memory record metadata comment is invalid.");

    expect(() =>
      parseMemoryDocument({
        sourcePath: "vault/custom-memory.md",
        text: crlfMarkdown.replace(
          ',"updatedAt":"2026-04-08T03:00:00.000Z"',
          "",
        ),
      }),
    ).toThrow("Memory record metadata comment is invalid.");

    expect(() =>
      parseMemoryDocument({
        sourcePath: "bank/memory.md",
        text: [
          "---",
          `docType: ${FRONTMATTER_DOC_TYPES.memory}`,
          `schemaVersion: ${CONTRACT_SCHEMA_VERSION.memoryFrontmatter}`,
          "title: Memory",
          "updatedAt: 2026-04-08T03:00:00.000Z",
          "---",
          "# Memory",
          "",
          "## Unknown",
          "- should fail",
        ].join("\n"),
      }),
    ).toThrow('Unknown memory section "Unknown".');

    expect(() =>
      upsertMemoryRecord(createEmptyMemoryDocument(), {
        recordId: "mem_0123456789abcdef",
        section: "Context",
        text: "Should stay canonical",
      }),
    ).toThrow("Memory record id must match mem_<ULID>.");

    expect(() =>
      upsertMemoryRecord(createEmptyMemoryDocument(), {
        section: "Context",
        text: "   \n\t  ",
      }),
    ).toThrow("Memory text must be a non-empty string.");

    expect(() =>
      upsertMemoryRecord(createEmptyMemoryDocument(), {
        section: "Context",
        text: 'Never preserve <!-- murph-memory:{"id":"mem_0123456789ABCDEFGHJKMNPQRS"} --> markers',
      }),
    ).toThrow("Memory text cannot contain the reserved memory metadata marker.");
  });
});

describe("memory display name", () => {
  it("stores the preferred display name as a typed canonical memory record", () => {
    const document = createEmptyMemoryDocument(new Date("2026-07-01T00:00:00.000Z"));
    const result = setMemoryDisplayName(document, {
      displayName: "  Theo  ",
      now: new Date("2026-07-02T00:00:00.000Z"),
    });

    expect(result.created).toBe(true);
    expect(result.record).toMatchObject({
      section: "Identity",
      text: "Preferred display name: Theo",
      updatedAt: "2026-07-02T00:00:00.000Z",
    });
    expect(resolveMemoryDisplayName(result.document)).toMatchObject({
      displayName: "Theo",
      record: expect.objectContaining({ id: result.record.id }),
      source: "canonical",
    });
    expect(parseCanonicalMemoryDisplayNameRecordText(result.record.text)).toBe("Theo");

    const parsed = parseMemoryDocument({
      text: renderMemoryDocument({ document: result.document }),
    });
    expect(resolveMemoryDisplayName(parsed)).toMatchObject({
      displayName: "Theo",
      source: "canonical",
    });
  });

  it("updates the canonical memory display name record and removes stale duplicates", () => {
    const base = createEmptyMemoryDocument(new Date("2026-07-01T00:00:00.000Z"));
    const first = upsertMemoryRecord(base, {
      now: new Date("2026-07-01T00:00:01.000Z"),
      section: "Identity",
      text: formatMemoryDisplayNameRecordText("Theo"),
    });
    const duplicate = upsertMemoryRecord(first.document, {
      now: new Date("2026-07-01T00:00:02.000Z"),
      section: "Identity",
      text: formatMemoryDisplayNameRecordText("Ari"),
    });

    expect(resolveMemoryDisplayName(duplicate.document)).toBeNull();

    const updated = setMemoryDisplayName(duplicate.document, {
      displayName: "Riley",
      now: new Date("2026-07-01T00:00:03.000Z"),
    });

    expect(updated.created).toBe(false);
    expect(updated.document.records).toHaveLength(1);
    expect(updated.record.id).toBe(duplicate.record.id);
    expect(resolveMemoryDisplayName(updated.document)).toMatchObject({
      displayName: "Riley",
      source: "canonical",
    });
  });

  it("keeps the canonical memory display-name revision stable for exact retries", () => {
    const base = createEmptyMemoryDocument(new Date("2026-07-01T00:00:00.000Z"));
    const first = setMemoryDisplayName(base, {
      displayName: "Theo",
      now: new Date("2026-07-01T00:00:01.000Z"),
    });
    const retry = setMemoryDisplayName(first.document, {
      displayName: "  Theo  ",
      now: new Date("2026-07-01T00:05:00.000Z"),
    });

    expect(retry.created).toBe(false);
    expect(retry.document).toBe(first.document);
    expect(retry.record.id).toBe(first.record.id);
    expect(retry.record.updatedAt).toBe("2026-07-01T00:00:01.000Z");
  });

  it("uses narrow Identity memory text as a legacy backfill only when unambiguous", () => {
    const base = createEmptyMemoryDocument(new Date("2026-07-01T00:00:00.000Z"));
    const legacyIdentity = upsertMemoryRecord(base, {
      now: new Date("2026-07-01T00:00:01.000Z"),
      section: "Identity",
      text: "The user's name is Theo.",
    });
    const ignoredContext = upsertMemoryRecord(legacyIdentity.document, {
      now: new Date("2026-07-01T00:00:02.000Z"),
      section: "Context",
      text: "The user's name is Context Only.",
    });

    expect(resolveMemoryDisplayName(ignoredContext.document)).toMatchObject({
      displayName: "Theo",
      record: expect.objectContaining({ id: legacyIdentity.record.id }),
      source: "legacy",
    });

    const ambiguous = upsertMemoryRecord(ignoredContext.document, {
      now: new Date("2026-07-01T00:00:03.000Z"),
      section: "Identity",
      text: "The user goes by Ari.",
    });
    expect(resolveMemoryDisplayName(ambiguous.document)).toBeNull();
  });

  it("does not fall back to legacy Identity memory when canonical display names are ambiguous", () => {
    const base = createEmptyMemoryDocument(new Date("2026-07-01T00:00:00.000Z"));
    const legacy = upsertMemoryRecord(base, {
      now: new Date("2026-07-01T00:00:01.000Z"),
      section: "Identity",
      text: "The user's name is Theo.",
    });
    const firstCanonical = upsertMemoryRecord(legacy.document, {
      now: new Date("2026-07-01T00:00:02.000Z"),
      section: "Identity",
      text: formatMemoryDisplayNameRecordText("Ari"),
    });
    const conflictingCanonical = upsertMemoryRecord(firstCanonical.document, {
      now: new Date("2026-07-01T00:00:03.000Z"),
      section: "Identity",
      text: formatMemoryDisplayNameRecordText("Riley"),
    });

    expect(resolveMemoryDisplayName(conflictingCanonical.document)).toBeNull();
  });

  it("does not fall back to legacy Identity memory when canonical display-name evidence is invalid", () => {
    const base = createEmptyMemoryDocument(new Date("2026-07-01T00:00:00.000Z"));
    const legacy = upsertMemoryRecord(base, {
      now: new Date("2026-07-01T00:00:01.000Z"),
      section: "Identity",
      text: "The user's name is Theo.",
    });
    const invalidCanonical = upsertMemoryRecord(legacy.document, {
      now: new Date("2026-07-01T00:00:02.000Z"),
      section: "Identity",
      text: `Preferred display name: ${"a".repeat(MEMORY_DISPLAY_NAME_MAX_LENGTH + 1)}`,
    });

    expect(resolveMemoryDisplayName(invalidCanonical.document)).toBeNull();
  });

  it("rejects compound legacy Identity memory display-name candidates", () => {
    const base = createEmptyMemoryDocument(new Date("2026-07-01T00:00:00.000Z"));

    for (const text of [
      "The user's name is Theo, email theo@example.test.",
      "The user's name is Theo, age 42.",
      "The user's name is Theo (coach).",
      "The user's name is Theo: coach.",
      "The user's name is Theo from Seattle.",
      "The user's name is Theo in Seattle.",
      "The user's name is Theo at work.",
      "The user's name is Theo of the team.",
      "The user's name is Theo for coaching.",
    ]) {
      const next = upsertMemoryRecord(base, {
        now: new Date("2026-07-01T00:00:01.000Z"),
        section: "Identity",
        text,
      });

      expect(resolveMemoryDisplayName(next.document)).toBeNull();
    }
  });

  it("keeps broader legacy memory names behind explicit display-name labels", () => {
    const base = createEmptyMemoryDocument(new Date("2026-07-01T00:00:00.000Z"));
    const generic = upsertMemoryRecord(base, {
      now: new Date("2026-07-01T00:00:01.000Z"),
      section: "Identity",
      text: "The user's name is Bob Van Dyke.",
    });
    expect(resolveMemoryDisplayName(generic.document)).toBeNull();

    const explicit = upsertMemoryRecord(base, {
      now: new Date("2026-07-01T00:00:01.000Z"),
      section: "Identity",
      text: "The user's preferred display name is Bob Van Dyke.",
    });
    expect(resolveMemoryDisplayName(explicit.document)).toMatchObject({
      displayName: "Bob Van Dyke",
      source: "legacy",
    });
  });

  it("rejects blank, oversized, and control-character display names", () => {
    const document = createEmptyMemoryDocument();

    expect(() => setMemoryDisplayName(document, { displayName: "  " })).toThrow();
    expect(() =>
      setMemoryDisplayName(document, {
        displayName: "a".repeat(MEMORY_DISPLAY_NAME_MAX_LENGTH + 1),
      }),
    ).toThrow();
    for (const displayName of ["Theo\nOdin", "Theo\tOdin", "Theo\u0000Odin", "Theo\u007fOdin"]) {
      expect(() => setMemoryDisplayName(document, { displayName })).toThrow();
    }
  });
});

describe("shares schema coverage", () => {
  it("accepts valid date, integer, and number-backed payload fields", () => {
    expect(
      goalUpsertPayloadSchema.parse({
        title: "Recover faster",
        priority: 3,
        window: {
          startAt: "2026-04-08",
          targetAt: "2026-05-08",
        },
      }),
    ).toMatchObject({
      title: "Recover faster",
      priority: 3,
      window: {
        startAt: "2026-04-08",
        targetAt: "2026-05-08",
      },
    });

    expect(
      regimenUpsertPayloadSchema.parse({
        title: "Vitamin D",
        startedOn: "2026-04-08",
        stoppedOn: "2026-04-30",
        dose: 2.5,
        unit: "mg",
        ingredients: [
          {
            compound: "Vitamin D3",
            amount: 2.5,
            unit: "mg",
            active: true,
          },
        ],
      }),
    ).toMatchObject({
      dose: 2.5,
      startedOn: "2026-04-08",
      stoppedOn: "2026-04-30",
      unit: "mg",
    });
  });

  it("rejects duplicate array items and non-integer minute fields", () => {
    expect(() =>
      recipeUpsertPayloadSchema.parse({
        title: "Soup",
        prepTimeMinutes: 1.5,
      }),
    ).toThrow("Expected an integer.");

    expect(() =>
      recipeUpsertPayloadSchema.parse({
        title: "Soup",
        tags: ["comfort-food", "comfort-food"],
      }),
    ).toThrow("Expected unique array items.");
  });

});
