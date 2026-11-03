"use client";

import type { SleepSummaryResponseCardV1 } from "@murphai/contracts";
import { SleepSummaryCardImage, getSleepSummaryCardImageSize } from "@/src/components/imessage/sleep-summary-card-image";

const COMPLETE: SleepSummaryResponseCardV1 = {
  kind: "sleep_summary", version: 1, localDate: "2026-11-03", bedtime: "00:18", wakeTime: "08:02",
  totalSleepMinutes: 436, score: 85, stages: { deepMinutes: 141, remMinutes: 118, lightMinutes: 177 },
  awakeMinutes: 28, efficiencyPercent: 94, hrv: { milliseconds: 66, method: "rmssd" }, restingHeartRate: 45, wakeUps: 3,
};
const SPECIMENS: Array<{ label: string; card: SleepSummaryResponseCardV1 }> = [
  { label: "Complete summary", card: COMPLETE },
  { label: "Apple Watch, no score", card: { ...COMPLETE, score: null, wakeUps: null, hrv: { milliseconds: 66, method: "sdnn" } } },
  { label: "Total sleep only", card: { ...COMPLETE, bedtime: null, wakeTime: null, score: null, stages: null, awakeMinutes: null, efficiencyPercent: null, hrv: null, restingHeartRate: null, wakeUps: null } },
];

export function ImessageSleepCardStudy() {
  return <div className="flex flex-wrap gap-8" inert>
    {SPECIMENS.map(({ label, card }) => {
      const size = getSleepSummaryCardImageSize(card);
      const scale = 0.25;
      return <figure key={label} className="m-0">
        <figcaption className="mb-3 text-sm text-muted-foreground">{label}</figcaption>
        <div className="overflow-hidden rounded-xl" style={{ width: size.width * scale, height: size.height * scale }}>
          <div style={{ width: size.width, height: size.height, transform: `scale(${scale})`, transformOrigin: "top left" }}><SleepSummaryCardImage card={card} /></div>
        </div>
      </figure>;
    })}
  </div>;
}
