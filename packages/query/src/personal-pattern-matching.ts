const DAY_MS = 86_400_000;

interface Assignment {
  count: number;
  distance: number;
  step: "match" | "skip_exposure" | "skip_comparison";
}

/** Match dates without inspecting outcome values or reusing either day. */
export function matchPersonalPatternDates(
  exposedDates: readonly string[],
  comparisonDates: readonly string[],
  maxDistanceDays: number,
): Map<string, string> {
  const matches = new Map<string, string>();
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const forWeekday = (dates: readonly string[]) =>
      [...new Set(dates)]
        .filter((date) => new Date(`${date}T00:00:00Z`).getUTCDay() === weekday)
        .sort();
    matchWeekdayDates(
      forWeekday(exposedDates),
      forWeekday(comparisonDates),
      maxDistanceDays,
      matches,
    );
  }
  return matches;
}

function betterAssignment(left: Assignment, right: Assignment): Assignment {
  return left.count > right.count ||
    (left.count === right.count && left.distance <= right.distance)
    ? left
    : right;
}

function matchWeekdayDates(
  exposed: readonly string[],
  comparison: readonly string[],
  maxDistanceDays: number,
  matches: Map<string, string>,
): void {
  // On one ordered weekday series an uncrossed assignment is optimal for
  // absolute distance. Maximize usable pairs first, then minimize total distance.
  const table: Assignment[][] = Array.from({ length: exposed.length + 1 }, () =>
    Array.from({ length: comparison.length + 1 }, () => ({
      count: 0,
      distance: 0,
      step: "skip_exposure" as const,
    })),
  );
  for (let i = exposed.length - 1; i >= 0; i -= 1) {
    for (let j = comparison.length - 1; j >= 0; j -= 1) {
      let best = betterAssignment(
        { ...table[i][j + 1], step: "skip_comparison" },
        { ...table[i + 1][j], step: "skip_exposure" },
      );
      const distance =
        Math.abs(Date.parse(exposed[i]) - Date.parse(comparison[j])) / DAY_MS;
      if (distance <= maxDistanceDays) {
        const tail = table[i + 1][j + 1];
        best = betterAssignment(
          {
            count: tail.count + 1,
            distance: tail.distance + distance,
            step: "match",
          },
          best,
        );
      }
      table[i][j] = best;
    }
  }
  let i = 0;
  let j = 0;
  while (i < exposed.length && j < comparison.length) {
    const step = table[i][j].step;
    if (step === "match") matches.set(exposed[i], comparison[j]);
    if (step !== "skip_comparison") i += 1;
    if (step !== "skip_exposure") j += 1;
  }
}
