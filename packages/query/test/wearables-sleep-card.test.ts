import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeVault, withCanonicalWriteLock } from "@murphai/core";
import { resolveWearableSleepCardNight, summarizeWearableDayRuntime } from "../src/index.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

type Night = { date: string; total?: number; start?: string; end?: string; zone?: string; type?: string; state?: string; rhr?: number; provider?: string };
async function vault(nights: Night[], zone = "UTC", sdnn: Array<[string, number]> = []) {
  const root = await mkdtemp(path.join(tmpdir(), "sleep-card-query-")); roots.push(root);
  await initializeVault({ vaultRoot: root, timezone: zone, createdAt: "2026-01-01T00:00:00Z" });
  const rows: unknown[] = [];
  for (const [i, night] of nights.entries()) {
    const ref = { system: night.provider ?? "oura", resourceType: "sleep", resourceId: `synthetic-night-${i}` };
    const base = { schemaVersion: "murph.event.v1", source: "device", dayKey: night.date, occurredAt: night.end ?? `${night.date}T08:00:00Z`, recordedAt: `${night.date}T12:00:00Z`, ...(night.zone ? { timeZone: night.zone } : {}) };
    if (night.start && night.end) rows.push({ ...base, id: `evt_synthetic_window_${i}`, kind: "sleep_session", title: "Synthetic sleep", startAt: night.start, endAt: night.end, durationMinutes: (Date.parse(night.end) - Date.parse(night.start)) / 60_000, sleepType: night.type ?? "main_sleep", sleepState: night.state ?? "confirmed", externalRef: ref });
    if (night.total !== undefined) rows.push({ ...base, id: `evt_synthetic_total_${i}`, kind: "observation", title: "Synthetic sleep total", metric: "totalSleepMinutes", value: night.total, unit: "minutes", externalRef: { ...ref, facet: "totalSleepMinutes" } });
    if (night.rhr !== undefined) rows.push({ ...base, id: `evt_synthetic_rhr_${i}`, kind: "observation", title: "Synthetic recovery", metric: "restingHeartRate", value: night.rhr, unit: "bpm", externalRef: { ...ref, resourceType: "daily", facet: "restingHeartRate" } });
  }
  for (const [i, [at, value]] of sdnn.entries()) rows.push({ schemaVersion: "murph.event.v1", source: "device", id: `evt_synthetic_sdnn_${i}`, kind: "observation", title: "Synthetic SDNN", occurredAt: at, recordedAt: at, metric: "hrv-sdnn", value, unit: "ms", externalRef: { system: "apple_health", resourceType: "metric", resourceId: `synthetic-sdnn-${i}`, facet: "hrv-sdnn" } });
  await withCanonicalWriteLock(root, async () => {
    await mkdir(path.join(root, "ledger/events/2026"), { recursive: true });
    await writeFile(path.join(root, "ledger/events/2026/2026-11.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  });
  return root;
}

describe("sleep card night resolver", () => {
  it("localizes a previous stored date in Tokyo and joins recovery by that stored date", async () => {
    const root = await vault([{ date: "2026-11-02", start: "2026-11-02T15:18:00Z", end: "2026-11-02T23:02:00Z", zone: "Asia/Tokyo", total: 436, rhr: 45 }, { date: "2026-11-03", total: 100, rhr: 90 }], "America/New_York");
    const result = await resolveWearableSleepCardNight(root, { wakeDate: "2026-11-03" });
    expect(result?.night.date).toBe("2026-11-02");
    expect(result?.timeZone).toBe("Asia/Tokyo");
    expect(result?.recovery?.restingHeartRate.selection.value).toBe(45);
    expect((await summarizeWearableDayRuntime(root, "2026-11-03"))?.sleep?.totalSleepMinutes.selection.value).toBe(100);
  });
  it("uses the validated reporting zone when the night has no zone", async () => {
    const root = await vault([{ date: "2026-11-02", start: "2026-11-02T15:18:00Z", end: "2026-11-02T23:02:00Z", total: 436 }], "Asia/Tokyo");
    expect((await resolveWearableSleepCardNight(root, { wakeDate: "2026-11-03" }))?.timeZone).toBe("Asia/Tokyo");
  });
  it.each([{ type: "nap" }, { type: "short_sleep" }, { state: "tentative" }])("rejects ineligible completed-night evidence %j", async (classification) => {
    const root = await vault([{ date: "2026-11-03", start: "2026-11-03T00:18:00Z", end: "2026-11-03T08:02:00Z", total: 436, ...classification }]);
    expect(await resolveWearableSleepCardNight(root, { wakeDate: "2026-11-03" })).toBeNull();
  });
  it("keeps total-only unknown evidence and rejects missing or zero totals", async () => {
    const root = await vault([{ date: "2026-11-03", total: 436 }, { date: "2026-11-04", total: 0 }]);
    const result = await resolveWearableSleepCardNight(root, { wakeDate: "2026-11-03" });
    expect(result?.night.totalSleepMinutes.selection.value).toBe(436);
    expect(result?.night.sleepStartAt).toBeNull();
    expect(await resolveWearableSleepCardNight(root, { wakeDate: "2026-11-04" })).toBeNull();
    expect(await resolveWearableSleepCardNight(root, { wakeDate: "2026-11-10" })).toBeNull();
    await expect(resolveWearableSleepCardNight(root, { wakeDate: "2026-02-30" })).rejects.toThrow("Invalid sleep wake date");
  });
  it("averages only canonical SDNN points in the selected window, never daytime or another night", async () => {
    const root = await vault([{ date: "2026-11-03", start: "2026-11-03T00:18:00Z", end: "2026-11-03T08:02:00Z", total: 436, provider: "apple_health" }], "UTC", [["2026-11-03T02:00:00Z", 60], ["2026-11-03T06:00:00Z", 72], ["2026-11-03T14:00:00Z", 180], ["2026-11-02T06:00:00Z", 200]]);
    expect((await resolveWearableSleepCardNight(root, { wakeDate: "2026-11-03" }))?.sdnnMilliseconds).toBe(66);
  });
});
