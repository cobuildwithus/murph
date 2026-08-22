import assert from "node:assert/strict";

import { afterEach, test, vi } from "vitest";

import type {
  QueryCanonicalEntity,
  QueryEntityFamily,
} from "../src/query-runtime.ts";
import { importWithMocks, mockActualModule } from "./mock-import.ts";

const QUERY_FAMILY_ROUTES = [
  ["alg_1", "allergy"],
  ["asmt_1", "assessment"],
  ["aud_1", "audit"],
  ["cond_1", "condition"],
  ["vault_1", "core"],
  ["core", "core"],
  ["current", "core"],
  ["evt_1", "event"],
  ["exp_1", "experiment"],
  ["fam_1", "family"],
  ["food_1", "food"],
  ["var_1", "genetics"],
  ["goal_1", "goal"],
  ["hab_1", "habitat"],
  ["journal:2026-08-20", "journal"],
  ["prot_1", "protocol"],
  ["prov_1", "provider"],
  ["reg_1", "regimen"],
  ["rcp_1", "recipe"],
  ["smp_1", "sample"],
  ["wfmt_1", "workout_format"],
  ["doc_1", "event"],
  ["meal_1", "event"],
] as const satisfies ReadonlyArray<readonly [string, QueryEntityFamily]>;

afterEach(() => {
  vi.doUnmock("../src/usecases/runtime.js");
  vi.restoreAllMocks();
});

test("generic show derives every query family from the shared lookup registries", async () => {
  const resolveCanonicalEntityInFamily = vi.fn(
    async (_vault: string, family: QueryEntityFamily, lookup: string) =>
      createQueryEntity(family, lookup),
  );
  const integratedServicesModule = await importWithMocks<
    typeof import("../src/usecases/integrated-services.ts")
  >("../src/usecases/integrated-services.ts", {
    "../src/usecases/runtime.js": mockActualModule(
      "../src/usecases/runtime.ts",
      (actual) => ({
        ...actual,
        loadQueryRuntime: vi.fn(async () => ({ resolveCanonicalEntityInFamily })),
      }),
    ),
  });
  const services = integratedServicesModule.createIntegratedVaultServices();

  for (const [lookup, family] of QUERY_FAMILY_ROUTES) {
    resolveCanonicalEntityInFamily.mockClear();
    const shown = await services.query.show({
      id: lookup,
      requestId: null,
      vault: "/vault",
    });

    assert.equal(shown.entity.id, lookup);
    assert.deepEqual(resolveCanonicalEntityInFamily.mock.calls, [
      ["/vault", family, lookup],
    ]);
  }
});

test("generic show preserves typed errors for unknown, constrained, and missing ids", async () => {
  const resolveCanonicalEntityInFamily = vi.fn(async () => null);
  const integratedServicesModule = await importWithMocks<
    typeof import("../src/usecases/integrated-services.ts")
  >("../src/usecases/integrated-services.ts", {
    "../src/usecases/runtime.js": mockActualModule(
      "../src/usecases/runtime.ts",
      (actual) => ({
        ...actual,
        loadQueryRuntime: vi.fn(async () => ({ resolveCanonicalEntityInFamily })),
      }),
    ),
  });
  const services = integratedServicesModule.createIntegratedVaultServices();

  await assert.rejects(
    services.query.show({ id: "unknown_1", requestId: null, vault: "/vault" }),
    { code: "not_found", name: "VaultCliError" },
  );
  assert.equal(resolveCanonicalEntityInFamily.mock.calls.length, 0);

  await assert.rejects(
    services.query.show({ id: "xfm_1", requestId: null, vault: "/vault" }),
    { code: "invalid_lookup_id", name: "VaultCliError" },
  );
  assert.equal(resolveCanonicalEntityInFamily.mock.calls.length, 0);

  await assert.rejects(
    services.query.show({ id: "evt_missing", requestId: null, vault: "/vault" }),
    { code: "not_found", name: "VaultCliError" },
  );
  assert.deepEqual(resolveCanonicalEntityInFamily.mock.calls, [
    ["/vault", "event", "evt_missing"],
  ]);
});

function createQueryEntity(
  family: QueryEntityFamily,
  lookup: string,
): QueryCanonicalEntity {
  const kind = lookup.startsWith("doc_")
    ? "document"
    : lookup.startsWith("meal_")
      ? "meal"
      : family === "core"
        ? "core_document"
        : family;

  return {
    attributes: {},
    body: null,
    date: null,
    entityId: lookup,
    experimentSlug: null,
    family,
    frontmatter: null,
    kind,
    links: [],
    lookupIds: [lookup],
    occurredAt: null,
    path: `${family}/${lookup}`,
    primaryLookupId: lookup,
    recordClass: "bank",
    relatedIds: [],
    status: null,
    stream: null,
    tags: [],
    title: lookup,
  };
}
