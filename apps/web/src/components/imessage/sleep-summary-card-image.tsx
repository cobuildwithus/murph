import {
  formatSleepCardClock,
  formatSleepCardDuration,
  type SleepSummaryResponseCardV1,
} from "@murphai/contracts";
import {
  IMESSAGE_CARD_COLOR,
  IMESSAGE_CARD_HEADER_BESIDE_BADGE_INSET,
  IMESSAGE_CARD_HORIZONTAL_PADDING,
} from "./card-image-chrome";

const SCALE = 3.75;
const px = (points: number) => points * SCALE;
const CREAM = "#FFF5E5";
const { primary, secondary, divider, progressTrack } = IMESSAGE_CARD_COLOR;

type Segment = {
  label: string;
  minutes: number;
  background: string;
  color: string;
  labelColor: string;
  width: number;
};

export function getSleepSummaryCardImageSize(card: SleepSummaryResponseCardV1) {
  const clockHeight = card.bedtime !== null ? 20 : 0;
  const metricsHeight = metrics(card).length > 0 ? 38 : 0;
  return { width: 1200, height: Math.ceil(px(150 + clockHeight + metricsHeight)) };
}

function segments(card: SleepSummaryResponseCardV1): Segment[] {
  const values = card.stages ? [
    { label: "DEEP", minutes: card.stages.deepMinutes, background: "#2A2522", color: CREAM, labelColor: "rgba(255,245,229,0.70)" },
    { label: "REM", minutes: card.stages.remMinutes, background: "#7A706A", color: CREAM, labelColor: "rgba(255,245,229,0.75)" },
    { label: "LIGHT", minutes: card.stages.lightMinutes, background: "#CDBFAE", color: primary, labelColor: "rgba(20,18,23,0.60)" },
  ].filter((segment) => segment.minutes > 0) : [{ label: "ASLEEP", minutes: card.totalSleepMinutes, background: "#7A706A", color: CREAM, labelColor: "rgba(255,245,229,0.75)" }];
  if (card.awakeMinutes !== null) values.push({ label: "AWAKE", minutes: card.awakeMinutes, background: "#EBDDC8", color: primary, labelColor: secondary });
  const width = 292 - 2 * (values.length - 1);
  const total = values.reduce((sum, segment) => sum + segment.minutes, 0);
  const result = values.map((segment) => ({
    ...segment,
    width: Math.max(segment.label === "AWAKE" ? 10 : 6, width * segment.minutes / total),
  }));
  const excess = result.reduce((sum, segment) => sum + segment.width, 0) - width;
  const widest = result.reduce((best, segment) => segment.width > best.width ? segment : best);
  widest.width -= excess;
  return result;
}

type Metric = { icon: "eye" | "bed" | "pulse" | "heart"; value: string; unit: string; label: string };
function metrics(card: SleepSummaryResponseCardV1): Metric[] {
  const result: Metric[] = [];
  if (card.wakeUps !== null) result.push({ icon: "eye", value: String(card.wakeUps), unit: "", label: "Wake-ups" });
  if (card.efficiencyPercent !== null) result.push({ icon: "bed", value: `${card.efficiencyPercent}%`, unit: "", label: "Sleep efficiency" });
  if (card.hrv !== null) result.push({ icon: "pulse", value: String(card.hrv.milliseconds), unit: "ms", label: "Heart rate variability" });
  if (card.restingHeartRate !== null) result.push({ icon: "heart", value: String(card.restingHeartRate), unit: "bpm", label: "Resting heart rate" });
  return result;
}

/** Immutable static default state. Messages owns the outer mask and badge. */
export function SleepSummaryCardImage({ card }: { card: SleepSummaryResponseCardV1 }) {
  const groups = metrics(card);
  const bar = segments(card);
  const hours = Math.floor(card.totalSleepMinutes / 60);
  const minutes = card.totalSleepMinutes % 60;
  return (
    <div data-design-contract="imessage-sleep-summary-card" style={{
      display: "flex", flexDirection: "column", width: "100%", height: "100%",
      padding: `${px(12)}px ${px(14)}px ${px(8)}px`,
      backgroundColor: CREAM, color: primary, fontFamily: "DM Sans",
    }}>
      <div style={{
        display: "flex", height: px(27), flexShrink: 0,
        marginLeft: IMESSAGE_CARD_HORIZONTAL_PADDING + IMESSAGE_CARD_HEADER_BESIDE_BADGE_INSET - px(14),
        fontSize: px(17), fontWeight: 600, lineHeight: 1.2,
      }}>Sleep</div>
      <div style={{
        display: "flex", position: "relative", alignItems: "baseline", gap: px(8),
        height: px(46), marginTop: px(7), marginBottom: px(10), flexShrink: 0,
      }}>
        {hours > 0 && <DurationPair value={hours} unit="h" />}
        {(minutes > 0 || hours === 0) && <DurationPair value={minutes} unit="m" />}
        {card.score !== null && <ScoreRing score={card.score} />}
      </div>
      <div aria-label="Sleep stages" style={{ display: "flex", gap: px(2), height: px(40), flexShrink: 0 }}>
        {bar.map((segment, index) => {
          const duration = formatSleepCardDuration(segment.minutes);
          // The heading already shows the total, so the one block without
          // stages carries only its name, matching the native card.
          const isAsleep = segment.label === "ASLEEP";
          const showValue = !isAsleep && segment.label !== "AWAKE" && segment.width >= 16 + duration.length * 7;
          const showLabel = isAsleep || (showValue && segment.width >= Math.max(
            18 + segment.label.length * 7, 24 + duration.length * 7,
          ));
          const leftRadius = px(index === 0 ? 10 : 3);
          const rightRadius = px(index === bar.length - 1 ? 10 : 3);
          return (
            <div key={segment.label} aria-label={`${segment.label} ${duration}`} data-sleep-segment={segment.label} style={{
              display: "flex", flexDirection: "column", justifyContent: "center",
              width: px(segment.width), height: px(40), flexShrink: 0, overflow: "hidden",
              paddingLeft: showValue || isAsleep ? px(segment.label === "DEEP" ? 9 : 8) : 0,
              backgroundColor: segment.background,
              ...(segment.label === "AWAKE" ? { border: "1px solid rgba(122,112,106,0.35)" } : {}),
              borderRadius: `${leftRadius}px ${rightRadius}px ${rightRadius}px ${leftRadius}px`,
            }}>
              {showLabel && <div style={{
                display: "flex", fontSize: px(11), fontWeight: 600,
                color: segment.labelColor, lineHeight: 1.15,
              }}>{segment.label}</div>}
              {showValue && <div style={{
                display: "flex", fontSize: px(14), fontWeight: 600,
                color: segment.color, lineHeight: 1.15, whiteSpace: "nowrap",
              }}>{duration}</div>}
            </div>
          );
        })}
      </div>
      {card.bedtime !== null && card.wakeTime !== null && <div style={{
        display: "flex", justifyContent: "space-between", marginTop: px(6), height: px(14),
        flexShrink: 0, fontSize: px(11), fontWeight: 600, color: secondary,
      }}>
        <span>{formatSleepCardClock(card.bedtime)}</span>
        <span>{formatSleepCardClock(card.wakeTime)}</span>
      </div>}
      {groups.length > 0 && <div data-sleep-metrics="true" style={{
        display: "flex", alignItems: "center",
        justifyContent: groups.length === 4 ? "space-between" : "flex-start",
        gap: groups.length === 4 ? 0 : px(26), borderTop: `1px solid ${divider}`,
        marginTop: px(10), paddingTop: px(6), paddingBottom: px(6), height: px(28), flexShrink: 0,
      }}>
        {groups.map((group) => <div key={group.icon} aria-label={`${group.label} ${group.value} ${group.unit}`} style={{ display: "flex", alignItems: "center", gap: px(6) }}>
          <MetricIcon kind={group.icon} />
          <div style={{ display: "flex", alignItems: "baseline", gap: px(3), whiteSpace: "nowrap" }}>
            <span style={{ fontSize: px(15), fontWeight: 600 }}>{group.value}</span>
            {group.unit && <span style={{ fontSize: px(11), fontWeight: 500, color: secondary }}>{group.unit}</span>}
          </div>
        </div>)}
      </div>}
    </div>
  );
}

function DurationPair({ value, unit }: { value: number; unit: string }) {
  return <div style={{ display: "flex", alignItems: "baseline", gap: px(3) }}>
    <span style={{
      fontSize: px(38), fontWeight: 600, lineHeight: 1,
      letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums",
    }}>{value}</span>
    <span style={{ fontSize: px(15), fontWeight: 500, color: secondary }}>{unit}</span>
  </div>;
}

function ScoreRing({ score }: { score: number }) {
  const radius = 22.5;
  const circumference = 2 * Math.PI * radius;
  return <div aria-label={`Sleep score ${score}`} style={{
    display: "flex", position: "absolute", right: 0, top: -px(4),
    width: px(50), height: px(50), alignItems: "center", justifyContent: "center",
  }}>
    <svg width={px(50)} height={px(50)} viewBox="0 0 50 50" style={{ position: "absolute", top: 0, left: 0 }}>
      <circle cx="25" cy="25" r={radius} fill="none" stroke={progressTrack} strokeWidth="5" />
      {score > 0 && <circle
        cx="25" cy="25" r={radius} fill="none" stroke={primary} strokeWidth="5"
        strokeLinecap="round" strokeDasharray={`${circumference * score / 100} ${circumference}`}
        transform="rotate(-90 25 25)"
      />}
    </svg>
    <span style={{ fontSize: px(16), fontWeight: 700 }}>{score}</span>
  </div>;
}

function MetricIcon({ kind }: { kind: Metric["icon"] }) {
  const paths = {
    eye: "M1.5 8s2.6-4.6 6.5-4.6S14.5 8 14.5 8s-2.6 4.6-6.5 4.6S1.5 8 1.5 8z",
    bed: "M1.5 4v9M1.5 10h13v3M14.5 10V8.6A2.1 2.1 0 0 0 12.4 6.5H7v3.5",
    pulse: "M1 8.5h3l1.6-4.5 2.8 8.5 1.8-5.5.9 1.5H15",
    heart: "M8 13.6S1.8 10 1.8 5.9A3.2 3.2 0 0 1 8 4.4a3.2 3.2 0 0 1 6.2 1.5C14.2 10 8 13.6 8 13.6z",
  };
  return <svg
    aria-hidden="true" width={px(16)} height={px(16)} viewBox="0 0 16 16"
    fill="none" stroke={secondary} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
  >
    <path d={paths[kind]} />
    {kind === "eye" && <circle cx="8" cy="8" r="2" fill={secondary} stroke="none" />}
    {kind === "bed" && <circle cx="4.3" cy="7.6" r="1.4" />}
  </svg>;
}
