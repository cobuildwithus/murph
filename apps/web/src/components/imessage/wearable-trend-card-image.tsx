import {
  averageWearableTrendValues,
  formatWearableTrendDateRange,
  formatWearableTrendDirection,
  formatWearableTrendMetricAverage,
  formatWearableTrendMetricValue,
  formatWearableTrendWeekdayLabels,
  renderWearableTrendSparkline,
  wearableTrendMetricDisplayByKey,
  type WearableTrendResponseCardV1,
} from "@murphai/contracts";

import {
  IMessageCardHeader,
  IMESSAGE_CARD_COLOR,
} from "./card-image-chrome";

export const IMESSAGE_WEARABLE_TREND_CARD_IMAGE_WIDTH = 1_200;

const CARD_HORIZONTAL_PADDING = 45;
const CARD_VERTICAL_PADDING = 38;
const HEADER_HEIGHT = 183;
const AXIS_MARGIN_TOP = 25;
const AXIS_HEIGHT = 40;
const AXIS_MARGIN_BOTTOM = 22;
const METRIC_ROW_HEIGHT = 170;
const BOTTOM_PADDING = 42;
const METRIC_SUMMARY_WIDTH = 320;
const SERIES_GAP = 20;
const AXIS_FONT_SIZE = 36;
const METRIC_LABEL_FONT_SIZE = 42;
const METRIC_SUMMARY_FONT_SIZE = 36;
const METRIC_VALUE_FONT_SIZE = 38;
const SLEEP_METRIC_VALUE_FONT_SIZE = 32;
const SPARK_HEIGHT_BY_CHARACTER = {
  "▁": 8,
  "▂": 12,
  "▃": 16,
  "▄": 20,
  "▅": 24,
  "▆": 28,
  "▇": 32,
  "█": 36,
} as const;

export function getWearableTrendCardImageSize(
  card: WearableTrendResponseCardV1,
): { height: number; width: number } {
  return {
    width: IMESSAGE_WEARABLE_TREND_CARD_IMAGE_WIDTH,
    height: CARD_VERTICAL_PADDING
      + HEADER_HEIGHT
      + AXIS_MARGIN_TOP
      + AXIS_HEIGHT
      + AXIS_MARGIN_BOTTOM
      + card.metrics.length * METRIC_ROW_HEIGHT
      + BOTTOM_PADDING,
  };
}

/**
 * Read-only static fallback for a trusted seven-calendar-day wearable card.
 * Messages supplies the outer mask; this bitmap preserves every day, including
 * missing observations, in the same position for every metric.
 */
export function WearableTrendCardImage({
  card,
  logoSrc = "/icons/murph-mark.svg",
}: {
  card: WearableTrendResponseCardV1;
  logoSrc?: string;
}) {
  const size = getWearableTrendCardImageSize(card);
  const dateRange = formatWearableTrendDateRange(card.localDates);
  const weekdayLabels = formatWearableTrendWeekdayLabels(card.localDates);

  return (
    <div
      aria-label={`7-day health, ${dateRange}`}
      data-design-contract="imessage-native-wearable-trend-card"
      role="group"
      style={{
        display: "flex",
        width: size.width,
        height: size.height,
        boxSizing: "border-box",
        flexDirection: "column",
        padding: `${CARD_VERTICAL_PADDING}px ${CARD_HORIZONTAL_PADDING}px ${BOTTOM_PADDING}px`,
        backgroundColor: IMESSAGE_CARD_COLOR.balloon,
        color: IMESSAGE_CARD_COLOR.primary,
        fontFamily: "DM Sans",
      }}
    >
      <IMessageCardHeader
        height={HEADER_HEIGHT}
        logoSrc={logoSrc}
        subtitle={{ lineCount: 1, text: dateRange }}
        title={{ lineCount: 1, text: "7-day health" }}
      />

      <DayAxis localDates={card.localDates} weekdayLabels={weekdayLabels} />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
        }}
      >
        {card.metrics.map((metric) => (
          <MetricRow
            key={metric.metricKey}
            localDates={card.localDates}
            metric={metric}
            weekdayLabels={weekdayLabels}
          />
        ))}
      </div>
    </div>
  );
}

function DayAxis({
  localDates,
  weekdayLabels,
}: {
  localDates: WearableTrendResponseCardV1["localDates"];
  weekdayLabels: string[];
}) {
  return (
    <div
      data-wearable-trend-day-axis="shared"
      style={{
        display: "flex",
        height: AXIS_HEIGHT,
        alignItems: "center",
        marginTop: AXIS_MARGIN_TOP,
        marginBottom: AXIS_MARGIN_BOTTOM,
      }}
    >
      <div
        style={{
          display: "flex",
          width: METRIC_SUMMARY_WIDTH,
          flexShrink: 0,
          alignItems: "center",
          color: IMESSAGE_CARD_COLOR.secondary,
          fontSize: 24,
          fontWeight: 600,
          letterSpacing: "0.06em",
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        AVG · VS PRIOR 7D
      </div>
      <div
        aria-hidden="true"
        style={{
          display: "flex",
          minWidth: 0,
          flex: 1,
          marginLeft: SERIES_GAP,
        }}
      >
        <SevenColumns>
          {localDates.map((localDate, index) => (
            <div
              key={localDate}
              style={{
                display: "flex",
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                color: IMESSAGE_CARD_COLOR.secondary,
                fontSize: AXIS_FONT_SIZE,
                fontWeight: 600,
                letterSpacing: "0.08em",
                lineHeight: 1,
              }}
            >
              {(weekdayLabels[index] ?? "").toUpperCase()}
            </div>
          ))}
        </SevenColumns>
      </div>
    </div>
  );
}

function MetricRow({
  localDates,
  metric,
  weekdayLabels,
}: {
  localDates: WearableTrendResponseCardV1["localDates"];
  metric: WearableTrendResponseCardV1["metrics"][number];
  weekdayLabels: string[];
}) {
  const presentation = wearableTrendMetricDisplayByKey[metric.metricKey];
  const average = averageWearableTrendValues(metric.values);
  const renderedAverage = formatWearableTrendMetricAverage(
    metric.metricKey,
    metric.values,
  );
  const trend = formatWearableTrendDirection(metric.trend);
  const sparkline = renderWearableTrendSparkline(metric.values);
  const valueLabels = metric.values.map((value) =>
    value === null
      ? "no data"
      : formatWearableTrendMetricValue(metric.metricKey, value)
  );
  const accessibilityLabel = [
    presentation.displayName,
    average === null ? "average unavailable" : `${renderedAverage} average`,
    `${trend} versus prior seven days`,
    ...localDates.map((_localDate, index) =>
      `${weekdayLabels[index] ?? "Day"} ${valueLabels[index] ?? "no data"}`
    ),
  ].join(", ");

  return (
    <div
      aria-label={accessibilityLabel}
      data-metric-key={metric.metricKey}
      role="group"
      style={{
        display: "flex",
        height: METRIC_ROW_HEIGHT,
        alignItems: "center",
        borderTop: `2px solid ${IMESSAGE_CARD_COLOR.divider}`,
      }}
    >
      <div
        style={{
          display: "flex",
          width: METRIC_SUMMARY_WIDTH,
          flexShrink: 0,
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 9,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: METRIC_LABEL_FONT_SIZE,
            fontWeight: 600,
            letterSpacing: "0.055em",
            lineHeight: 1,
          }}
        >
          {presentation.compactLabel}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            color: IMESSAGE_CARD_COLOR.secondary,
            fontSize: METRIC_SUMMARY_FONT_SIZE,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1.15,
            whiteSpace: "nowrap",
          }}
        >
          {renderedAverage} · {trend}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          minWidth: 0,
          flex: 1,
          flexDirection: "column",
          gap: 10,
          marginLeft: SERIES_GAP,
        }}
      >
        <SevenColumns>
          {metric.values.map((value, index) => (
            <div
              key={localDates[index]}
              data-day-value={value === null ? "missing" : "observed"}
              style={{
                display: "flex",
                minWidth: 0,
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                color: value === null
                  ? IMESSAGE_CARD_COLOR.secondary
                  : IMESSAGE_CARD_COLOR.primary,
                fontSize: metric.metricKey === "total-sleep-minutes"
                  ? SLEEP_METRIC_VALUE_FONT_SIZE
                  : METRIC_VALUE_FONT_SIZE,
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
                whiteSpace: "nowrap",
              }}
            >
              {formatWearableTrendMetricValue(metric.metricKey, value)}
            </div>
          ))}
        </SevenColumns>

        <SevenColumns
          ariaHidden
          dataSparkline={sparkline}
        >
          {Array.from(sparkline).map((character, index) => (
            <SparkPosition
              character={character}
              key={localDates[index]}
            />
          ))}
        </SevenColumns>
      </div>
    </div>
  );
}

function SparkPosition({ character }: { character: string }) {
  const height = SPARK_HEIGHT_BY_CHARACTER[
    character as keyof typeof SPARK_HEIGHT_BY_CHARACTER
  ];
  return (
    <div
      data-spark-position={height === undefined ? "missing" : "observed"}
      style={{
        display: "flex",
        height: 40,
        flex: 1,
        alignItems: height === undefined ? "center" : "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          width: height === undefined ? 5 : 9,
          height: height ?? 5,
          borderRadius: height === undefined ? 999 : 2,
          backgroundColor: IMESSAGE_CARD_COLOR.secondary,
        }}
      />
    </div>
  );
}

function SevenColumns({
  ariaHidden = false,
  children,
  dataSparkline,
}: {
  ariaHidden?: boolean;
  children: React.ReactNode;
  dataSparkline?: string;
}) {
  return (
    <div
      aria-hidden={ariaHidden ? "true" : undefined}
      data-sparkline={dataSparkline}
      style={{
        display: "flex",
        width: "100%",
        alignItems: "center",
      }}
    >
      {children}
    </div>
  );
}
