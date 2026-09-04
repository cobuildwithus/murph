import {
  averageWearableTrendValues,
  formatWearableTrendDateRange,
  formatWearableTrendDirection,
  formatWearableTrendMetricAverage,
  formatWearableTrendMetricValue,
  formatWearableTrendWeekdayLabels,
  renderWearableTrendSparkline,
  wearableTrendMetricDisplayByKey,
  type WearableTrendDirection,
  type WearableTrendMetricKey,
  type WearableTrendResponseCardV1,
} from "@murphai/contracts";

import {
  IMessageCardHeader,
  IMESSAGE_CARD_COLOR,
  IMESSAGE_CARD_HEADER_TITLE_ROW_HEIGHT,
} from "./card-image-chrome";

export const IMESSAGE_WEARABLE_TREND_CARD_IMAGE_WIDTH = 1_200;

const CARD_HORIZONTAL_PADDING = 45;
const CARD_VERTICAL_PADDING = 38;
const HEADER_HEIGHT = IMESSAGE_CARD_HEADER_TITLE_ROW_HEIGHT;
const HEADER_DATE_FONT_SIZE = 44;
const AXIS_MARGIN_TOP = 34;
const AXIS_HEIGHT = 40;
const AXIS_MARGIN_BOTTOM = 14;
const METRIC_ROW_VERTICAL_INSET = 16;
const CHART_HEIGHT = 150;
const EMPTY_CHART_HEIGHT = 40;
const METRIC_ROW_HEIGHT = CHART_HEIGHT + 2 * METRIC_ROW_VERTICAL_INSET;
const EMPTY_METRIC_ROW_HEIGHT = 120;
const BOTTOM_PADDING = 42;
const SUMMARY_WIDTH = 264;
const SERIES_GAP = 24;
const CHART_WIDTH = IMESSAGE_WEARABLE_TREND_CARD_IMAGE_WIDTH
  - 2 * CARD_HORIZONTAL_PADDING
  - SUMMARY_WIDTH
  - SERIES_GAP;
const DAY_COLUMN_WIDTH = CHART_WIDTH / 7;

const AXIS_FONT_SIZE = 30;
const METRIC_LABEL_FONT_SIZE = 30;
const AVERAGE_FONT_SIZE = 60;
const AVERAGE_UNIT_FONT_SIZE = 28;
const DIRECTION_GLYPH_FONT_SIZE = 40;
const NO_DATA_FONT_SIZE = 34;

const CHART_INSET = 14;
const LINE_WIDTH = 4;
/**
 * Smallest peak-to-peak span each chart shows, in the metric's own unit, so a
 * quiet week draws a nearly level line instead of being stretched to fill the
 * chart. A week that moves more than this still fills the chart.
 */
const CHART_MINIMUM_SPAN_BY_METRIC: Record<WearableTrendMetricKey, number> = {
  "hrv-rmssd": 15,
  "hrv-sdnn": 15,
  "resting-heart-rate": 8,
  "steps": 3_000,
  "total-sleep-minutes": 90,
};
const POINT_RADIUS = 7;
const MISSING_STUB_WIDTH = 40;
const MISSING_STUB_HEIGHT = 6;

const COLOR = {
  ...IMESSAGE_CARD_COLOR,
  /** One neutral, warm series stroke; it carries no better/worse meaning. */
  series: "#7A7168",
  seriesMissing: "rgba(122,113,104,0.38)",
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
      + card.metrics.reduce(
        (total, metric) => total + metricRowHeight(metric.values),
        0,
      )
      + BOTTOM_PADDING,
  };
}

function metricRowHeight(values: readonly (number | null)[]): number {
  return averageWearableTrendValues(values) === null
    ? EMPTY_METRIC_ROW_HEIGHT
    : METRIC_ROW_HEIGHT;
}

/**
 * Read-only static fallback for a trusted seven-calendar-day wearable card.
 *
 * Every metric row leads with its weekly average and one neutral arrow for
 * the week-over-week direction, then draws the seven days as zero-based bars
 * in one shared day grid. Only the highest and lowest observed days carry a value so the row
 * reads as a chart rather than a table; missing days keep their column as a
 * faint baseline stub. Messages supplies the outer mask.
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
        backgroundColor: COLOR.balloon,
        color: COLOR.primary,
        fontFamily: "DM Sans",
      }}
    >
      <IMessageCardHeader
        height={HEADER_HEIGHT}
        logoSrc={logoSrc}
        subtitle={null}
        title={{ lineCount: 1, text: "7-day health" }}
        trailing={
          <div
            data-card-date-range={dateRange}
            style={{
              display: "flex",
              marginLeft: 24,
              color: COLOR.secondary,
              fontSize: HEADER_DATE_FONT_SIZE,
              fontWeight: 400,
              lineHeight: 1,
              whiteSpace: "nowrap",
            }}
          >
            {dateRange}
          </div>
        }
      />

      <DayAxis weekdayLabels={weekdayLabels} />

      <div style={{ display: "flex", flexDirection: "column" }}>
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

function DayAxis({ weekdayLabels }: { weekdayLabels: string[] }) {
  return (
    <div
      data-wearable-trend-day-axis="shared"
      style={{
        display: "flex",
        height: AXIS_HEIGHT,
        alignItems: "flex-end",
        marginTop: AXIS_MARGIN_TOP,
        marginBottom: AXIS_MARGIN_BOTTOM,
      }}
    >
      <div
        style={{
          display: "flex",
          width: SUMMARY_WIDTH,
          flexShrink: 0,
          ...axisLabelStyle,
        }}
      >
        AVERAGE
      </div>
      <div
        aria-hidden="true"
        style={{
          display: "flex",
          width: CHART_WIDTH,
          flexShrink: 0,
          marginLeft: SERIES_GAP,
        }}
      >
        {weekdayLabels.map((weekday, index) => (
          <div
            key={`${weekday}-${index}`}
            style={{
              display: "flex",
              width: DAY_COLUMN_WIDTH,
              justifyContent: "center",
              ...axisLabelStyle,
            }}
          >
            {weekday.charAt(0).toUpperCase()}
          </div>
        ))}
      </div>
    </div>
  );
}

const axisLabelStyle = {
  color: IMESSAGE_CARD_COLOR.secondary,
  fontSize: AXIS_FONT_SIZE,
  fontWeight: 600,
  letterSpacing: "0.08em",
  lineHeight: 1,
  whiteSpace: "nowrap",
} as const;

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
  const direction = describeDirection(metric.trend, average);
  const sparkline = renderWearableTrendSparkline(metric.values);
  const valueLabels = metric.values.map((value) =>
    formatWearableTrendMetricValue(metric.metricKey, value)
  );
  const accessibilityLabel = [
    presentation.displayName,
    average === null ? "average unavailable" : `${renderedAverage} average`,
    `trend ${formatWearableTrendDirection(metric.trend)}`,
    ...localDates.map((_localDate, index) =>
      `${weekdayLabels[index] ?? "Day"} ${
        metric.values[index] === null ? "no data" : valueLabels[index] ?? "no data"
      }`
    ),
  ].join(", ");

  return (
    <div
      aria-label={accessibilityLabel}
      data-metric-key={metric.metricKey}
      role="group"
      style={{
        display: "flex",
        height: metricRowHeight(metric.values),
        boxSizing: "border-box",
        alignItems: "center",
        padding: `${METRIC_ROW_VERTICAL_INSET}px 0`,
        borderTop: `2px solid ${COLOR.divider}`,
      }}
    >
      <MetricSummary
        average={average}
        direction={direction}
        label={presentation.compactLabel}
        metricKey={metric.metricKey}
      />
      <DayChart
        height={average === null ? EMPTY_CHART_HEIGHT : CHART_HEIGHT}
        localDates={localDates}
        metricKey={metric.metricKey}
        sparkline={sparkline}
        values={metric.values}
      />
    </div>
  );
}

function MetricSummary({
  average,
  direction,
  label,
  metricKey,
}: {
  average: number | null;
  direction: DirectionPresentation;
  label: string;
  metricKey: WearableTrendMetricKey;
}) {
  const unit = averageUnit(metricKey);
  const number = formatWearableTrendMetricValue(metricKey, average);

  return (
    <div
      data-metric-direction={direction.key}
      style={{
        display: "flex",
        width: SUMMARY_WIDTH,
        flexShrink: 0,
        flexDirection: "column",
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          display: "flex",
          color: COLOR.secondary,
          fontSize: METRIC_LABEL_FONT_SIZE,
          fontWeight: 600,
          letterSpacing: "0.08em",
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>

      {average === null ? (
        <div
          style={{
            display: "flex",
            marginTop: 10,
            color: COLOR.secondary,
            fontSize: NO_DATA_FONT_SIZE,
            fontWeight: 600,
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          No data
        </div>
      ) : (
        <div
          data-metric-average={number}
          style={{
            display: "flex",
            alignItems: "center",
            marginTop: 10,
            whiteSpace: "nowrap",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: AVERAGE_FONT_SIZE,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              lineHeight: 1,
            }}
          >
            {number}
          </div>
          {unit === null ? null : (
            <div
              style={{
                display: "flex",
                marginLeft: 9,
                color: COLOR.secondary,
                fontSize: AVERAGE_UNIT_FONT_SIZE,
                fontWeight: 400,
                lineHeight: 1,
              }}
            >
              {unit}
            </div>
          )}
          {direction.glyph === null ? null : (
            <div
              data-metric-direction-glyph={direction.glyph}
              style={{
                display: "flex",
                marginLeft: 12,
                fontSize: DIRECTION_GLYPH_FONT_SIZE,
                fontWeight: 600,
                lineHeight: 1,
              }}
            >
              {direction.glyph}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DayChart({
  height,
  localDates,
  metricKey,
  sparkline,
  values,
}: {
  height: number;
  localDates: WearableTrendResponseCardV1["localDates"];
  metricKey: WearableTrendMetricKey;
  sparkline: string;
  values: readonly (number | null)[];
}) {
  const levels = normalizeLevels(values, CHART_MINIMUM_SPAN_BY_METRIC[metricKey]);
  const points = levels.map((level, index) =>
    level === null
      ? null
      : {
        x: DAY_COLUMN_WIDTH * (index + 0.5),
        y: CHART_INSET + (1 - level) * (height - 2 * CHART_INSET),
      }
  );
  const segments = connectedSegments(points);

  return (
    <div
      aria-hidden="true"
      data-sparkline={sparkline}
      style={{
        display: "flex",
        width: CHART_WIDTH,
        height,
        flexShrink: 0,
        marginLeft: SERIES_GAP,
        alignSelf: "flex-end",
      }}
    >
      <svg
        height={height}
        viewBox={`0 0 ${CHART_WIDTH} ${height}`}
        width={CHART_WIDTH}
      >
        {segments.map((segment) => (
          <path
            d={segment}
            fill="none"
            key={segment}
            stroke={COLOR.series}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={LINE_WIDTH}
          />
        ))}
        {points.map((point, index) =>
          point === null
            ? (
              <rect
                data-day-value="missing"
                fill={COLOR.seriesMissing}
                height={MISSING_STUB_HEIGHT}
                key={localDates[index]}
                rx={MISSING_STUB_HEIGHT / 2}
                width={MISSING_STUB_WIDTH}
                x={DAY_COLUMN_WIDTH * (index + 0.5) - MISSING_STUB_WIDTH / 2}
                y={height - MISSING_STUB_HEIGHT}
              />
            )
            : (
              <circle
                cx={point.x}
                cy={point.y}
                data-day-value="observed"
                fill={COLOR.series}
                key={localDates[index]}
                r={POINT_RADIUS}
              />
            )
        )}
      </svg>
    </div>
  );
}

/**
 * Each metric is fitted to a window that is at least `minimumSpan` wide and
 * centered on its observed range. A week that moves more than the minimum
 * fills the chart; a quieter week stays near the middle so small differences
 * are not exaggerated. Missing days stay null.
 */
function normalizeLevels(
  values: readonly (number | null)[],
  minimumSpan: number,
): (number | null)[] {
  const observed = values.filter((value): value is number => value !== null);
  if (observed.length === 0) {
    return values.map(() => null);
  }
  const minimum = Math.min(...observed);
  const maximum = Math.max(...observed);
  const span = Math.max(maximum - minimum, minimumSpan);
  const low = (minimum + maximum) / 2 - span / 2;
  return values.map((value) => value === null ? null : (value - low) / span);
}

/** SVG path data for each run of adjacent observed days. */
function connectedSegments(
  points: readonly ({ x: number; y: number } | null)[],
): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 1) {
      segments.push(current.join(" "));
    }
    current = [];
  };
  for (const point of points) {
    if (point === null) {
      flush();
      continue;
    }
    current.push(`${current.length === 0 ? "M" : "L"} ${round(point.x)} ${round(point.y)}`);
  }
  flush();
  return segments;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

type DirectionPresentation = {
  glyph: string | null;
  key: WearableTrendDirection | "no_data";
};

/**
 * Week-over-week direction as one neutral arrow beside the average. A row
 * with too few observed days to compare shows no arrow, and the comparison
 * basis is not repeated; the complete text recovery still names both.
 */
function describeDirection(
  direction: WearableTrendDirection,
  average: number | null,
): DirectionPresentation {
  if (average === null) {
    return { glyph: null, key: "no_data" };
  }
  switch (direction) {
    case "higher":
      return { glyph: "↑", key: direction };
    case "lower":
      return { glyph: "↓", key: direction };
    case "steady":
      return { glyph: "→", key: direction };
    case "not_enough_data":
      return { glyph: null, key: direction };
  }
}

function averageUnit(metricKey: WearableTrendMetricKey): string | null {
  switch (metricKey) {
    case "resting-heart-rate":
      return "bpm";
    case "hrv-rmssd":
    case "hrv-sdnn":
      return "ms";
    case "steps":
    case "total-sleep-minutes":
      return null;
  }
}
