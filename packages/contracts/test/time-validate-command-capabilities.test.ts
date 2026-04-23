import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  commandAliasDefinitions,
  commandCapabilityBundles,
  commandNounCapabilityByNoun,
  commandNounCapabilities,
  frozenHealthCommandNouns,
} from "../src/command-capabilities.ts";
import {
  addDaysToIsoDate,
  extractIsoDatePrefix,
  formatTimeZoneDateTimeParts,
  isStrictIsoDateTime,
  isValidIanaTimeZone,
  isStrictIsoDate,
  normalizeIanaTimeZone,
  normalizeStrictIsoTimestamp,
  parseDailyTime,
  toLocalDayKey,
} from "../src/time.ts";
import { assertContract, formatContractIssues, safeParseContract } from "../src/validate.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../../..");

function extractSection(documentText: string, startMarker: string, endMarker: string): string {
  const startIndex = documentText.indexOf(startMarker);
  const endIndex = documentText.indexOf(endMarker, startIndex + startMarker.length);

  if (startIndex === -1 || endIndex === -1) {
    throw new Error(`Could not extract section between "${startMarker}" and "${endMarker}".`);
  }

  return documentText.slice(startIndex + startMarker.length, endIndex);
}

function toDocName(noun: string): string {
  return noun.replaceAll("_", "-");
}

describe("time helpers", () => {
  it("validates and normalizes strict ISO date values", () => {
    expect(isStrictIsoDate("2024-02-29")).toBe(true);
    expect(isStrictIsoDate("2024-02-30")).toBe(false);
    expect(isStrictIsoDateTime("2024-02-29T23:59:59.999Z")).toBe(true);
    expect(isStrictIsoDateTime("2024-02-30T00:00:00.000Z")).toBe(false);
    expect(isStrictIsoDateTime("2024-01-01T00:00:00+24:00")).toBe(false);
    expect(normalizeStrictIsoTimestamp("2024-02-29")).toBe(
      "2024-02-29T00:00:00.000Z",
    );
    expect(normalizeStrictIsoTimestamp(new Date("2024-02-29T12:34:56.789Z"))).toBe(
      "2024-02-29T12:34:56.789Z",
    );
    expect(normalizeStrictIsoTimestamp(Date.parse("2024-02-29T12:34:56.789Z"))).toBe(
      "2024-02-29T12:34:56.789Z",
    );
    expect(normalizeStrictIsoTimestamp("not-a-date")).toBeNull();
    expect(normalizeStrictIsoTimestamp(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeStrictIsoTimestamp(new Date(Number.NaN))).toBeNull();
  });

  it("parses daily times and formats timezone parts deterministically", () => {
    expect(parseDailyTime("07:45")).toEqual({ hour: 7, minute: 45 });
    expect(parseDailyTime("24:00")).toBeNull();
    expect(normalizeIanaTimeZone("UTC")).toBe("UTC");
    expect(normalizeIanaTimeZone("")).toBeNull();
    expect(normalizeIanaTimeZone(null)).toBeNull();
    expect(isValidIanaTimeZone("UTC")).toBe(true);
    expect(isValidIanaTimeZone("Mars/Olympus")).toBe(false);
    expect(extractIsoDatePrefix(" 2026-03-11T19:00:00.000Z ")).toBe("2026-03-11");
    expect(extractIsoDatePrefix(null)).toBeNull();

    expect(
      formatTimeZoneDateTimeParts("2026-03-11T19:00:00.000Z", "UTC"),
    ).toEqual({
      year: 2026,
      month: 3,
      day: 11,
      hour: 19,
      minute: 0,
      second: 0,
      dayOfWeek: 3,
      dayKey: "2026-03-11",
    });
    expect(toLocalDayKey("2026-03-11", "America/New_York")).toBe("2026-03-11");
    expect(toLocalDayKey("2026-03-11T19:00:00.000Z", "UTC")).toBe("2026-03-11");
    expect(() => formatTimeZoneDateTimeParts("2026-03-11T19:00:00.000Z", "Mars/Olympus")).toThrow(
      "Invalid IANA time zone",
    );
    expect(() => formatTimeZoneDateTimeParts("not-a-date", "UTC")).toThrow(
      "Invalid ISO date-time",
    );
  });

  it("adds days across month boundaries", () => {
    expect(addDaysToIsoDate("2024-02-28", 2)).toBe("2024-03-01");
    expect(() => addDaysToIsoDate("not-a-date", 1)).toThrow("Invalid ISO date: not-a-date");
  });
});

describe("contract validation helpers", () => {
  it("returns flattened issues for invalid values", () => {
    const result = safeParseContract(
      z.object({
        nested: z.object({
          count: z.number(),
        }),
      }),
      {
        nested: {
          count: "oops",
        },
      },
    );

    expect(result).toEqual({
      success: false,
      errors: [
        "$.nested.count: Invalid input: expected number, received string",
      ],
    });
  });

  it("formats union issues and indexed paths", () => {
    const result = safeParseContract(
      z.object({
        value: z.union([
          z.object({
            count: z.number(),
          }),
          z.array(z.string().min(2)),
        ]),
      }),
      {
        value: ["x"],
      },
    );

    expect(result).toEqual({
      success: false,
      errors: ["$.value[0]: Too small: expected string to have >=2 characters"],
    });
    expect(
      formatContractIssues(
        new z.ZodError([
          {
            code: "custom",
            message: "root problem",
            path: [],
          },
        ]),
      ),
    ).toEqual(["$: root problem"]);
  });

  it("throws with a labeled error when assertContract fails", () => {
    expect(() =>
      assertContract(
        z.object({
          name: z.string().min(1),
        }),
        {
          name: "",
        },
        "payload",
      ),
    ).toThrowError("payload failed validation:");
  });

  it("returns parsed data when assertion succeeds", () => {
    expect(
      assertContract(
        z.object({
          name: z.string().min(1),
        }),
        {
          name: "Murph",
        },
      ),
    ).toEqual({
      name: "Murph",
    });
  });
});

describe("command capability definitions", () => {
  it("keeps the shared bundle and noun map aligned", () => {
    expect(commandCapabilityBundles.payloadCrud.capabilities).toEqual([
      "scaffold",
      "upsert",
      "show",
      "list",
    ]);
    expect(commandCapabilityBundles.runtimeControl.docSurface).toBe(
      "bootstrap | setup | doctor | parse | requeue | attachment list/inspect/show/status/show-status/decode/parse/reparse | promote | model bundle/route",
    );
    expect(commandCapabilityBundles.deviceControl.capabilities).toEqual([
      "provider-list",
      "connect",
      "account-list",
      "account-show",
      "account-reconcile",
      "account-disconnect",
      "daemon-status",
      "daemon-start",
      "daemon-stop",
    ]);
    expect(commandNounCapabilityByNoun.get("food")).toEqual({
      noun: "food",
      bundles: ["payloadCrud"],
      capabilities: ["scaffold", "upsert", "rename", "schedule", "unschedule", "show", "list"],
      additionalCapabilities: ["rename", "schedule", "unschedule"],
    });
    expect(commandNounCapabilityByNoun.get("vault")).toEqual({
      noun: "vault",
      bundles: ["readable", "derivedAdmin"],
      capabilities: ["show", "stats", "repair", "update"],
      additionalCapabilities: ["stats", "repair", "update"],
    });
    expect(commandNounCapabilityByNoun.get("assistant")).toEqual({
      noun: "assistant",
      bundles: [],
      capabilities: [
        "ask",
        "chat",
        "deliver",
        "status",
        "doctor",
        "run",
        "stop",
        "session-list",
        "session-show",
      ],
      additionalCapabilities: [
        "ask",
        "chat",
        "deliver",
        "status",
        "doctor",
        "run",
        "stop",
        "session-list",
        "session-show",
      ],
    });
    expect(commandNounCapabilityByNoun.get("device")).toEqual({
      noun: "device",
      bundles: ["deviceControl"],
      capabilities: [
        "provider-list",
        "connect",
        "account-list",
        "account-show",
        "account-reconcile",
        "account-disconnect",
        "daemon-status",
        "daemon-start",
        "daemon-stop",
      ],
    });
    expect(commandNounCapabilities.map((entry) => String(entry.noun))).not.toContain("history");
    expect(commandNounCapabilityByNoun.get("blood_test")).toEqual({
      noun: "blood_test",
      bundles: ["payloadCrud"],
      capabilities: ["scaffold", "upsert", "show", "list"],
    });
    expect(commandAliasDefinitions).toEqual([
      {
        alias: "chat",
        capability: "chat",
        targetCommand: "assistant chat",
        targetNoun: "assistant",
      },
      {
        alias: "status",
        capability: "status",
        targetCommand: "assistant status",
        targetNoun: "assistant",
      },
      {
        alias: "doctor",
        capability: "doctor",
        targetCommand: "assistant doctor",
        targetNoun: "assistant",
      },
      {
        alias: "run",
        capability: "run",
        targetCommand: "assistant run",
        targetNoun: "assistant",
      },
      {
        alias: "stop",
        capability: "stop",
        targetCommand: "assistant stop",
        targetNoun: "assistant",
      },
    ]);
  });

  it("stays aligned with the documented command-taxonomy section", async () => {
    const commandSurfaceDoc = await readFile(
      path.join(repoRoot, "docs/contracts/03-command-surface.md"),
      "utf8",
    );
    const capabilitySection = extractSection(
      commandSurfaceDoc,
      "## Capability Bundles",
      "## Noun Composition",
    );
    const documentedBundles = Object.fromEntries(
      [...capabilitySection.matchAll(/^- `([^`]+)`: `([^`]+)`$/gmu)].map((match) => [
        match[1] ?? "",
        match[2] ?? "",
      ]),
    );
    const exportedBundles = Object.fromEntries(
      Object.entries(commandCapabilityBundles).map(([bundleId, definition]) => [
        bundleId,
        definition.docSurface,
      ]),
    );

    expect(documentedBundles).toEqual(exportedBundles);

    const nounSection = extractSection(
      commandSurfaceDoc,
      "## Noun Composition",
      "These are capabilities, not exceptions.",
    );
    const documentedTaxonomyTokens = new Set(
      nounSection
        .split("\n")
        .flatMap((line) => {
          const trimmed = line.trim();

          if (!trimmed.startsWith("- ")) {
            return [];
          }

          if (trimmed.startsWith("- Top-level `")) {
            const aliasMatch = trimmed.match(/^- Top-level `([^`]+)`/u);
            return aliasMatch?.[1] ? [aliasMatch[1]] : [];
          }

          const surfacePrefix = trimmed.includes(" are ")
            ? (trimmed.split(" are ")[0] ?? "")
            : trimmed.includes(" is ")
              ? (trimmed.split(" is ")[0] ?? "")
              : (trimmed.split(" composes ")[0] ?? "");

          return [...surfacePrefix.matchAll(/`([^`]+)`/gmu)]
            .map((match) => match[1] ?? "")
            .filter((token) => token.length > 0 && !token.includes(" "));
        }),
    );
    const exportedTaxonomyTokens = new Set([
      ...commandNounCapabilities.map((entry) => toDocName(String(entry.noun))),
      ...commandAliasDefinitions.map((entry) => entry.alias),
    ]);

    expect([...documentedTaxonomyTokens].sort()).toEqual([...exportedTaxonomyTokens].sort());
    expect(nounSection).toContain(
      "- `document` exposes `import | edit | show | list | manifest`, and `meal` exposes `add | edit | show | list | manifest`.",
    );
    expect(nounSection).toContain(
      "- `intake` exposes `import | show | list | manifest | raw | project`.",
    );
    expect(nounSection).toContain(
      "- `samples` exposes `add | import-csv | show | list | batch show | batch list`.",
    );
    expect(nounSection).toContain("- `vault` exposes `show | stats | repair | update`.");
    expect(nounSection).toContain(
      "- `export` exposes `create | show | list | materialize | prune`.",
    );
    expect(nounSection).toContain("- `audit` exposes `show | list | tail`.");

    const documentedAliases = [...nounSection.matchAll(
      /^- Top-level `([^`]+)` is a shorthand alias for `([^`]+)`/gmu,
    )].map((match) => ({
      alias: match[1] ?? "",
      targetCommand: match[2] ?? "",
    }));

    expect(documentedAliases).toEqual(
      commandAliasDefinitions.map((definition) => ({
        alias: definition.alias,
        targetCommand: definition.targetCommand,
      })),
    );

    const frozenHealthSection = extractSection(
      commandSurfaceDoc,
      "Frozen health nouns remain:",
      "## Native Incur Contract",
    );
    const documentedFrozenHealthNouns = [...frozenHealthSection.matchAll(
      /^- `([^`]+)`$/gmu,
    )].map((match) => match[1] ?? "");

    expect(documentedFrozenHealthNouns).toEqual(
      frozenHealthCommandNouns.map((noun) => toDocName(noun)),
    );
  });
});
