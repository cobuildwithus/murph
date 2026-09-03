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
} from "./card-image-chrome";
import { measureDmSans600Text } from "./dm-sans-600-card-metrics";

export const IMESSAGE_WEARABLE_TREND_CARD_IMAGE_WIDTH = 1_200;

const CARD_HORIZONTAL_PADDING = 45;
const CARD_VERTICAL_PADDING = 38;
const HEADER_HEIGHT = 183;
const AXIS_MARGIN_TOP = 20;
const AXIS_HEIGHT = 40;
const AXIS_MARGIN_BOTTOM = 14;
const METRIC_ROW_HEIGHT = 172;
const EMPTY_METRIC_ROW_HEIGHT = 120;
const METRIC_ROW_TOP_INSET = 22;
const METRIC_ROW_BOTTOM_INSET = 16;
const BOTTOM_PADDING = 42;
const SUMMARY_WIDTH = 264;
const SERIES_GAP = 24;
const CHART_WIDTH = IMESSAGE_WEARABLE_TREND_CARD_IMAGE_WIDTH
  - 2 * CARD_HORIZONTAL_PADDING
  - SUMMARY_WIDTH
  - SERIES_GAP;
const DAY_COLUMN_WIDTH = CHART_WIDTH / 7;

const AXIS_FONT_SIZE = 32;
const METRIC_LABEL_FONT_SIZE = 30;
const AVERAGE_FONT_SIZE = 60;
const AVERAGE_UNIT_FONT_SIZE = 27;
const DIRECTION_GLYPH_FONT_SIZE = 40;
const NO_DATA_FONT_SIZE = 34;
const VALUE_FONT_SIZE = 30;
const VALUE_MIN_FONT_SIZE = 20;
const VALUE_MIN_COLUMN_GAP = 8;

const BAR_MAX_HEIGHT = 96;
const BAR_MIN_HEIGHT = 6;
const BAR_WIDTH = 52;
const BAR_LABEL_GAP = 6;

const COLOR = {
  ...IMESSAGE_CARD_COLOR,
  /** One neutral, warm series fill; it carries no better/worse meaning. */
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
        subtitle={{ lineCount: 1, text: dateRange }}
        title={{ lineCount: 1, text: "7-day health" }}
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
    `${formatWearableTrendDirection(metric.trend)} versus prior seven days`,
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
        alignItems: "flex-end",
        paddingBottom: METRIC_ROW_BOTTOM_INSET,
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
        localDates={localDates}
        sparkline={sparkline}
        valueLabels={valueLabels}
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
        alignSelf: "flex-start",
        marginTop: METRIC_ROW_TOP_INSET,
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
            alignItems: "baseline",
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
  localDates,
  sparkline,
  valueLabels,
  values,
}: {
  localDates: WearableTrendResponseCardV1["localDates"];
  sparkline: string;
  valueLabels: string[];
  values: readonly (number | null)[];
}) {
  const observed = values.filter((value): value is number => value !== null);
  const maximum = observed.length === 0 ? null : Math.max(...observed);
  const labelledIndices = selectLabelledDays(values);
  const valueFontSize = fitValueFontSize(
    valueLabels.filter((_label, index) => labelledIndices.has(index)),
  );

  return (
    <div
      aria-hidden="true"
      data-sparkline={sparkline}
      style={{
        display: "flex",
        width: CHART_WIDTH,
        flexShrink: 0,
        marginLeft: SERIES_GAP,
        alignItems: "flex-end",
      }}
    >
      {values.map((value, index) => (
        <DayColumn
          key={localDates[index]}
          label={labelledIndices.has(index) ? valueLabels[index] ?? null : null}
          labelFontSize={valueFontSize}
          value={value}
          maximum={maximum}
        />
      ))}
    </div>
  );
}

function DayColumn({
  label,
  labelFontSize,
  maximum,
  value,
}: {
  label: string | null;
  labelFontSize: number;
  maximum: number | null;
  value: number | null;
}) {
  const missing = value === null || maximum === null || maximum === 0;
  const barHeight = missing ? BAR_MIN_HEIGHT : scaleBarHeight(value, maximum);

  return (
    <div
      data-day-value={value === null ? "missing" : "observed"}
      style={{
        display: "flex",
        width: DAY_COLUMN_WIDTH,
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-end",
      }}
    >
      {label === null ? null : (
        <div
          data-day-label="extreme"
          style={{
            display: "flex",
            marginBottom: BAR_LABEL_GAP,
            fontSize: labelFontSize,
            fontWeight: 600,
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
      )}
      <div
        style={{
          display: "flex",
          width: BAR_WIDTH,
          height: barHeight,
          borderTopLeftRadius: missing ? 3 : 6,
          borderTopRightRadius: missing ? 3 : 6,
          borderBottomLeftRadius: missing ? 3 : 2,
          borderBottomRightRadius: missing ? 3 : 2,
          backgroundColor: missing ? COLOR.seriesMissing : COLOR.series,
        }}
      />
    </div>
  );
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

/**
 * Label only the highest and lowest observed days. The first occurrence wins a
 * tie, and a flat week labels one day, so every row keeps at most two values.
 */
function selectLabelledDays(values: readonly (number | null)[]): Set<number> {
  let highest: number | null = null;
  let lowest: number | null = null;
  for (const [index, value] of values.entries()) {
    if (value === null) continue;
    if (highest === null || value > (values[highest] as number)) highest = index;
    if (lowest === null || value < (values[lowest] as number)) lowest = index;
  }
  return new Set(
    [highest, lowest].filter((index): index is number => index !== null),
  );
}

function scaleBarHeight(value: number, maximum: number): number {
  return Math.max(
    BAR_MIN_HEIGHT,
    Math.round((value / maximum) * BAR_MAX_HEIGHT),
  );
}

/**
 * Day values share one font size per row. When the widest formatted value
 * would collide with its neighbours at the default size, the whole row steps
 * down together so every contract-valid value stays inside its own column.
 */
function fitValueFontSize(valueLabels: readonly string[]): number {
  const available = DAY_COLUMN_WIDTH - VALUE_MIN_COLUMN_GAP;
  const widest = Math.max(
    0,
    ...valueLabels.map((label) => measureDmSans600Text(label, VALUE_FONT_SIZE)),
  );
  if (widest <= available) {
    return VALUE_FONT_SIZE;
  }
  return Math.max(
    VALUE_MIN_FONT_SIZE,
    Math.floor(VALUE_FONT_SIZE * (available / widest)),
  );
}
