import assert from "node:assert/strict";

import { afterEach, test, vi } from "vitest";

import type { VaultCliError } from "@murphai/operator-config/vault-cli-errors";

import { importWithMocks } from "./mock-import.ts";

const experimentId = "exp_01JNV4458HYPP53JDQCBP1QJGA";

afterEach(() => {
  vi.doUnmock("../src/query-runtime.js");
  vi.doUnmock("../src/usecases/provider-event.js");
  vi.restoreAllMocks();
});

function experimentEntity() {
  return {
    entityId: experimentId,
    primaryLookupId: experimentId,
    lookupIds: [experimentId, "daily-run"],
    family: "experiment",
    recordClass: "bank",
    kind: "experiment",
    status: "active",
    occurredAt: "2026-06-01T08:00:00.000Z",
    date: "2026-06-01",
    path: "bank/experiments/daily-run.md",
    title: "Daily Run",
    body: "---\n",
    attributes: {
      schemaVersion: "murph.frontmatter.experiment.v1",
      docType: "experiment",
      experimentId,
      slug: "daily-run",
      status: "active",
      title: "Daily Run",
      startedOn: "2026-06-01",
      runPlan: {
        baselineStart: "2026-05-25",
        baselineEnd: "2026-05-31",
        interventionStart: "2026-06-01",
        interventionEnd: "2026-06-14",
        modality: "Run",
      },
    },
    frontmatter: null,
    links: [],
    relatedIds: [],
    stream: null,
    experimentSlug: "daily-run",
    tags: [],
  };
}

async function loadExperimentJournalModule() {
  const entity = experimentEntity();
  const queryRuntime = {
    readVault: vi.fn(async () => ({ entities: [entity], experiments: [entity] })),
    lookupEntityById: vi.fn(() => entity),
  };
  const upsertEventRecord = vi.fn(async () => ({
    created: true,
    eventId: "evt_01JNV45RHN0TQ9ZXE0A7YSE201",
    ledgerFile: "ledger/events/2026/2026-06.jsonl",
    lookupId: "evt_01JNV45RHN0TQ9ZXE0A7YSE201",
  }));
  const module = await importWithMocks<
    typeof import("../src/usecases/experiment-journal-vault.ts")
  >("../src/usecases/experiment-journal-vault.ts", {
    "../src/query-runtime.js": () => ({
      loadQueryRuntime: vi.fn(async () => queryRuntime),
    }),
    "../src/usecases/provider-event.js": () => ({
      upsertEventRecord,
    }),
  });

  return { module, upsertEventRecord };
}

function upsertPayloadAt(
  upsertEventRecord: ReturnType<typeof vi.fn>,
  index: number,
): Record<string, unknown> {
  const calls = upsertEventRecord.mock.calls as Array<[{ payload: Record<string, unknown> }]>;
  const call = calls[index];
  assert.ok(call);
  return call[0].payload;
}

test("experiment session logging rejects an explicit mismatched intervention type", async () => {
  const { module, upsertEventRecord } = await loadExperimentJournalModule();

  await assert.rejects(
    () =>
      module.logExperimentSessionRecord({
        vault: "test-vault",
        lookup: "daily-run",
        occurredAt: "2026-06-02T12:00:00.000Z",
        interventionType: "cycling",
    }),
    (error) => {
      assert.equal((error as VaultCliError).name, "VaultCliError");
      assert.equal((error as VaultCliError).code, "invalid_option");
      assert.match(
        (error as Error).message,
        /Intervention type "cycling" does not match experiment "daily-run"/u,
      );
      return true;
    },
  );
  assert.equal(upsertEventRecord.mock.calls.length, 0);
});

test("experiment session logging keeps derived and matching explicit intervention types", async () => {
  const { module, upsertEventRecord } = await loadExperimentJournalModule();

  await module.logExperimentSessionRecord({
    vault: "test-vault",
    lookup: "daily-run",
    occurredAt: "2026-06-02T12:00:00.000Z",
  });
  await module.logExperimentSessionRecord({
    vault: "test-vault",
    lookup: "daily-run",
    occurredAt: "2026-06-03T12:00:00.000Z",
    interventionType: "run",
  });
  await module.logExperimentSessionRecord({
    vault: "test-vault",
    lookup: "daily-run",
    occurredAt: "2026-06-04T12:00:00.000Z",
    interventionType: "protocol:run",
  });

  assert.equal(upsertEventRecord.mock.calls.length, 3);
  assert.equal(upsertPayloadAt(upsertEventRecord, 0).interventionType, "run");
  assert.equal(upsertPayloadAt(upsertEventRecord, 1).interventionType, "run");
  assert.equal(upsertPayloadAt(upsertEventRecord, 2).interventionType, "protocol-run");
});
