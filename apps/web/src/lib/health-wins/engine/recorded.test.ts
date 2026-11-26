import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { freezeHealthSelections, previewRecordedCandidate } from "../card-options";
import { buildRecordedCards, recordedActivitySummary, validateRecordedActivity } from "./recorded";
import type { RecordedActivity, RecordedActivityKind } from "./types";

const summary = {
  id: "a43b0caf-54cd-492b-8e07-3b1adfa2bc57", kind: "lift",
  startedAt: "2033-02-16T19:07:00Z", elapsedSec: 240, movingSec: 201, timerSec: 180,
} as const satisfies RecordedActivity;
const heartRate = { lowBpm: 63, avgBpm: 91.5, peakBpm: 133, perMinute: [82, null, 114, 87] };
const context = { day: "2033-02-16", hour: 19, units: "us" } as const;

function preview(activity: RecordedActivity) {
  return previewRecordedCandidate(buildRecordedCards(activity, context).candidates[0]);
}

describe("recorded timed cards", () => {
  it("uses minute averages for chart markers, names the sample peak, and preserves gaps", () => {
    const card = preview({ ...summary, heartRate });
    expect(card).toMatchObject({
      candidateId: `activity:${summary.id}:activity_heart_rate`, title: { number: "3 min", measure: "strength session" },
      subtitle: "heart rate peaked at 133",
      source_note: "Recorded on Feb 16, evening. The line shows each minute's average.",
      chart: { type: "heart_rate", perMinute: [82, null, 114, 87], low: { minute: 1, bpm: 82 }, peak: { minute: 3, bpm: 114 }, timerMinutes: 3 },
    });
    expect(JSON.stringify(card)).not.toContain("19:07");
    const repeated = preview({ ...summary, heartRate: { ...heartRate, perMinute: [98, 98, null, 98] } });
    expect(repeated.chart).toMatchObject({ low: { minute: 1, bpm: 98 }, peak: { minute: 1, bpm: 98 } });
  });

  it.each(["sauna", "cold_plunge", "lift", "other", "run", "walk"] satisfies RecordedActivityKind[])(
    "builds a duration card for a timed %s without any usable readings", kind => {
      const card = preview({ ...summary, kind });
      expect(card).toMatchObject({ candidateId: `activity:${summary.id}:activity_time`, kind: "activity_time",
        subtitle: "on a 3 min timer", source_note: "Recorded on Feb 16, evening",
        chart: { type: "duration", minutes: 201 / 60, timerMinutes: 3 } });
      expect(preview({ ...summary, kind, heartRate: { ...heartRate, perMinute: [null, null, null, null] } })).toEqual(card);
    },
  );

  it("reads a paused recording on its recording clock, as the phone draws it", () => {
    // 31 minutes from Start to Finish with a 9 minute pause: the phone sends 22 minute values.
    const paused = { ...summary, kind: "sauna", elapsedSec: 31 * 60, movingSec: 22 * 60, timerSec: 20 * 60,
      heartRate: { lowBpm: 70, avgBpm: 104, peakBpm: 131, perMinute: Array.from({ length: 22 }, (_, i) => 80 + i) } } as const;
    const card = preview(paused);
    expect(card).toMatchObject({ title: { number: "22 min", measure: "sauna" }, subtitle: "heart rate peaked at 131" });
    expect(() => validateRecordedActivity({ ...paused, heartRate: { ...paused.heartRate, perMinute: Array(31).fill(95) } }))
      .toThrow("Check the minute heart rate readings.");
  });

  it("keeps time and bpm in the same units across client settings", () => {
    const activity = { ...summary, heartRate };
    const original = buildRecordedCards(activity, context);
    for (const units of ["uk", "metric"] as const) expect(buildRecordedCards(activity, { ...context, units })).toEqual(original);
    const untimed = preview({ ...summary, elapsedSec: 37, movingSec: 29, timerSec: undefined });
    expect(untimed.title.number).toBe("29 sec");
    expect(untimed.subtitle).toBe("timed with Murph");
    expect(untimed.chart).toEqual({ type: "duration", minutes: 29 / 60 });
  });

  it("suggests an editable title from the local time or the preceding activity", () => {
    const activity = { ...summary, kind: "sauna" } as const;
    const morning = buildRecordedCards(activity, { ...context, hour: 8 });
    expect(morning.suggestedTitle).toBe("Morning sauna");
    const afterWalk = buildRecordedCards(activity, { ...context, hour: 8, previousKind: "walk" });
    expect(afterWalk.suggestedTitle).toBe("Sauna after your walk");
    expect(afterWalk.candidates).toEqual(morning.candidates);
  });

  it("accepts inclusive limits and the one-minute allowance independently of summary extremes", () => {
    const activity = { ...summary, elapsedSec: 360 * 60, movingSec: 360 * 60, timerSec: 360 * 60 };
    expect(() => validateRecordedActivity({ ...activity, heartRate: {
      lowBpm: 30, avgBpm: 120.5, peakBpm: 230, perMinute: Array(360).fill(95),
    } })).not.toThrow();
    for (const length of [3, 4, 5]) {
      expect(() => validateRecordedActivity({ ...summary, heartRate: { ...heartRate, perMinute: Array(length).fill(99) } })).not.toThrow();
    }
    expect(() => validateRecordedActivity({ ...summary, elapsedSec: 1, movingSec: 1, timerSec: 1 })).not.toThrow();
    expect(() => validateRecordedActivity({ ...summary, heartRate: {
      lowBpm: 30, avgBpm: 96, peakBpm: 230, perMinute: [30, null, 230],
    } })).not.toThrow();
  });

  it("rejects out-of-range or fractional durations", () => {
    for (const change of [
      { elapsedSec: 0 }, { elapsedSec: 360 * 60 + 1 }, { elapsedSec: 249.5 },
      { movingSec: -1 }, { movingSec: 0 }, { movingSec: 241 }, { movingSec: 0.5 },
      { timerSec: 0 }, { timerSec: 360 * 60 + 1 }, { timerSec: 4.25 },
    ]) expect(() => validateRecordedActivity({ ...summary, ...change })).toThrow();
  });

  it("rejects unordered or nonfinite summaries and readings outside the summary envelope", () => {
    for (const change of [
      { lowBpm: 29 }, { avgBpm: NaN }, { peakBpm: 231 }, { lowBpm: 92 }, { peakBpm: 91 },
      { perMinute: [62, null, null, null] }, { perMinute: [134, null, null, null] },
      { perMinute: [89.5, null, null, null] }, { perMinute: [85, NaN, null] },
      { perMinute: [null, null] }, { perMinute: Array(6).fill(null) },
    ]) expect(() => validateRecordedActivity({ ...summary, heartRate: { ...heartRate, ...change } })).toThrow();
    expect(() => validateRecordedActivity({ ...summary, elapsedSec: 360 * 60,
      heartRate: { ...heartRate, perMinute: Array(361).fill(null) },
    })).toThrow();
  });

  it("freezes each option at the canonical final spec hash and removes every measurement from the hidden version", () => {
    const activity = { ...summary, heartRate };
    const candidate = buildRecordedCards(activity, context).candidates[0];
    const display = previewRecordedCandidate(candidate);
    const hidden = display.change_options.find(option => option.id === "hide_numbers")!;
    const [frozen] = freezeHealthSelections([candidate], [{ candidateId: display.candidateId, option: hidden.id }]);
    expect(hidden.spec).toEqual(frozen.spec);
    expect(hidden.specRevision).toBe(frozen.specRevision);
    expect(hidden.specRevision).not.toBe(display.specRevision);
    const { id, ...safe } = frozen.spec;
    expect(id).toBe(display.candidateId);
    expect(safe).toEqual({
      kind: "activity_heart_rate", filter: "Fitness", theme: "fitness", title: { number: "", measure: "Strength session" },
      subtitle: "Shared without numbers.", source_note: "", chart: { type: "hidden" }, share: { caption_tips: [] },
    });
    // Canonical JSON in lexicographic object-key order, including the nested spec fields.
    const canonical = JSON.stringify({
      chart: { type: "hidden" }, filter: "Fitness", id, kind: "activity_heart_rate", share: { caption_tips: [] },
      source_note: "", subtitle: "Shared without numbers.", theme: "fitness", title: { measure: "Strength session", number: "" },
    });
    expect(hidden.specRevision).toBe(createHash("sha256").update(canonical).digest("hex"));
    // Pauses stay out of the card: only the time spent recording is shown.
    expect(preview({ ...activity, elapsedSec: 230 })).toEqual(display);
    const changed = preview({ ...activity, heartRate: { ...heartRate, peakBpm: 135 } });
    expect(changed.specRevision).not.toBe(display.specRevision);
    expect(changed.change_options[1].specRevision).toBe(hidden.specRevision);
  });

  it("persists only summary fields and excludes all minute readings", () => {
    const saved = recordedActivitySummary({ ...summary, heartRate });
    expect(saved).toEqual({ ...summary, startedAt: "2033-02-16T19:07:00.000Z",
      heartRate: { lowBpm: 63, avgBpm: 91.5, peakBpm: 133 } });
    expect(recordedActivitySummary({ ...summary, heartRate, startedAt: "2033-02-16T12:07:00-07:00" })).toEqual(saved);
  });
});
