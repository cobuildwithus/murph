import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeVault, withCanonicalWriteLock } from "@murphai/core";
import { resolveWearableSleepCardNight, summarizeWearableDayRuntime, summarizeWearableRecoveryRuntime } from "../src/index.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

type Night = { date: string; total?: number; start?: string; end?: string; zone?: string; type?: string; state?: string; rhr?: number; hrv?: number; lowestHr?: number; provider?: string };
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
    if (night.hrv !== undefined) rows.push({ ...base, id: `evt_synthetic_hrv_${i}`, kind: "observation", title: "Synthetic sleep HRV", metric: "hrv", value: night.hrv, unit: "ms", externalRef: { ...ref, facet: "hrv" } });
    if (night.lowestHr !== undefined) rows.push({ ...base, id: `evt_synthetic_lowest_hr_${i}`, kind: "observation", title: "Synthetic lowest sleep HR", metric: "lowestHeartRate", value: night.lowestHr, unit: "bpm", externalRef: { ...ref, facet: "lowestHeartRate" } });
  }
  for (const [i, [at, value]] of sdnn.entries()) rows.push({ schemaVersion: "murph.event.v1", source: "device", id: `evt_synthetic_sdnn_${i}`, kind: "observation", title: "Synthetic SDNN", occurredAt: at, recordedAt: at, metric: "hrv-sdnn", value, unit: "ms", externalRef: { system: "apple_health", resourceType: "metric", resourceId: `synthetic-sdnn-${i}`, facet: "hrv-sdnn" } });
  await withCanonicalWriteLock(root, async () => {
    await mkdir(path.join(root, "ledger/events/2026"), { recursive: true });
    await writeFile(path.join(root, "ledger/events/2026/2026-11.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  });
  return root;
}

describe("sleep card night resolver", () => {
  it("joins recovery by localized wake date while retaining the selected night's HRV", async () => {
    const root = await vault([{ date: "2026-11-02", start: "2026-11-02T15:00:00Z", end: "2026-11-02T23:00:00Z", zone: "Asia/Tokyo", total: 420, rhr: 63, hrv: 72, provider: "whoop" }, { date: "2026-11-03", total: 100, rhr: 57, hrv: 81, provider: "whoop" }], "America/New_York");
    const result = await resolveWearableSleepCardNight(root, { wakeDate: "2026-11-03" });
    expect(result?.night.date).toBe("2026-11-02");
    expect(result?.timeZone).toBe("Asia/Tokyo");
    expect(result?.recovery?.date).toBe("2026-11-03");
    expect(result?.recovery?.restingHeartRate.selection.value).toBe(57);
    expect(result?.night.hrv.selection.value).toBe(72);
    expect((await summarizeWearableDayRuntime(root, "2026-11-03"))?.sleep?.totalSleepMinutes.selection.value).toBe(100);
  });
  it("prefers the night's wearable over the cross-provider recovery winner", async () => {
    const root = await vault([
      { date: "2026-11-03", start: "2026-11-02T23:00:00Z", end: "2026-11-03T07:00:00Z", total: 420, rhr: 62, hrv: 84, provider: "oura" },
      { date: "2026-11-03", rhr: 54, hrv: 70, provider: "whoop" },
    ]);
    expect((await summarizeWearableRecoveryRuntime(root, { date: "2026-11-03" }))[0]?.restingHeartRate.selection).toMatchObject({ provider: "whoop", value: 54 });
    const result = await resolveWearableSleepCardNight(root, { wakeDate: "2026-11-03" });
    expect(result?.night.provider).toBe("oura");
    expect(result?.recovery?.restingHeartRate.selection).toMatchObject({ provider: "oura", value: 62 });
    expect(result?.night.hrv.selection).toMatchObject({ provider: "oura", value: 84 });
  });
  it("falls back on the wake date only when the night's provider has no resting HR", async () => {
    const root = await vault([
      { date: "2026-11-02", start: "2026-11-02T23:00:00Z", end: "2026-11-03T07:00:00Z", total: 420, rhr: 62, provider: "oura" },
      { date: "2026-11-03", hrv: 84, provider: "oura" },
      { date: "2026-11-03", rhr: 54, provider: "whoop" },
    ]);
    const result = await resolveWearableSleepCardNight(root, { wakeDate: "2026-11-03" });
    expect(result?.recovery?.date).toBe("2026-11-03");
    expect(result?.recovery?.restingHeartRate.selection).toMatchObject({ provider: "whoop", value: 54 });
  });
  it("uses the total's provider for a night without a sleep window", async () => {
    const root = await vault([{ date: "2026-11-03", total: 420, rhr: 62, provider: "oura" }, { date: "2026-11-03", rhr: 54, provider: "whoop" }]);
    const result = await resolveWearableSleepCardNight(root, { wakeDate: "2026-11-03" });
    expect(result?.night.provider).toBeNull();
    expect(result?.recovery?.restingHeartRate.selection).toMatchObject({ provider: "oura", value: 62 });
  });
  it.each([true, false])("does not mistake the recovery reader's lowest-HR fallback for resting HR (other RHR: %s)", async (otherRestingHr) => {
    const root = await vault([
      { date: "2026-11-03", start: "2026-11-02T23:00:00Z", end: "2026-11-03T07:00:00Z", total: 420, lowestHr: 48, provider: "oura" },
      ...(otherRestingHr ? [{ date: "2026-11-03", rhr: 54, provider: "whoop" }] : []),
    ]);
    expect((await summarizeWearableRecoveryRuntime(root, { date: "2026-11-03", providers: ["oura"] }))[0]?.restingHeartRate.selection).toMatchObject({ value: 48, fallbackFromMetric: "lowestHeartRate" });
    const result = await resolveWearableSleepCardNight(root, { wakeDate: "2026-11-03" });
    expect(result?.recovery?.restingHeartRate.selection.value ?? null).toBe(otherRestingHr ? 54 : null);
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
