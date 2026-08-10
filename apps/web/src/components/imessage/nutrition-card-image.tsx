import type {
  DailyNutritionResponseCard,
  DailyNutritionResponseCardV2,
  NutritionCardGoalSnapshot,
  NutritionCardGoalStatus,
  NutritionCardMetric,
} from "@murphai/contracts";

export const IMESSAGE_NUTRITION_CARD_IMAGE_SIZE = {
  width: 1200,
  height: 568,
} as const;

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 3,
  useGrouping: true,
});

const COLOR = {
  balloon: "#FFF5E6",
  badge: "#FCFAF5",
  badgeBorder: "rgba(20,18,23,0.08)",
  badgeMark: "rgba(186,130,74,0.55)",
  primary: "#141217",
  secondary: "#666163",
  progressTrack: "rgba(102,97,99,0.12)",
  farFromTarget: "#B3332B",
  offTarget: "#995E08",
  onTarget: "#337338",
} as const;

type NutritionMetricPresentation = {
  goal: NutritionCardGoalSnapshot | null | undefined;
  label: string;
  metric: NutritionCardMetric;
};

const EMPTY_METRIC: NutritionCardMetric = {
  total: null,
  mealCount: 0,
};

/**
 * Static counterpart to the shipping SwiftUI nutrition balloon's default
 * state. Detailed dates, completeness, goals, and statuses remain in Linq's
 * native captions so the visual can stay aligned with the compact card.
 */
export function NutritionCardImage({
  card,
}: {
  card: DailyNutritionResponseCard;
}) {
  const v2 = isNutritionCardV2(card) ? card : null;
  const metrics: NutritionMetricPresentation[] = [
    {
      goal: v2?.goals.proteinGrams,
      label: "PROTEIN",
      metric: card.totals.proteinGrams,
    },
    {
      goal: v2?.goals.carbsGrams,
      label: "CARBS",
      metric: card.totals.carbsGrams,
    },
    {
      goal: v2?.goals.fatGrams,
      label: "FAT",
      metric: card.totals.fatGrams,
    },
    {
      goal: v2?.goals.fiberGrams,
      label: "FIBER",
      metric: v2?.totals.fiberGrams ?? EMPTY_METRIC,
    },
  ];
  const calorieMetric = card.totals.calories;
  const calories = calorieMetric.total;
  const calorieGoal = v2?.goals.calories;

  return (
    <div
      data-design-contract="imessage-native-nutrition-card"
      style={{
        position: "relative",
        display: "flex",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        borderRadius: 105,
        backgroundColor: COLOR.balloon,
        color: COLOR.primary,
        fontFamily: "DM Sans",
      }}
    >
      <SystemBadge />

      <div
        style={{
          position: "absolute",
          top: 146,
          left: 45,
          display: "flex",
          alignItems: "baseline",
          gap: 18,
          maxWidth: 800,
          whiteSpace: "nowrap",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 143,
            fontWeight: 600,
            lineHeight: 1,
            letterSpacing: "-0.045em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {calories === null ? "—" : formatNumber(calories)}
        </div>
        <div
          style={{
            display: "flex",
            color: COLOR.secondary,
            fontSize: 56,
            fontWeight: 500,
            lineHeight: 1,
          }}
        >
          cal
        </div>
      </div>

      <CalorieRing
        cardMealCount={card.mealCount}
        metric={calorieMetric}
        goal={calorieGoal}
      />

      <div
        style={{
          position: "absolute",
          right: 45,
          bottom: 36,
          left: 45,
          display: "flex",
          alignItems: "flex-start",
          gap: 30,
        }}
      >
        {metrics.map((presentation) => (
          <Metric key={presentation.label} presentation={presentation} />
        ))}
      </div>
    </div>
  );
}

function SystemBadge() {
  const dotOffsets = [
    [0, -23],
    [23, 0],
    [0, 23],
    [-23, 0],
  ] as const;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 30,
        left: 30,
        display: "flex",
        width: 135,
        height: 101,
        border: `2px solid ${COLOR.badgeBorder}`,
        borderRadius: 999,
        backgroundColor: COLOR.badge,
        boxShadow: "0 2px 4px rgba(20,18,23,0.08)",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 43,
          left: 60,
          display: "flex",
          width: 15,
          height: 15,
          borderRadius: 999,
          backgroundColor: COLOR.badgeMark,
        }}
      />
      {dotOffsets.map(([x, y]) => (
        <span
          key={`${x}:${y}`}
          style={{
            position: "absolute",
            top: 46 + y,
            left: 63 + x,
            display: "flex",
            width: 10,
            height: 10,
            borderRadius: 999,
            backgroundColor: COLOR.badgeMark,
          }}
        />
      ))}
    </div>
  );
}

function CalorieRing({
  cardMealCount,
  metric,
  goal,
}: {
  cardMealCount: number;
  metric: NutritionCardMetric;
  goal: NutritionCardGoalSnapshot | null | undefined;
}) {
  const size = 203;
  const strokeWidth = 19;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = getCalorieProgress(metric, cardMealCount, goal);

  return (
    <div
      aria-hidden="true"
      data-calorie-progress={
        progress === null ? "unavailable" : progress.toFixed(4)
      }
      style={{
        position: "absolute",
        top: 75,
        right: 38,
        display: "flex",
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
        color: COLOR.primary,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ position: "absolute", inset: 0 }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={COLOR.progressTrack}
          strokeWidth={strokeWidth}
        />
        {progress === null ? null : (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={COLOR.primary}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${circumference * progress} ${circumference}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <svg width={75} height={75} viewBox="0 0 24 24">
        <path
          d="M12 22c4.97 0 9-3.58 9-8 0-4.5-4-8-6-10.5C14 6 13 7 12 7c-2 0-3.5-1.5-3-4C6.5 4.5 3 8 3 14c0 4.42 4.03 8 9 8Z"
          fill="currentColor"
        />
        <path
          d="M12 19c1.5 0 2.7-1.1 2.7-2.5 0-1.5-1.3-2.7-2.2-3.6-.3 1-.9 1.8-1.7 2.3-.5-.8-.4-1.7.1-2.5-1.1.8-1.7 2.1-1.7 3.6 0 1.5 1.3 2.7 2.8 2.7Z"
          fill={COLOR.balloon}
        />
      </svg>
    </div>
  );
}

function Metric({
  presentation,
}: {
  presentation: NutritionMetricPresentation;
}) {
  const { goal, label, metric } = presentation;
  const color = getStatusColor(goal);

  return (
    <div
      data-goal-status={goal?.status ?? "no-goal"}
      style={{
        display: "flex",
        flexDirection: "column",
        flexBasis: 0,
        flexGrow: 1,
        minWidth: 0,
        minHeight: 165,
        alignItems: "flex-start",
        gap: 7,
      }}
    >
      <div
        style={{
          display: "flex",
          color: COLOR.secondary,
          fontSize: 40,
          fontWeight: 600,
          lineHeight: 1,
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          color,
          fontSize: 57,
          fontWeight: 600,
          lineHeight: 1.15,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {metric.total === null ? "—" : `${formatNumber(metric.total)}g`}
      </div>
    </div>
  );
}

function getCalorieProgress(
  metric: NutritionCardMetric,
  cardMealCount: number,
  goal: NutritionCardGoalSnapshot | null | undefined,
): number | null {
  if (
    metric.total === null ||
    metric.mealCount !== cardMealCount ||
    goal === null ||
    goal === undefined ||
    goal.status === "unavailable"
  ) {
    return null;
  }
  return Math.min(1, Math.max(0, metric.total / goal.target));
}

function getStatusColor(
  goal: NutritionCardGoalSnapshot | null | undefined,
): string {
  if (goal === null || goal === undefined) {
    return COLOR.primary;
  }
  const colors = {
    far_over_target: COLOR.farFromTarget,
    far_under_target: COLOR.farFromTarget,
    on_target: COLOR.onTarget,
    over_target: COLOR.offTarget,
    unavailable: COLOR.secondary,
    under_target: COLOR.offTarget,
  } as const satisfies Record<NutritionCardGoalStatus, string>;
  return colors[goal.status];
}

function isNutritionCardV2(
  card: DailyNutritionResponseCard,
): card is DailyNutritionResponseCardV2 {
  return "version" in card && card.version === 2;
}

function formatNumber(value: number): string {
  return NUMBER_FORMATTER.format(value);
}
