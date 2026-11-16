import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as coreRuntime from "@murphai/core";
import { test } from "vitest";

import { normalizeJunctionSnapshot } from "../src/device-providers/junction.ts";
import { importDeviceProviderSnapshot } from "../src/index.ts";

// The provider can move a sleep session's start or end after it first sends
// it. The session keeps its id, and a sleep cycle names that id, so the total
// and stage minutes belong to the session rather than to one coverage window.

type Stored = Record<string, unknown>;

const SESSION_START = "2026-01-02T04:00:00.000Z";
const FIRST_END = "2026-01-02T10:00:00.000Z";
const REWRITTEN_END = "2026-01-02T10:20:00.000Z";

function sleepSummary(end: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "sleep-session-1",
    source_provider: "apple_health_kit",
    source_type: "watch",
    time_zone: "America/New_York",
    bedtime_start: SESSION_START,
    bedtime_stop: end,
    total: Math.round((Date.parse(end) - Date.parse(SESSION_START)) / 1000) - 600,
    awake: 600,
    light: 4 * 3600,
    deep: 3600,
    rem: 3600,
    ...overrides,
  };
}

// Apple Health reports plain "asleep" as stage -1; 2 is light sleep.
function sleepCycle(end: string, stage: number, overrides: Record<string, unknown> = {}) {
  return {
    id: "sleep-cycle-1",
    sleep_id: "sleep-session-1",
    source_provider: "apple_health_kit",
    source_type: "watch",
    time_zone: "America/New_York",
    session_start: SESSION_START,
    session_end: end,
    stage_start_offset_second: [0],
    stage_end_offset_second: [(Date.parse(end) - Date.parse(SESSION_START)) / 1000],
    stage_type: [stage],
    ...overrides,
  };
}

const NO_STAGE_MINUTES = { awake: null, light: null, deep: null, rem: null };

async function withVault(
  run: (vault: {
    deleteRecord: (record: Stored) => Promise<void>;
    editNote: (record: Stored, note: string) => Promise<void>;
    importSummaries: (importedAt: string, summaries: Record<string, unknown[]>) => Promise<void>;
    readLive: () => Promise<Stored[]>;
    readRows: () => Promise<Stored[]>;
  }) => Promise<void>,
): Promise<void> {
  const vaultRoot = await mkdtemp(join(tmpdir(), "murph-junction-sleep-session-"));
  const shardPaths = new Set<string>();
  const readRows = async () => (await Promise.all([...shardPaths].map((relativePath) =>
    coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
  ))).flat() as Stored[];
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-01-02T00:00:00.000Z",
      timezone: "UTC",
    });
    await run({
      deleteRecord: async (record) => {
        await coreRuntime.deleteEvent({ vaultRoot, eventId: String(record.id) });
      },
      // A member edit, as the app writes it: the event's own fields plus a note.
      editNote: async (record, note) => {
        const { ledgerFile } = await coreRuntime.upsertEvent({
          vaultRoot,
          payload: {
            id: record.id,
            kind: record.kind,
            occurredAt: record.occurredAt,
            recordedAt: record.recordedAt,
            dayKey: record.dayKey,
            title: record.title,
            metric: record.metric,
            observationGrain: record.observationGrain,
            value: record.value,
            unit: record.unit,
            note,
          },
        });
        shardPaths.add(ledgerFile);
      },
      importSummaries: async (importedAt, summaries) => {
        const result = await importDeviceProviderSnapshot<
          Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>
        >(
          { vaultRoot, provider: "junction", snapshot: { importedAt, summaries } },
          { corePort: coreRuntime },
        );
        for (const path of result.eventShardPaths) shardPaths.add(path);
      },
      readLive: async () => {
        const latest = new Map<string, Stored>();
        for (const record of await readRows()) {
          const existing = latest.get(String(record.id));
          if (!existing || revision(record) >= revision(existing)) {
            latest.set(String(record.id), record);
          }
        }
        return [...latest.values()].filter((record) =>
          (record.lifecycle as { state?: string } | undefined)?.state !== "deleted"
        );
      },
      readRows,
    });
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
}

function revision(record: Stored): number {
  return (record.lifecycle as { revision?: number } | undefined)?.revision ?? 1;
}

function normalizerVersion(record: Stored): string | undefined {
  return (record.dataOrigin as { normalizerVersion?: string } | undefined)?.normalizerVersion;
}

function metricRecords(records: readonly Stored[], metric: string): Stored[] {
  return records.filter((record) => record.kind === "observation" && record.metric === metric);
}

test("a rewritten sleep end revises the cycle's total in place", async () => {
  await withVault(async ({ importSummaries, readLive }) => {
    await importSummaries("2026-01-02T12:00:00.000Z", {
      sleep: [sleepSummary(FIRST_END, NO_STAGE_MINUTES)],
    });
    await importSummaries("2026-01-02T12:01:00.000Z", { sleep_cycle: [sleepCycle(FIRST_END, -1)] });
    const before = metricRecords(await readLive(), "sleep-total-minutes")
      .find((record) => normalizerVersion(record) === "junction-sleep-unspecified-total.v1");
    assert.equal(before?.value, 360);

    await importSummaries("2026-01-02T13:00:00.000Z", {
      sleep: [sleepSummary(REWRITTEN_END, NO_STAGE_MINUTES)],
    });
    await importSummaries("2026-01-02T13:01:00.000Z", {
      sleep_cycle: [sleepCycle(REWRITTEN_END, -1)],
    });

    const live = await readLive();
    const cycleTotals = metricRecords(live, "sleep-total-minutes")
      .filter((record) => normalizerVersion(record) === "junction-sleep-unspecified-total.v1");
    assert.equal(cycleTotals.length, 1);
    assert.equal(cycleTotals[0]?.id, before?.id);
    assert.equal(cycleTotals[0]?.value, 380);
    assert.equal(cycleTotals[0]?.occurredAt, REWRITTEN_END);
    assert.equal(live.filter((record) => record.kind === "sleep_session").length, 1);
  });
});

test("a rewritten sleep end revises the summary's stage minutes in place", async () => {
  await withVault(async ({ importSummaries, readLive }) => {
    await importSummaries("2026-01-02T12:00:00.000Z", { sleep: [sleepSummary(FIRST_END)] });
    const before = metricRecords(await readLive(), "sleep-light-minutes");
    assert.equal(before.length, 1);

    await importSummaries("2026-01-02T13:00:00.000Z", {
      sleep: [sleepSummary(REWRITTEN_END, { light: 4 * 3600 + 1200 })],
    });

    const live = await readLive();
    for (const metric of [
      "sleep-awake-minutes", "sleep-light-minutes", "sleep-deep-minutes", "sleep-rem-minutes",
    ]) {
      assert.equal(metricRecords(live, metric).length, 1, metric);
    }
    const [light] = metricRecords(live, "sleep-light-minutes");
    assert.equal(light?.id, before[0]?.id);
    assert.equal(light?.value, 260);
    assert.equal(light?.occurredAt, REWRITTEN_END);
  });
});

test("the sleep summary and its cycle share one stage owner across imports and a rewrite", async () => {
  await withVault(async ({ importSummaries, readLive }) => {
    await importSummaries("2026-01-02T12:00:00.000Z", { sleep: [sleepSummary(FIRST_END)] });
    await importSummaries("2026-01-02T12:01:00.000Z", { sleep_cycle: [sleepCycle(FIRST_END, 2)] });
    // The cycle arrives first this time, on a window the summary has not sent.
    await importSummaries("2026-01-02T13:00:00.000Z", {
      sleep_cycle: [sleepCycle(REWRITTEN_END, 2)],
    });
    await importSummaries("2026-01-02T13:01:00.000Z", { sleep: [sleepSummary(REWRITTEN_END)] });

    const light = metricRecords(await readLive(), "sleep-light-minutes");
    assert.equal(light.length, 1);
    assert.equal(normalizerVersion(light[0]!), "junction-sleep-stage-summary.v1");
    assert.equal(light[0]?.value, 240);
  });
});

test("records stored under the coverage window move to the session id", async () => {
  await withVault(async ({ importSummaries, readLive }) => {
    // What a vault holds from before sessions were keyed on their id.
    await importSummaries("2026-01-02T12:00:00.000Z", {
      sleep_cycle: [sleepCycle(FIRST_END, -1, { sleep_id: undefined })],
    });
    const [stored] = metricRecords(await readLive(), "sleep-total-minutes");
    assert.ok(stored);

    await importSummaries("2026-01-02T13:00:00.000Z", { sleep_cycle: [sleepCycle(FIRST_END, -1)] });

    const totals = metricRecords(await readLive(), "sleep-total-minutes");
    assert.equal(totals.length, 1);
    assert.equal(totals[0]?.id, stored.id);
  });
});

test("a stale window copy does not block a later payload for the same session", async () => {
  await withVault(async ({ importSummaries, readLive }) => {
    // Stored before the change: the stale first window and the current one.
    await importSummaries("2026-01-02T12:00:00.000Z", {
      sleep_cycle: [sleepCycle(FIRST_END, -1, { sleep_id: undefined })],
    });
    await importSummaries("2026-01-02T12:30:00.000Z", {
      sleep_cycle: [sleepCycle(REWRITTEN_END, -1, { sleep_id: undefined })],
    });
    await importSummaries("2026-01-02T13:00:00.000Z", {
      sleep_cycle: [sleepCycle(REWRITTEN_END, -1)],
    });

    // An older payload delivered late names the window the stale copy holds.
    await importSummaries("2026-01-02T13:30:00.000Z", { sleep_cycle: [sleepCycle(FIRST_END, -1)] });

    const totals = metricRecords(await readLive(), "sleep-total-minutes");
    const refs = totals.map((record) =>
      String((record.externalRef as { resourceId?: string }).resourceId).split("-").slice(0, 2).join("-")
    ).sort();
    // The session's record took the late payload; the stale copy is untouched.
    assert.deepEqual(refs, ["sleep-session", "sleep-stage"]);
  });
});

function refPrefix(record: Stored): string {
  return String((record.externalRef as { resourceId?: string }).resourceId)
    .split("-").slice(0, 2).join("-");
}

// Before sessions were keyed on their id, every summary a source sent for one
// window wrote the same stage records, so they hold the last one's values. A
// source can send two summaries for one window under different session ids, or
// one summary twice. Each now has its own session ref, and each names the
// record the window holds.
const GOOGLE_HEALTH = { source_provider: "google_health", source_type: "watch" };
const SESSION_A = sleepSummary(FIRST_END, { ...GOOGLE_HEALTH, id: "gh-sleep-a" });
const SESSION_B = sleepSummary(FIRST_END, { ...GOOGLE_HEALTH, id: "gh-sleep-b", deep: 3000 });
const BEFORE_SESSION_REFS = [SESSION_A, SESSION_B].map(({ id: _id, ...summary }) => summary);

function deepSleepRef(summary: Record<string, unknown>): string | undefined {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-01-02T12:00:00.000Z",
    summaries: { sleep: [summary] },
  }, { defaultTimeZone: "UTC" });
  return payload.events?.find((event) => event.fields?.metric === "sleep-deep-minutes")
    ?.externalRef?.resourceId;
}

for (const reread of [[SESSION_A, SESSION_B], [SESSION_B, SESSION_A]]) {
  test(`two sessions for one stored window import as in an empty vault (${reread.map((s) => s.id).join(", ")})`, async () => {
    await withVault(async ({ editNote, importSummaries, readLive, readRows }) => {
      await importSummaries("2026-01-02T12:00:00.000Z", { sleep: BEFORE_SESSION_REFS });
      const [stored] = metricRecords(await readLive(), "sleep-deep-minutes");
      assert.ok(stored);
      assert.equal(refPrefix(stored), "sleep-stage");
      assert.equal(stored.value, 50);
      await editNote(stored, "Woke up twice");

      await importSummaries("2026-01-02T13:00:00.000Z", { sleep: reread });

      const live = await readLive();
      for (const metric of ["sleep-awake-minutes", "sleep-light-minutes", "sleep-rem-minutes"]) {
        const records = metricRecords(live, metric);
        assert.deepEqual(records.map(refPrefix), ["sleep-session", "sleep-session"], metric);
        assert.equal(new Set(records.map((record) => JSON.stringify(record.externalRef))).size, 2);
      }
      // The stored record holds session b's minutes, so session b takes it over
      // with the member's note; session a starts its own record.
      const deep = metricRecords(live, "sleep-deep-minutes");
      assert.deepEqual(
        deep.map((record) => [record.id === stored.id, record.value, record.note ?? null]).sort(),
        [[false, 60, null], [true, 50, "Woke up twice"]],
      );
      const keptProvider = (await readRows())
        .filter((row) => row.id === stored.id && row.source === "device")
        .sort((left, right) => revision(right) - revision(left))[0];
      assert.equal(
        (keptProvider?.externalRef as { resourceId?: string } | undefined)?.resourceId,
        deepSleepRef(SESSION_B),
      );
      const started = deep.find((record) => record.id !== stored.id);
      assert.equal((started?.externalRef as { resourceId?: string } | undefined)?.resourceId, deepSleepRef(SESSION_A));

      await importSummaries("2026-01-02T14:00:00.000Z", { sleep: [...reread].reverse() });
      assert.deepEqual(await readLive(), live);
    });
  });
}

const STAGE_METRICS = [
  "sleep-awake-minutes", "sleep-light-minutes", "sleep-deep-minutes", "sleep-rem-minutes",
];

function stageFacts(records: readonly Stored[]): string[] {
  return records
    .filter((record) => record.kind === "observation" && STAGE_METRICS.includes(String(record.metric)))
    .map((record) => JSON.stringify([
      record.metric,
      (record.externalRef as { resourceId?: string } | undefined)?.resourceId,
      record.value,
    ]))
    .sort();
}

// A session can also arrive twice in one import, with the same or different
// values, beside another session for the same window. Its first copy can carry
// a rewritten end, so only its second copy names the stored window.
for (const reread of [
  [SESSION_A, { ...SESSION_A, deep: 3000 }],
  [{ ...SESSION_A, deep: 3000 }, SESSION_A],
  [{ ...SESSION_B, deep: 2400 }, SESSION_A, SESSION_B],
  [sleepSummary(REWRITTEN_END, { ...GOOGLE_HEALTH, id: "gh-sleep-a" }), SESSION_A],
]) {
  const label = reread
    .map((summary) => `${summary.id} ${summary.deep}s to ${summary.bedtime_stop.slice(11, 16)}`)
    .join(", ");
  test(`a stored window record moves once, and the night ends as in an empty vault (${label})`, async () => {
    let expected: string[] = [];
    await withVault(async ({ importSummaries, readLive }) => {
      await importSummaries("2026-01-02T13:00:00.000Z", { sleep: reread });
      expected = stageFacts(await readLive());
    });

    await withVault(async ({ importSummaries, readLive }) => {
      await importSummaries("2026-01-02T12:00:00.000Z", { sleep: BEFORE_SESSION_REFS });
      const [stored] = metricRecords(await readLive(), "sleep-deep-minutes");
      assert.ok(stored);

      await importSummaries("2026-01-02T13:00:00.000Z", { sleep: reread });
      const live = await readLive();
      assert.deepEqual(stageFacts(live), expected);
      assert.ok(metricRecords(live, "sleep-deep-minutes").some((record) => record.id === stored.id));

      await importSummaries("2026-01-02T14:00:00.000Z", { sleep: reread.slice(-1) });
      assert.deepEqual(await readLive(), live);
    });
  });
}

test("a session whose copies name two stored windows moves one and leaves the other", async () => {
  await withVault(async ({ importSummaries, readLive }) => {
    // Before session refs, a rewritten end left a second window record.
    await importSummaries("2026-01-02T12:00:00.000Z", {
      sleep: [sleepSummary(FIRST_END, { ...GOOGLE_HEALTH, id: undefined })],
    });
    await importSummaries("2026-01-02T12:30:00.000Z", {
      sleep: [sleepSummary(REWRITTEN_END, { ...GOOGLE_HEALTH, id: undefined })],
    });

    await importSummaries("2026-01-02T13:00:00.000Z", {
      sleep: [sleepSummary(REWRITTEN_END, { ...GOOGLE_HEALTH, id: "gh-sleep-a" }), SESSION_A],
    });

    // The session takes the record its first copy names; the other stays a stale copy.
    const deep = metricRecords(await readLive(), "sleep-deep-minutes");
    assert.deepEqual(deep.map(refPrefix).sort(), ["sleep-session", "sleep-stage"]);
  });
});

test("a stored window record the member deleted stays deleted, and each session imports anew", async () => {
  await withVault(async ({ deleteRecord, importSummaries, readLive }) => {
    await importSummaries("2026-01-02T12:00:00.000Z", { sleep: BEFORE_SESSION_REFS });
    const [stored] = metricRecords(await readLive(), "sleep-deep-minutes");
    assert.ok(stored);
    await deleteRecord(stored);

    await importSummaries("2026-01-02T13:00:00.000Z", { sleep: [SESSION_A, SESSION_B] });

    // A deleted record's content never matches an incoming session, so neither
    // takes it over. One session does the same since sessions got their own refs.
    const deep = metricRecords(await readLive(), "sleep-deep-minutes");
    assert.deepEqual(deep.map((record) => record.value).sort(), [50, 60]);
    assert.equal(deep.some((record) => record.id === stored.id), false);
  });
});

test("one summary sent twice in one import moves the stored window record once", async () => {
  await withVault(async ({ importSummaries, readLive }) => {
    await importSummaries("2026-01-02T12:00:00.000Z", {
      sleep: [sleepSummary(FIRST_END, { id: undefined })],
    });
    const [stored] = metricRecords(await readLive(), "sleep-deep-minutes");
    assert.ok(stored);

    await importSummaries("2026-01-02T13:00:00.000Z", {
      sleep: [sleepSummary(FIRST_END), sleepSummary(FIRST_END)],
    });

    const deep = metricRecords(await readLive(), "sleep-deep-minutes");
    assert.deepEqual(deep.map((record) => record.id), [stored.id]);
    assert.equal(refPrefix(deep[0]!), "sleep-session");
  });
});

test("a summary owns its session's stages when the cycle's window differs by seconds", () => {
  const payload = normalizeJunctionSnapshot({
    importedAt: "2026-01-02T12:00:00.000Z",
    summaries: {
      sleep: [sleepSummary(FIRST_END)],
      sleep_cycle: [sleepCycle("2026-01-02T10:00:30.000Z", 2)],
    },
  }, { defaultTimeZone: "UTC" });

  const light = (payload.events ?? []).filter((event) =>
    event.kind === "observation" && event.fields?.metric === "sleep-light-minutes"
  );
  assert.equal(light.length, 1);
  assert.equal(light[0]?.dataOrigin?.normalizerVersion, "junction-sleep-stage-summary.v1");
});

test("a cycle names its session in either spelling, and falls back to its window without one", () => {
  const totalFor = (cycle: Record<string, unknown>) => {
    const payload = normalizeJunctionSnapshot({
      importedAt: "2026-01-02T12:00:00.000Z",
      summaries: { sleep_cycle: [cycle] },
    }, { defaultTimeZone: "UTC" });
    return (payload.events ?? []).find((event) =>
      event.kind === "observation" && event.fields?.metric === "sleep-total-minutes"
    );
  };

  const wire = totalFor(sleepCycle(FIRST_END, -1));
  const sdk = totalFor(sleepCycle(FIRST_END, -1, { sleep_id: undefined, sleepId: "sleep-session-1" }));
  const neither = totalFor(sleepCycle(FIRST_END, -1, { sleep_id: undefined }));

  assert.ok(wire?.externalRef?.resourceId.startsWith("sleep-session-"));
  assert.equal(sdk?.externalRef?.resourceId, wire?.externalRef?.resourceId);
  assert.ok(neither?.externalRef?.resourceId.startsWith("sleep-stage-"));
  assert.equal(neither?.legacyExternalRefs, undefined);
  // The window ref the session supersedes is the one a record without an id uses.
  assert.equal(wire?.legacyExternalRefs?.[0]?.resourceId, neither?.externalRef?.resourceId);
});

test("an empty sleep cycle wrapper imports nothing", () => {
  for (const wrapper of [{ sleepCycle: null }, { sleepCycle: {} }, {}]) {
    const payload = normalizeJunctionSnapshot({
      importedAt: "2026-01-02T12:00:00.000Z",
      summaries: { sleep_cycle: [wrapper] },
    }, { defaultTimeZone: "UTC" });
    assert.deepEqual(payload.events ?? [], []);
  }
});
