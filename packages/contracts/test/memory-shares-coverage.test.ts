import { describe, expect, it } from "vitest";

import { CONTRACT_SCHEMA_VERSION } from "../src/constants.ts";
import {
  createDefaultMemoryFrontmatter,
  createEmptyMemoryDocument,
  parseMemoryDocument,
  renderMemoryDocument,
  upsertMemoryRecord,
} from "../src/memory.ts";
import {
  goalUpsertPayloadSchema,
  protocolUpsertPayloadSchema,
  recipeUpsertPayloadSchema,
  sharePackSchema,
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
      docType: "murph.memory.v1",
      schemaVersion: 1,
      title: "Memory notes",
      updatedAt: "2026-04-08T02:05:00.000Z",
    });
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

  it("parses CRLF documents, ignores invalid metadata, and rejects invalid sections or blank memory text", () => {
    const validFrontmatter = createDefaultMemoryFrontmatter(
      new Date("2026-04-08T03:00:00.000Z"),
    );
    const malformedMetadataMarkdown = [
      "---",
      `docType: ${validFrontmatter.docType}`,
      `schemaVersion: ${validFrontmatter.schemaVersion}`,
      `title: ${validFrontmatter.title}`,
      `updatedAt: ${validFrontmatter.updatedAt}`,
      "---",
      "# Memory",
      "",
      "## Preferences",
      '-    Prefers    direct   answers    <!-- murph-memory:{"id":} -->',
    ].join("\r\n");

    const parsed = parseMemoryDocument({
      sourcePath: "vault/custom-memory.md",
      text: malformedMetadataMarkdown,
    });

    expect(parsed.records).toEqual([
      expect.objectContaining({
        section: "Preferences",
        text: "Prefers direct answers",
        createdAt: null,
        updatedAt: null,
        sourceLine: 4,
        sourcePath: "vault/custom-memory.md",
      }),
    ]);
    expect(parsed.records[0]?.id).toMatch(/^mem_[0-9a-f]{16}$/u);

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
          "## Unknown",
          "- should fail",
        ].join("\n"),
      }),
    ).toThrow('Unknown memory section "Unknown".');

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
      protocolUpsertPayloadSchema.parse({
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

  it("validates share-pack ref integrity for duplicates, attached protocols, and afterImport targets", () => {
    expect(
      sharePackSchema.parse({
        schemaVersion: CONTRACT_SCHEMA_VERSION.sharePack,
        title: "Breakfast pack",
        createdAt: "2026-04-08T04:00:00.000Z",
        entities: [
          {
            kind: "protocol",
            ref: "prot:vitamin-d",
            payload: {
              title: "Vitamin D",
            },
          },
          {
            kind: "food",
            ref: "food:yogurt",
            payload: {
              title: "Greek yogurt",
              attachedProtocolRefs: ["prot:vitamin-d"],
            },
          },
        ],
        afterImport: {
          logMeal: {
            foodRef: "food:yogurt",
            occurredAt: "2026-04-08T04:05:00.000Z",
          },
        },
      }),
    ).toMatchObject({
      afterImport: {
        logMeal: {
          foodRef: "food:yogurt",
          occurredAt: "2026-04-08T04:05:00.000Z",
        },
      },
    });

    expect(() =>
      sharePackSchema.parse({
        schemaVersion: CONTRACT_SCHEMA_VERSION.sharePack,
        title: "Broken pack",
        entities: [
          {
            kind: "food",
            ref: "food:duplicate",
            payload: {
              title: "Yogurt",
              attachedProtocolRefs: ["prot:missing"],
            },
          },
          {
            kind: "recipe",
            ref: "food:duplicate",
            payload: {
              title: "Parfait",
            },
          },
        ],
        afterImport: {
          logMeal: {
            foodRef: "food:duplicate",
          },
        },
      }),
    ).toThrow(/Duplicate share entity refs are not allowed: food:duplicate\./u);

    expect(() =>
      sharePackSchema.parse({
        schemaVersion: CONTRACT_SCHEMA_VERSION.sharePack,
        title: "Wrong targets",
        entities: [
          {
            kind: "recipe",
            ref: "recipe:breakfast",
            payload: {
              title: "Parfait",
            },
          },
          {
            kind: "food",
            ref: "food:yogurt",
            payload: {
              title: "Greek yogurt",
              attachedProtocolRefs: ["recipe:breakfast"],
            },
          },
        ],
        afterImport: {
          logMeal: {
            foodRef: "recipe:breakfast",
          },
        },
      }),
    ).toThrow(/must target protocol share entities|must target a food share entity/u);
  });
});
