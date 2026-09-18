import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  buildHostedVaultShareProjectionScopeKey as key,
  filterHostedVaultShareHistoryRecords as clip,
  getHostedVaultShareProjectionMaxRecords,
  hostedVaultShareHistoryDateWindow,
  hostedVaultShareReadAuthorityScopes,
  HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
  HOSTED_VAULT_SHARE_PROJECTION_KINDS,
  parseHostedVaultShareActiveProjectionKindsResponse,
  HOSTED_VAULT_SHARE_SERIALIZED_PROJECTION_MAX_BYTES,
  HOSTED_VAULT_SHARE_WORKOUT_TIME_SEMANTICS,
  parseHostedVaultShareDeliverRequest,
  parseHostedVaultShareProjectionScope,
  parseHostedVaultShareProjectionScopeKey,
  type HostedVaultShareProjectionScope,
} from "../src/vault-share.ts";
import {
  HOSTED_GROUP_SHARED_HISTORY_PAGE_MAX_BYTES,
  pageHostedGroupSharedHistory,
  parseHostedGroupSharedDateCoverage,
  parseHostedGroupSharedReadOptions,
} from "../src/group-shared-history.ts";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");
const date = (age: number) => new Date(NOW - age * 86_400_000).toISOString().slice(0, 10);
const STEPS: HostedVaultShareProjectionScope = { projectionKind: "steps-days.v0" };
const source = (index: number) => ({ source: `source-${index}`, label: `source-${index}` });
const records = (days: number, sources = 8) => Array.from({ length: days }, (_, age) =>
  Array.from({ length: sources }, (_, index) => ({
    recordKey: `${date(age)}.source-${index}`, occurredAt: `${date(age)}T00:00:00.000Z`,
    data: { date: date(age), metricKey: "steps", unit: "count", value: 1000 }, source: source(index),
  }))
).flat();
const deliver = (projectionScope: HostedVaultShareProjectionScope, values: unknown[]) =>
  parseHostedVaultShareDeliverRequest({
    projectionScope, records: values, memberTimeZone: "UTC",
    expectedGenerationToken: "a".repeat(43), sourceWorkspaceVersion: "7",
  });

describe("plain metric shared history", () => {
  it("has one plain identity per metric and retains only the pre-existing sleep aliases", () => {
    assert.equal(key(STEPS), "steps-days.v0");
    const keys = HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES.map(key);
    assert.equal(keys.length, 100);
    assert.equal(HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.length, 99);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(parseHostedVaultShareActiveProjectionKindsResponse({
      projectionScopes: HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES,
    }).projectionScopes.length, 100);
    assert.throws(() => parseHostedVaultShareActiveProjectionKindsResponse({
      projectionScopes: [...HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES, STEPS],
    }), /too many scopes/);
    assert.throws(() => parseHostedVaultShareActiveProjectionKindsResponse({
      projectionKinds: [...HOSTED_VAULT_SHARE_PROJECTION_KINDS, "steps-days.v0"],
    }), /too many kinds/);
    assert.ok(keys.every((value) => !value.includes("historyDays")));
    for (const scope of HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES) {
      assert.deepEqual(parseHostedVaultShareProjectionScopeKey(key(scope), "scope"), scope);
      assert.deepEqual(parseHostedVaultShareProjectionScope(scope, "scope"), scope);
    }
    for (const value of [7, 89, 90, 91, "90", null]) {
      assert.throws(() => parseHostedVaultShareProjectionScope({ ...STEPS, historyDays: value }, "scope"));
    }
    assert.throws(() => parseHostedVaultShareProjectionScopeKey("steps-days.v0.historyDays.90", "scope"));
    assert.equal(getHostedVaultShareProjectionMaxRecords(STEPS), 720);
    assert.equal(getHostedVaultShareProjectionMaxRecords({ projectionKind: "protein-days.v0" }), 90);
    assert.equal(getHostedVaultShareProjectionMaxRecords({ projectionKind: "time-zone.v0" }), 8);
    assert.deepEqual(hostedVaultShareReadAuthorityScopes(STEPS), [STEPS]);
    assert.deepEqual(hostedVaultShareReadAuthorityScopes({ projectionKind: "deep-sleep-days.v0" }), [
      { projectionKind: "deep-sleep-days.v0" }, { projectionKind: "deep-sleep-sources-days.v1" },
    ]);
  });

  it("clips today and 89 previous civil dates across DST and the date line", () => {
    for (const timeZone of ["UTC", "America/New_York", "Pacific/Kiritimati", "Etc/GMT+12"]) {
      for (const instant of [NOW, Date.parse("2026-03-09T01:00:00Z"), Date.parse("2026-11-02T01:00:00Z")]) {
        const window = hostedVaultShareHistoryDateWindow({ nowMs: instant, timeZone, historyDays: 90 });
        assert.equal(Date.parse(window.through) - Date.parse(window.from), 89 * 86_400_000);
        const dates = [window.from, window.through,
          new Date(Date.parse(window.from) - 86_400_000).toISOString().slice(0, 10),
          new Date(Date.parse(window.through) + 86_400_000).toISOString().slice(0, 10)];
        const input = dates.map((day) => ({ ...records(1, 1)[0]!,
          recordKey: day, occurredAt: `${day}T00:00:00.000Z`, data: { ...records(1, 1)[0]!.data, date: day } }));
        assert.deepEqual(clip({ records: input, scope: STEPS, timeZone, nowMs: instant })
          .map((record) => record.occurredAt.slice(0, 10)), [window.from, window.through]);
      }
    }
    assert.equal(clip({ records: records(90), scope: STEPS, timeZone: "UTC", nowMs: NOW, requestedHistoryDays: 7 }).length, 56);
    assert.equal(clip({ records: records(90), scope: STEPS, timeZone: "UTC", nowMs: NOW, requestedHistoryDays: 90 }).length, 720);
  });

  it("admits all 720 source/dates and rejects overflow without truncation", () => {
    assert.equal(deliver(STEPS, records(90)).records.length, 720);
    assert.equal(deliver(STEPS, records(7)).records.length, 56);
    assert.equal(deliver(STEPS, records(8)).records.length, 64);
    assert.throws(() => deliver(STEPS, records(91)));
    assert.throws(() => deliver(STEPS, records(1, 9)));
  });

  it("keeps every source/workout in an admitted worst-width 90-day snapshot and each date page", () => {
    // Maximum public-source count, workouts/source, source-key/kind lengths,
    // canonical 80-character labels, and 96-character source revisions.
    const workouts = Array.from({ length: 8 }, (_, index) => Array.from({ length: 13 }, (_, ordinal) => ({
      kind: "x".repeat(80), minutes: 0.0000030024105450300988,
      startLocalMs: ordinal * 1000,
      source: { source: `${index === 0 ? "a" : String.fromCharCode(97 + index)}${"x".repeat(79)}`, label: `${String.fromCharCode(97 + index)}${"x".repeat(79)}` },
    }))).flat();
    const values = Array.from({ length: 90 }, (_, age) => ({
      occurredAt: `${date(age)}T00:00:00.000Z`, recordKey: date(age), sourceRevision: "A".repeat(96),
      data: { date: date(age), workouts, calendarClosedThroughDate: date(1), timeSemantics: HOSTED_VAULT_SHARE_WORKOUT_TIME_SEMANTICS },
    }));
    const scope: HostedVaultShareProjectionScope = { projectionKind: "workouts.v0" };
    const admitted = deliver(scope, values);
    assert.ok(Buffer.byteLength(JSON.stringify(admitted)) < HOSTED_VAULT_SHARE_SERIALIZED_PROJECTION_MAX_BYTES - 1024);
    const seen: typeof admitted.records = [];
    let fromDate = date(89);
    for (let pageCount = 0; pageCount < 90; pageCount++) {
      const page = pageHostedGroupSharedHistory(admitted.records, { fromDate, throughDate: date(0) });
      assert.ok(page.records.length > 0);
      assert.ok(Buffer.byteLength(JSON.stringify(page.records)) <= HOSTED_GROUP_SHARED_HISTORY_PAGE_MAX_BYTES);
      assert.deepEqual(parseHostedGroupSharedDateCoverage(page.dateCoverage), page.dateCoverage);
      for (const record of page.records) assert.equal("workouts" in record.data && record.data.workouts.length, 104);
      seen.push(...page.records);
      if (!page.dateCoverage.nextFromDate) break;
      fromDate = page.dateCoverage.nextFromDate;
    }
    assert.equal(seen.length, 90);
    assert.equal(new Set(seen.map((record) => record.recordKey)).size, 90);
    const tooMany = { ...values[0]!, data: { ...values[0]!.data, workouts: [...workouts, workouts[0]!] } };
    assert.throws(() => deliver(scope, [tooMany]));
    assert.throws(() => parseHostedVaultShareDeliverRequest({ ...admitted,
      padding: "x".repeat(HOSTED_VAULT_SHARE_SERIALIZED_PROJECTION_MAX_BYTES) }));
  });

  it("leaves ordinary reads weekly and requires bounded single-member history", () => {
    assert.deepEqual(parseHostedGroupSharedReadOptions({}, [STEPS]), {});

    const options = { participantId: "participant-synthetic", history: { fromDate: date(89), throughDate: date(0) } };
    assert.deepEqual(parseHostedGroupSharedReadOptions(options, [STEPS]), options);
    assert.throws(() => parseHostedGroupSharedReadOptions({ history: options.history }, [STEPS]));
    assert.throws(() => parseHostedGroupSharedReadOptions(options, [{ projectionKind: "profile-name.v0" }]));
    assert.throws(() => parseHostedGroupSharedReadOptions({ ...options, freshness: {} }, [STEPS]));
    assert.throws(() => parseHostedGroupSharedReadOptions({ ...options, history: { fromDate: date(90), throughDate: date(0) } }, [STEPS]));
    assert.throws(() => parseHostedGroupSharedReadOptions(options, [STEPS, STEPS]));
  });

  it("never splits sources, handles exact byte boundaries, and discloses empty coverage", () => {
    const day = date(0);
    const base = { occurredAt: `${day}T00:00:00.000Z`, padding: "" };
    const bytes = Buffer.byteLength(JSON.stringify([base]));
    const record = { ...base, padding: "x".repeat(HOSTED_GROUP_SHARED_HISTORY_PAGE_MAX_BYTES - bytes) };
    const history = { fromDate: day, throughDate: day };
    assert.equal(pageHostedGroupSharedHistory([record], history).records.length, 1);
    assert.throws(() => pageHostedGroupSharedHistory([{ ...record, padding: record.padding + "x" }], history));
    const page = pageHostedGroupSharedHistory(records(90), { fromDate: date(89), throughDate: day });
    for (const available of page.dateCoverage.availableDates) {
      assert.equal(page.records.filter((value) => value.data.date === available).length, 8);
    }
    assert.deepEqual(pageHostedGroupSharedHistory([], history).dateCoverage.availableDates, []);
    // Two sparse dates, eight observations each; neither a date nor its sources
    // may be split to fill a page, and the intervening gap is not observed zero.
    const sparse = [date(89), day].flatMap((value) => Array.from({ length: 8 }, (_, index) => ({
      occurredAt: `${value}T00:00:00.000Z`, recordKey: `${value}.source-${index}`,
      padding: "x".repeat(20_000),
    })));
    const first = pageHostedGroupSharedHistory(sparse, { fromDate: date(89), throughDate: day });
    assert.equal(first.records.length, 8);
    assert.deepEqual(first.dateCoverage.availableDates, [date(89)]);
    assert.ok(first.dateCoverage.nextFromDate);
    const second = pageHostedGroupSharedHistory(sparse, {
      fromDate: first.dateCoverage.nextFromDate!, throughDate: day,
    });
    assert.equal(second.records.length, 8);
    assert.deepEqual(second.dateCoverage.availableDates, [day]);
    assert.equal(second.dateCoverage.nextFromDate, undefined);
  });
});
