import { describe, expect, it } from "vitest";
import { assistantResponseCardMatchesConversationAudience, assistantResponseCardSchema } from "../src/assistant.ts";
import { buildSleepSummaryAppCardEnvelopeV8, parseSleepSummaryAppCardEnvelopeV8, sleepSummaryResponseCardV1Schema, formatSleepCardClock, formatSleepCardDuration, formatSleepCardStageDuration } from "../src/sleep-summary-card.ts";

const complete = {
  kind: "sleep_summary", version: 1, localDate: "2026-11-03", bedtime: "00:18", wakeTime: "08:02", totalSleepMinutes: 436,
  score: 85, stages: { deepMinutes: 141, remMinutes: 118, lightMinutes: 177 }, awakeMinutes: 28, efficiencyPercent: 94,
  hrv: { milliseconds: 66, method: "rmssd" }, restingHeartRate: 45, wakeUps: 3,
};
const totalOnly = { ...complete, bedtime: null, wakeTime: null, score: null, stages: null, awakeMinutes: null, efficiencyPercent: null, hrv: null, restingHeartRate: null, wakeUps: null };

describe("sleep summary wire contract", () => {
  it("round trips exact envelope 8 and preserves every nullable key", () => {
    for (const value of [complete, totalOnly]) {
      const card = sleepSummaryResponseCardV1Schema.parse(value);
      const envelope = buildSleepSummaryAppCardEnvelopeV8(card);
      expect(Object.keys(envelope)).toEqual(["schemaVersion", "card"]);
      expect(Object.keys(envelope.card)).toEqual(["kind", "version", "localDate", "bedtime", "wakeTime", "totalSleepMinutes", "score", "stages", "awakeMinutes", "efficiencyPercent", "hrv", "restingHeartRate", "wakeUps"]);
      expect(parseSleepSummaryAppCardEnvelopeV8(JSON.parse(JSON.stringify(envelope)))).toEqual(card);
      expect(assistantResponseCardSchema.parse(card)).toEqual(card);
      expect(parseSleepSummaryAppCardEnvelopeV8({ ...envelope, schemaVersion: 7 })).toBeNull();
      expect(parseSleepSummaryAppCardEnvelopeV8({ ...envelope, identity: "synthetic" })).toBeNull();
      const { wakeUps: _wakeUps, ...missing } = card;
      expect(sleepSummaryResponseCardV1Schema.safeParse(missing).success).toBe(false);
    }
  });
  it.each([
    { localDate: "2026-02-30" }, { version: 2 }, { identity: "synthetic" }, { bedtime: null }, { wakeTime: "24:00" },
    { totalSleepMinutes: 0 }, { totalSleepMinutes: 1441 }, { totalSleepMinutes: 1.2 }, { score: -1 }, { score: 101 },
    { stages: { deepMinutes: 0, remMinutes: 0, lightMinutes: 0 } }, { stages: { deepMinutes: 1440, remMinutes: 1, lightMinutes: 0 } },
    { stages: { deepMinutes: 1, remMinutes: 1 } }, { stages: { deepMinutes: 1, remMinutes: 1, lightMinutes: 1, awake: 1 } },
    { awakeMinutes: 0 }, { efficiencyPercent: 0 }, { efficiencyPercent: 101 }, { hrv: { milliseconds: 0, method: "sdnn" } },
    { hrv: { milliseconds: 1001, method: "rmssd" } }, { hrv: { milliseconds: 50, method: "unknown" } },
    { restingHeartRate: 19 }, { restingHeartRate: 251 }, { wakeUps: -1 }, { wakeUps: 101 },
  ])("rejects malformed card %j", (change) => {
    expect(sleepSummaryResponseCardV1Schema.safeParse({ ...complete, ...change }).success).toBe(false);
  });
  it("admits zero score and wake-ups but never a group audience", () => {
    const card = sleepSummaryResponseCardV1Schema.parse({ ...complete, score: 0, wakeUps: 0 });
    for (const channel of ["linq", "telegram", null]) {
      expect(assistantResponseCardMatchesConversationAudience({ card, channel, threadIsDirect: true })).toBe(true);
      expect(assistantResponseCardMatchesConversationAudience({ card, channel, threadIsDirect: false })).toBe(false);
      expect(assistantResponseCardMatchesConversationAudience({ card, channel, threadIsDirect: null })).toBe(false);
    }
  });
  it("formats deterministic compact durations and clocks", () => {
    expect([0, 28, 60, 436].map(formatSleepCardDuration)).toEqual(["0m", "28m", "1h", "7h 16m"]);
    expect([28, 65, 120, 276].map(formatSleepCardStageDuration)).toEqual(["28m", "1h05", "2h", "4h36"]);
    expect(["00:18", "08:02", "12:00", "23:59"].map(formatSleepCardClock)).toEqual(["12:18 AM", "8:02 AM", "12:00 PM", "11:59 PM"]);
  });
});
