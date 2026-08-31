import type { WearableTrendResponseCardV1 } from "@murphai/contracts";

import {
  getWearableTrendCardImageSize,
  WearableTrendCardImage,
} from "@/src/components/imessage/wearable-trend-card-image";

const COMPLETE_CARD: WearableTrendResponseCardV1 = {
  kind: "wearable_trend",
  version: 1,
  localDates: [
    "2026-08-24",
    "2026-08-25",
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
    "2026-08-29",
    "2026-08-30",
  ],
  metrics: [
    {
      metricKey: "steps",
      values: [6_800, 7_900, 9_400, 8_700, 10_200, 7_100, 9_800],
      trend: "higher",
    },
    {
      metricKey: "total-sleep-minutes",
      values: [432, 438, 428, 441, 435, 439, 434],
      trend: "steady",
    },
    {
      metricKey: "hrv-rmssd",
      values: [37, 41, 39, 45, 47, 44, 50],
      trend: "higher",
    },
  ],
};

const SPARSE_CARD: WearableTrendResponseCardV1 = {
  ...COMPLETE_CARD,
  metrics: [
    {
      metricKey: "steps",
      values: [6_800, null, null, 8_700, null, null, 9_800],
      trend: "not_enough_data",
    },
    {
      metricKey: "total-sleep-minutes",
      values: [432, 438, null, 441, null, null, 434],
      trend: "not_enough_data",
    },
    {
      metricKey: "resting-heart-rate",
      values: [58, 57, null, 56, 58, null, 55],
      trend: "steady",
    },
    {
      metricKey: "hrv-rmssd",
      values: [37, null, 39, 45, null, 44, 50],
      trend: "higher",
    },
    {
      metricKey: "hrv-sdnn",
      values: [null, 48, null, 52, null, 49, null],
      trend: "not_enough_data",
    },
  ],
};

const ALL_MISSING_CARD: WearableTrendResponseCardV1 = {
  ...COMPLETE_CARD,
  metrics: [
    {
      metricKey: "steps",
      values: [null, null, null, null, null, null, null],
      trend: "not_enough_data",
    },
    {
      metricKey: "total-sleep-minutes",
      values: [null, null, null, null, null, null, null],
      trend: "not_enough_data",
    },
    {
      metricKey: "hrv-rmssd",
      values: [null, null, null, null, null, null, null],
      trend: "not_enough_data",
    },
  ],
};

const STUDIES = [
  { card: COMPLETE_CARD, label: "Complete" },
  { card: SPARSE_CARD, label: "Sparse" },
  { card: ALL_MISSING_CARD, label: "No data" },
] as const;

export function ImessageSevenDayHealthCardStudy() {
  return (
    <div
      className="rounded-2xl border border-border bg-card p-4 sm:p-8"
      data-design-component="imessage-seven-day-health-card"
      inert
    >
      <div className="mb-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Static Messages preview
        </p>
        <h3 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-foreground">
          Seven-day health trends
        </h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          One shared day axis keeps complete, sparse, and unavailable wearable
          data easy to compare without hiding missing dates.
        </p>
      </div>

      <div className="hidden flex-col gap-8 sm:flex">
        {STUDIES.map(({ card, label }) => (
          <CardStudy key={label} card={card} label={label} scale={0.72} />
        ))}
      </div>
      <div className="flex flex-col gap-5 sm:hidden">
        {STUDIES.map(({ card, label }) => (
          <CardStudy key={label} card={card} label={label} scale={0.245} />
        ))}
      </div>
    </div>
  );
}

function CardStudy({
  card,
  label,
  scale,
}: {
  card: WearableTrendResponseCardV1;
  label: string;
  scale: number;
}) {
  const size = getWearableTrendCardImageSize(card);
  return (
    <div className="flex flex-col gap-2" data-design-state={label.toLowerCase().replace(" ", "-")}>
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <div
        className="overflow-hidden rounded-xl border border-border"
        style={{ width: size.width * scale, height: size.height * scale }}
      >
        <div
          style={{
            width: size.width,
            height: size.height,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <WearableTrendCardImage card={card} />
        </div>
      </div>
    </div>
  );
}
