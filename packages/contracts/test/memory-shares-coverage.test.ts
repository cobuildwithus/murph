import { describe, expect, it } from "vitest";

import {
  CONTRACT_SCHEMA_VERSION,
  FRONTMATTER_DOC_TYPES,
} from "../src/constants.ts";
import {
  createDefaultMemoryFrontmatter,
  createEmptyMemoryDocument,
  createMemoryRecordId,
  parseMemoryDocument,
  renderMemoryDocument,
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
