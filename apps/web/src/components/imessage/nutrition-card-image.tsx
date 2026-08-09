import type {
  DailyNutritionResponseCard,
  DailyNutritionResponseCardV2,
  NutritionCardGoalSnapshot,
  NutritionCardGoalStatus,
  NutritionCardMetric,
} from "@murphai/contracts";

export const IMESSAGE_NUTRITION_CARD_IMAGE_SIZE = {
  width: 1200,
  height: 1200,
} as const;

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 3,
  useGrouping: true,
});

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const STATUS_LABELS = {
  far_over_target: "Far over target",
  far_under_target: "Far under target",
  on_target: "On target",
  over_target: "Over target",
  unavailable: "Status unavailable",
  under_target: "Under target",
} as const satisfies Record<NutritionCardGoalStatus, string>;

const COLOR = {
  background: "#F5F0E8",
  border: "rgba(196,168,130,0.32)",
  card: "rgba(255,252,246,0.88)",
  foreground: "#2D3436",
  muted: "#625D52",
  primary: "#5A6E32",
  warning: "#8B5D3F",
};

type NutritionMetricPresentation = {
  goal: NutritionCardGoalSnapshot | null | undefined;
  label: string;
  metric: NutritionCardMetric;
  unit: string;
};

export function NutritionCardImage({
  card,
  logoDataUri,
}: {
  card: DailyNutritionResponseCard;
  logoDataUri: string;
}) {
  const v2 = isNutritionCardV2(card) ? card : null;
  const metrics: NutritionMetricPresentation[] = [
    {
      goal: v2 === null ? undefined : v2.goals.proteinGrams,
      label: "Protein",
      metric: card.totals.proteinGrams,
      unit: "g",
    },
    {
      goal: v2 === null ? undefined : v2.goals.carbsGrams,
      label: "Carbs",
      metric: card.totals.carbsGrams,
      unit: "g",
    },
    {
      goal: v2 === null ? undefined : v2.goals.fatGrams,
      label: "Fat",
      metric: card.totals.fatGrams,
      unit: "g",
    },
    ...(v2 === null
      ? []
      : [{
          goal: v2.goals.fiberGrams,
          label: "Fiber",
          metric: v2.totals.fiberGrams,
          unit: "g",
        }]),
  ];
  const metricRows = v2 === null
    ? [metrics]
    : [metrics.slice(0, 2), metrics.slice(2)];
  const partial = [card.totals.calories, ...metrics.map(({ metric }) => metric)]
    .some((metric) => metric.total === null || metric.mealCount < card.mealCount);
  const calories = card.totals.calories.total;
  const calorieGoal = v2 === null ? undefined : v2.goals.calories;
  const mealLabel = card.mealCount === 1 ? "meal" : "meals";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: COLOR.background,
        color: COLOR.foreground,
        padding: "58px 64px 52px",
        fontFamily: "DM Sans",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori requires a raw image element */}
        <img src={logoDataUri} width={152} height={34} alt="" />
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              display: "flex",
              fontSize: 30,
              letterSpacing: "0.14em",
              color: COLOR.muted,
            }}
          >
            DAILY NUTRITION
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              borderRadius: 999,
              padding: "8px 15px",
              backgroundColor: partial
                ? "rgba(139,93,63,0.12)"
                : "rgba(90,110,50,0.12)",
              color: partial ? COLOR.warning : COLOR.primary,
              fontSize: 28,
              letterSpacing: "0.08em",
            }}
          >
            {partial ? "PARTIAL TOTALS" : `${card.mealCount} ${mealLabel}`.toUpperCase()}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          borderBottom: `1px solid ${COLOR.border}`,
          paddingBottom: 42,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              display: "flex",
              fontFamily: "Fraunces",
              fontWeight: 600,
              fontSize: 68,
              lineHeight: 1,
              letterSpacing: "-0.025em",
            }}
          >
            {formatDate(card.localDate)}
          </div>
          <div style={{ display: "flex", fontSize: 34, color: COLOR.muted }}>
            {card.mealCount} logged {mealLabel}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <div
              style={{
                display: "flex",
                fontFamily: "Fraunces",
                fontWeight: 600,
                fontSize: 108,
                lineHeight: 0.9,
                letterSpacing: "-0.035em",
              }}
            >
              {calories === null ? "—" : formatNumber(calories)}
            </div>
            <div style={{ display: "flex", fontSize: 36, color: COLOR.muted }}>
              cal
            </div>
          </div>
          <GoalLine goal={calorieGoal} unit=" cal" />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {metricRows.map((row, rowIndex) => (
          <div key={rowIndex} style={{ display: "flex", gap: 22 }}>
            {row.map((metric) => (
              <MetricCard
                key={metric.label}
                cardMealCount={card.mealCount}
                presentation={metric}
              />
            ))}
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: COLOR.muted,
          fontSize: 28,
        }}
      >
        <div style={{ display: "flex" }}>Private nutrition snapshot</div>
        <div style={{ display: "flex", color: COLOR.primary }}>withmurph.ai</div>
      </div>
    </div>
  );
}

function MetricCard({
  cardMealCount,
  presentation,
}: {
  cardMealCount: number;
  presentation: NutritionMetricPresentation;
}) {
  const { goal, label, metric, unit } = presentation;
  const supportLabel = metric.total === null
    ? "Not available"
    : metric.mealCount < cardMealCount
      ? `${metric.mealCount} of ${cardMealCount} meals`
      : "Complete total";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flexBasis: 0,
        flexGrow: 1,
        minWidth: 0,
        gap: 16,
        border: `1px solid ${COLOR.border}`,
        borderRadius: 24,
        backgroundColor: COLOR.card,
        padding: "28px 30px",
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: 28,
          letterSpacing: "0.12em",
          color: COLOR.muted,
        }}
      >
        {label.toUpperCase()}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <div
          style={{
            display: "flex",
            fontFamily: "Fraunces",
            fontWeight: 600,
            fontSize: 78,
            lineHeight: 1,
            letterSpacing: "-0.025em",
          }}
        >
          {metric.total === null ? "—" : formatNumber(metric.total)}
        </div>
        {metric.total === null ? null : (
          <div style={{ display: "flex", fontSize: 34, color: COLOR.muted }}>
            {unit}
          </div>
        )}
      </div>
      <div style={{ display: "flex", fontSize: 38, color: COLOR.muted }}>
        {supportLabel}
      </div>
      <GoalLine goal={goal} unit={unit} />
    </div>
  );
}

function GoalLine({
  goal,
  unit,
}: {
  goal: NutritionCardGoalSnapshot | null | undefined;
  unit: string;
}) {
  if (goal === undefined) {
    return null;
  }
  if (goal === null) {
    return (
      <div style={{ display: "flex", fontSize: 40, color: COLOR.muted }}>
        Goal unavailable
      </div>
    );
  }
  return (
    <div style={{ display: "flex", fontSize: 40, color: COLOR.muted }}>
      {formatNumber(goal.target)}{unit} goal · {STATUS_LABELS[goal.status]}
    </div>
  );
}

function isNutritionCardV2(
  card: DailyNutritionResponseCard,
): card is DailyNutritionResponseCardV2 {
  return "version" in card && card.version === 2;
}

function formatDate(localDate: string): string {
  const [yearText, monthText, dayText] = localDate.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const monthLabel = MONTHS[month - 1];
  return monthLabel === undefined ? localDate : `${monthLabel} ${day}, ${year}`;
}

function formatNumber(value: number): string {
  return NUMBER_FORMATTER.format(value);
}
