import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyLimit,
  asObject,
  arrayOfStrings,
  compareByLatest,
  compareNullableDates,
  firstString,
  isJsonObject,
  isMissingPathError,
  matchesDateRange,
  matchesOptionalString,
  nullableString,
  numberOrNull,
  readJsonObject,
  toAuditCommandListItem,
  toCommandShowEntity,
  toOwnedEventCommandShowEntity,
  toSampleCommandListItem,
} from "../src/commands/query-record-command-helpers.ts";
import {
  describeQueryLookupConstraint,
  inferQueryIdEntityKind,
  isQueryableQueryLookupId,
} from "../src/query-runtime.ts";
import { importWithMocks } from "./mock-import.ts";

import type { QueryRecord } from "../src/query-runtime.ts";

function createQueryRecord(overrides: Partial<QueryRecord> = {}): QueryRecord {
  return {
    entityId: "evt_default",
    primaryLookupId: "evt_default",
    lookupIds: ["evt_default"],
    family: "event",
    recordClass: "ledger",
    kind: "event",
    status: null,
    occurredAt: "2026-04-08T00:00:00Z",
    date: "2026-04-08",
    path: "ledger/events/default.md",
    title: "Default Event",
    body: "Default body",
    attributes: {},
    frontmatter: null,
    links: [],
    relatedIds: [],
    stream: null,
    experimentSlug: null,
    tags: [],
    ...overrides,
  };
}

function createCommandQueryRuntimeShape() {
  return {
    readVault: vi.fn(async () => undefined),
    lookupEntityById: vi.fn(() => null),
    listEntities: vi.fn(() => []),
  };
}

afterEach(() => {
  vi.doUnmock("../src/query-runtime.ts");
  vi.doUnmock("../src/runtime-import.ts");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("query record command helpers", () => {
  it("builds a command show entity with fallback fields and sorted derived links", () => {
    const record = createQueryRecord({
      entityId: "",
      primaryLookupId: "meal_breakfast",
      kind: "",
      family: "event",
      attributes: {
        extraLinks: ["xfm_batch_1", "prov_fitbit", "", 7, "evt_walk", " evt_padded "],
      },
      relatedIds: ["prov_fitbit", " evt_walk ", "", "rcp_soup"],
    });

    Reflect.set(record, "title", undefined);
    Reflect.set(record, "occurredAt", undefined);
    Reflect.set(record, "path", undefined);
    Reflect.set(record, "body", undefined);

    const result = toCommandShowEntity(record, ["extraLinks"]);

    expect(result.id).toBe("meal_breakfast");
    expect(result.kind).toBe("event");
    expect(result.title).toBeNull();
    expect(result.occurredAt).toBeNull();
    expect(result.path).toBeNull();
    expect(result.markdown).toBeNull();
    expect(result.data).toBe(record.attributes);
    expect(result.links).toEqual([
      { id: " evt_padded ", kind: "event", queryable: true },
      { id: "evt_walk", kind: "event", queryable: true },
      { id: "prov_fitbit", kind: "provider", queryable: true },
      { id: "rcp_soup", kind: "recipe", queryable: true },
      { id: "xfm_batch_1", kind: "transform", queryable: false },
    ]);
  });

  it("builds an owned-event command entity from explicit extra links only", () => {
    const record = createQueryRecord({
      attributes: {
        ownedLinks: ["xfm_batch_1", "evt_walk", "prov_fitbit"],
      },
      relatedIds: ["rcp_soup", "evt_skipped"],
    });

    const result = toOwnedEventCommandShowEntity(record, ["ownedLinks"]);

    expect(result.links).toEqual([
      { id: "xfm_batch_1", kind: "transform", queryable: false },
      { id: "evt_walk", kind: "event", queryable: true },
      { id: "prov_fitbit", kind: "provider", queryable: true },
    ]);
  });

  it("builds sample and audit command list items from record behavior", () => {
    const sample = toSampleCommandListItem(
      createQueryRecord({
        status: "verified",
        stream: "oura",
        attributes: { source: "sensor" },
      }),
    );
    const sampleWithoutState = toSampleCommandListItem(
      createQueryRecord({
        status: null,
        stream: null,
        attributes: { source: "manual" },
      }),
    );
    const audit = toAuditCommandListItem(
      createQueryRecord({
        family: "audit",
        kind: "audit",
        status: "applied",
        attributes: {
          action: " update ",
          actor: " cli ",
          command_name: " query.samples.list ",
          summary: " synced records ",
        },
      }),
    );

    expect(sample.quality).toBe("verified");
    expect(sample.stream).toBe("oura");
    expect(sample.data).toEqual({
      source: "sensor",
      status: "verified",
      stream: "oura",
    });

    expect(sampleWithoutState.quality).toBeNull();
    expect(sampleWithoutState.stream).toBeNull();
    expect(sampleWithoutState.data).toEqual({
      source: "manual",
      status: undefined,
      stream: undefined,
    });

    expect(audit.action).toBe("update");
    expect(audit.actor).toBe("cli");
    expect(audit.status).toBe("applied");
    expect(audit.commandName).toBe("query.samples.list");
    expect(audit.summary).toBe("synced records");
  });
});

describe("query helper primitives", () => {
  it("matches optional strings, date ranges, ordering, and limits", () => {
    const items = [1, 2, 3];
    const tieLeft = createQueryRecord({
      entityId: "",
      primaryLookupId: "evt_alpha",
      occurredAt: "2026-04-08T00:00:00Z",
    });
    const tieRight = createQueryRecord({
      entityId: "",
      primaryLookupId: "evt_beta",
      occurredAt: "2026-04-08T00:00:00Z",
    });

    expect(matchesOptionalString(null)).toBe(true);
    expect(matchesOptionalString("event", "event")).toBe(true);
    expect(matchesOptionalString("event", "sample")).toBe(false);

    expect(matchesDateRange(null)).toBe(true);
    expect(matchesDateRange(undefined, "2026-04-08")).toBe(false);
    expect(matchesDateRange("2026-04-08T12:34:56Z", "2026-04-08", "2026-04-08")).toBe(true);
    expect(matchesDateRange("2026-04-07T23:59:59Z", "2026-04-08")).toBe(false);
    expect(matchesDateRange("2026-04-09T00:00:00Z", undefined, "2026-04-08")).toBe(false);

    expect(
      compareByLatest(
        createQueryRecord({
          entityId: "evt_newer",
          occurredAt: "2026-04-08T12:00:00Z",
        }),
        createQueryRecord({
          entityId: "evt_older",
          occurredAt: "2026-04-07T12:00:00Z",
        }),
      ),
    ).toBeLessThan(0);
    expect(compareByLatest(tieLeft, tieRight)).toBeLessThan(0);

    expect(compareNullableDates(null, "2026-04-08")).toBeLessThan(0);
    expect(compareNullableDates("2026-04-08", null)).toBeGreaterThan(0);
    expect(compareNullableDates(null, null)).toBe(0);

    expect(applyLimit(items, 0)).toEqual([]);
    expect(applyLimit(items, 2)).toEqual([1, 2]);
    expect(applyLimit(items)).toBe(items);
  });

  it("normalizes objects, arrays, strings, and numbers", () => {
    const objectValue = { ok: true };

    expect(asObject(objectValue)).toBe(objectValue);
    expect(asObject(["not", "an", "object"])).toBeNull();

    expect(isJsonObject(objectValue)).toBe(true);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject(["array"])).toBe(false);

    expect(arrayOfStrings([" a ", "", 7, "b"])).toEqual([" a ", "b"]);

    expect(firstString({ blank: "   ", summary: " trimmed " }, ["blank", "summary"])).toBe(
      "trimmed",
    );
    expect(firstString(undefined, ["summary"])).toBeNull();

    expect(nullableString(" trimmed ")).toBe("trimmed");
    expect(nullableString("   ")).toBeNull();

    expect(numberOrNull(42)).toBe(42);
    expect(numberOrNull(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("reads JSON objects and reports missing or invalid inputs", async () => {
    const tempDirectory = await mkdtemp(path.join(tmpdir(), "vault-usecases-query-helper-"));
    const validPath = path.join(tempDirectory, "valid.json");
    const invalidJsonPath = path.join(tempDirectory, "broken.json");
    const invalidShapePath = path.join(tempDirectory, "array.json");
    const missingPath = path.join(tempDirectory, "missing.json");

    await writeFile(validPath, JSON.stringify({ ok: true }), "utf8");
    await writeFile(invalidJsonPath, "{", "utf8");
    await writeFile(invalidShapePath, JSON.stringify(["not", "an", "object"]), "utf8");

    try {
      await expect(readJsonObject(validPath, "payload")).resolves.toEqual({ ok: true });
      await expect(readJsonObject(missingPath, "payload")).rejects.toMatchObject({
        name: "VaultCliError",
        code: "not_found",
        message: "payload is missing.",
      });
      await expect(readJsonObject(invalidJsonPath, "payload")).rejects.toMatchObject({
        name: "VaultCliError",
        code: "invalid_json",
        message: "payload is not valid JSON.",
      });
      await expect(readJsonObject(invalidShapePath, "payload")).rejects.toMatchObject({
        name: "VaultCliError",
        code: "invalid_json",
        message: "payload must contain a JSON object.",
      });
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("recognizes missing-path errors by errno code", () => {
    const missingPathError = Object.assign(new Error("missing"), { code: "ENOENT" });
    const otherPathError = Object.assign(new Error("blocked"), { code: "EACCES" });

    expect(isMissingPathError(missingPathError)).toBe(true);
    expect(isMissingPathError(otherPathError)).toBe(false);
    expect(isMissingPathError("ENOENT")).toBe(false);
  });
});

describe("query runtime wrappers", () => {
  it("classifies query lookup ids through the shared id-family rules", () => {
    expect(inferQueryIdEntityKind("exp_morning")).toBe("experiment");
    expect(inferQueryIdEntityKind("unknown_lookup")).toBe("entity");

    expect(isQueryableQueryLookupId("journal:2026-04-08")).toBe(true);
    expect(isQueryableQueryLookupId("xfm_batch_1")).toBe(false);

    expect(describeQueryLookupConstraint("exp_morning")).toBeNull();
    expect(describeQueryLookupConstraint("xfm_batch_1")).not.toBeNull();
  });

  it("loads the query runtime through the runtime import seam", async () => {
    const runtimeStub = { marker: "query-runtime" };
    const loadRuntimeModuleMock = vi.fn(async (specifier: string) => {
      expect(specifier).toBe("@murphai/query");
      return runtimeStub;
    });
    const queryRuntimeModule = await importWithMocks<typeof import("../src/query-runtime.ts")>(
      "../src/query-runtime.ts",
      {
        "../src/runtime-import.ts": () => ({
          loadRuntimeModule: vi.fn(loadRuntimeModuleMock),
        }),
      },
    );

    await expect(queryRuntimeModule.loadQueryRuntime()).resolves.toBe(runtimeStub);
    expect(loadRuntimeModuleMock).toHaveBeenCalledTimes(1);
  });

  it("validates the command-helper query runtime shape and caches successful loads", async () => {
    const runtimeStub = createCommandQueryRuntimeShape();
    const loadQueryRuntimeMock = vi.fn(async () => runtimeStub);
    const helperModule = await importWithMocks<
      typeof import("../src/commands/query-record-command-helpers.ts")
    >("../src/commands/query-record-command-helpers.ts", {
      "../src/query-runtime.ts": () => ({
        loadQueryRuntime: vi.fn(loadQueryRuntimeMock),
      }),
    });

    const firstRuntime = await helperModule.loadQueryRuntime("query helper reads");
    const secondRuntime = await helperModule.loadQueryRuntime("query helper reads");

    expect(firstRuntime).toBe(runtimeStub);
    expect(secondRuntime).toBe(runtimeStub);
    expect(loadQueryRuntimeMock).toHaveBeenCalledTimes(1);
  });

  it("clears the helper query runtime cache after a failed load", async () => {
    const runtimeStub = createCommandQueryRuntimeShape();
    let attempts = 0;
    const loadQueryRuntimeMock = vi.fn(async () =>
      attempts++ === 0
        ? {
            readVault: vi.fn(async () => undefined),
            lookupEntityById: null,
            listEntities: vi.fn(() => []),
          }
        : runtimeStub,
    );
    const helperModule = await importWithMocks<
      typeof import("../src/commands/query-record-command-helpers.ts")
    >("../src/commands/query-record-command-helpers.ts", {
      "../src/query-runtime.ts": () => ({
        loadQueryRuntime: vi.fn(loadQueryRuntimeMock),
      }),
    });

    await expect(helperModule.loadQueryRuntime("samples/audit query reads")).rejects.toMatchObject({
      name: "VaultCliError",
      code: "runtime_unavailable",
    });

    await expect(helperModule.loadQueryRuntime("samples/audit query reads")).resolves.toBe(
      runtimeStub,
    );
    expect(loadQueryRuntimeMock).toHaveBeenCalledTimes(2);
  });
});
