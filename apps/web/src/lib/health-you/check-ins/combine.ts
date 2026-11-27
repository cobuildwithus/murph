import { addDaysToIsoDate, combineProtocolKey, type CheckInInstrument, type CombineStation, type MemoryDemographics } from "@murphai/contracts";
import { resolveMetricDefinition } from "@murphai/health-metrics";
import tables from "./combine-norms.json";

type Session = Extract<CheckInInstrument, { instrument: "combine" }>;
type Sex = "male" | "female";
const instructions: Record<CombineStation, { steps: string; gear?: string }> = {
  grip_strength: { gear: "Hand dynamometer", steps: "Sit upright and squeeze with each hand. Enter the best reading in kilograms." },
  broad_jump: { gear: "Tape measure", steps: "If jumping feels safe and familiar, jump from two feet and measure from the line to your nearer heel." },
  single_leg_10s: { steps: "Stand beside a counter. Lift one foot and time the hold for up to 10 seconds." },
  tandem_10s: { steps: "With support within reach, stand heel to toe and time up to 10 seconds." },
  sppb_balance: { steps: "With a helper, complete the side-by-side, semi-tandem and tandem stances. Enter your SPPB balance subtotal." },
  seated_reach: { gear: "Tape measure", steps: "From a stable chair, reach forward comfortably and measure the distance." },
  sitting_rising: { steps: "If safe, sit on the floor and stand up. Start each part at five points. Subtract one per support and half a point for loss of balance." },
  pushups_max: { steps: "Choose toes, knees or wall. Count continuous repetitions with the same setup." },
  pushups_knees: { steps: "From your knees, count continuous push-ups." },
  pushups_wall: { steps: "Place your hands on a stable wall and count continuous wall push-ups." },
  pullups_max: { gear: "Pull-up bar", steps: "From a straight-arm hang, bring your chin above the bar without swinging. Count each repetition." },
  chair_stand_30s: { gear: "Stable chair, 43–46 cm high", steps: "Cross your arms and count full stands from the chair in 30 seconds." },
  squats_max: { steps: "Count continuous bodyweight squats to thigh level using the same depth each time." },
  step_3min: { gear: "30 cm step and metronome", steps: "Do this station first after five seated minutes. Step for three minutes at 96 beats per minute (24 cycles per minute). Sit and start a full 60-second pulse count within five seconds." },
  march_2min: { steps: "March in place for two minutes. Count right-knee lifts to halfway between your kneecap and hip." },
};
function station(key: CombineStation) {
  const metric = resolveMetricDefinition(key.replaceAll("_", "-"))!;
  const group = ["grip_strength", "pullups_max", "pushups_max", "pushups_knees", "pushups_wall", "squats_max", "chair_stand_30s"].includes(key)
    ? "strength" : "movement";
  return { key, group, title: metric.displayName, unit: metric.canonicalUnit!, ...instructions[key] };
}
export const combineStations = (Object.keys(instructions) as CombineStation[])
  .filter(key => key !== "pushups_knees" && key !== "pushups_wall")
  .map(key => key === "pushups_max" ? { ...station(key), title: "Push-ups",
    variants: ["toes", "knees", "wall"].map(key => ({ key, label: key[0]!.toUpperCase() + key.slice(1) })) } : station(key));

function linear(x: number, xs: number[], ys: number[]) {
  if (x <= xs[0]!) return ys[0]!;
  const i = xs.findIndex(knot => knot >= x);
  if (i < 0) return ys.at(-1)!;
  const weight = (x - xs[i - 1]!) / (xs[i]! - xs[i - 1]!);
  return ys[i - 1]! + weight * (ys[i]! - ys[i - 1]!);
}
const ranks = [10, 25, 50, 75, 90];
const band = (age: number, starts: number[]) => starts.filter(start => start <= age).length;

// combine-3.2. Tables are published cohort aggregates. Grip: doi:10.1371/journal.pone.0113637.
// Push/step: NCJ 155768. Chair: Rev Med Chile 153, Table 2 and BMC Geriatr 24:833.
// March: Senior Fitness Test. Jump: Korea Sport Indicators 2021, table 2-3-3(2).
export function stationPercentile(key: CombineStation, value: number, age: number, sex: Sex) {
  if (age < 18 || age > 90) return undefined;
  switch (key) {
    case "grip_strength": {
      const grid = tables.GRIP[sex];
      const index = Math.floor((age - 15) / 5);
      const fraction = (age - 15) % 5 / 5;
      const knots = grid[index]!.map((v, i) => v + fraction * (grid[Math.min(index + 1, grid.length - 1)]![i]! - v));
      return linear(value, [0, ...knots], [0, ...ranks]);
    }
    case "pushups_max":
    case "pushups_knees": {
      if (age < 20 || age > 69 || (key === "pushups_max") !== (sex === "male")) return undefined;
      const curve = new Map([[0, 0]]);
      tables.PUSH[sex][Math.floor(age / 10) - 2]!.forEach((count, i) => {
        const rank = 5 * (i + 1);
        if (count !== null && (!curve.has(count) || ranks.includes(rank))) curve.set(count, rank);
      });
      return linear(value, [...curve.keys()], [...curve.values()]);
    }
    case "chair_stand_30s": {
      const row = age < 70 ? tables.CHAIR[sex][band(age, [30, 40, 50, 60])]
        : tables.CHAIR_SENIOR[sex][Math.floor((age - 70) / 5)];
      return linear(value, [0, ...row!], [0, ...(age < 70 ? [2.5, 25, 50, 75, 97.5] : ranks)]);
    }
    case "step_3min": {
      if (age > 65) return undefined;
      const row = tables.STEP[sex][band(age, [26, 36, 46, 56])]!;
      return linear(-value, row.map(n => -n), row.map((_, i) => i * 5));
    }
    case "march_2min": {
      if (age < 60) return undefined;
      return linear(value, [0, ...tables.MARCH[sex][Math.floor((age - 60) / 5)]!], [0, ...ranks]);
    }
    case "broad_jump": {
      if (age < 19 || age > 64) return undefined;
      const [mean, sd] = tables.JUMP[sex][Math.max(0, Math.floor(age / 5) - 4)]!;
      const z = (value - mean!) / sd!;
      // Standard normal CDF approximation, absolute error below 8e-8.
      const t = 1 / (1 + 0.2316419 * Math.abs(z));
      const tail = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) * t
        * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
      return 100 * (z < 0 ? tail : 1 - tail);
    }
    default: return undefined; // Self-reported task benchmarks have no population percentile.
  }
}

function label(percentile: number) {
  if (percentile >= 60) return `Top ${Math.max(1, Math.ceil(100 - percentile))}%`;
  if (percentile >= 40) return "Average";
  return undefined;
}

export function combineResult(id: string, session: Session, demographics?: MemoryDemographics,
  ageEffect?: (session: Session) => number | undefined) {
  const age = demographics?.birthYear == null ? undefined : Number(session.date.slice(0, 4)) - demographics.birthYear;
  const sex = demographics?.status === "resolved" ? demographics.biologicalSex : null;
  const tests = session.tests.flatMap(row => {
    if (row.skipped || row.value === undefined) return [];
    const key = combineProtocolKey(row);
    const { title, unit } = station(key);
    const percentile = sex && age !== undefined ? stationPercentile(key, row.value, age, sex) : undefined;
    return [{ key, title, unit, value: row.value, ...(percentile === undefined ? {} : {
      percentile: Number(percentile.toFixed(3)), label: label(percentile),
    }) }];
  });
  const ranked = tests.filter(t => t.percentile !== undefined)
    .filter(t => t.key !== "step_3min" || !tests.some(row => row.key === "march_2min" && row.percentile !== undefined));
  const meanRank = ranked.length ? ranked.reduce((sum, t) => sum + t.percentile!, 0) / ranked.length : undefined;

  const years = ageEffect?.(session);
  return { id, date: session.date, tests, recorded: tests.filter(t => t.percentile === undefined)
    .map(({ key, title, value }) => ({ key, title, value })), retestOn: addDaysToIsoDate(session.date, 42),
    ...(meanRank === undefined ? {} : {
      ...(label(meanRank) ? { rank: { percentile: Math.round(meanRank), label: label(meanRank)!,
        cohort: `Average across stations for ${sex === "male" ? "men" : "women"} of comparable age` } } : {}),
      score: Math.floor(ranked.reduce((sum, t) => sum + linear(t.percentile!, [0, 10, 25, 50, 75], [0, 50, 70, 85, 100]), 0) / ranked.length),
    }), ...(years === undefined ? {} : { years }) };
}
