import * as z from "./zod-runtime.ts";

/** Inclusive capture bounds for the version-one at-home station protocols. */
export const combineStationBounds = {
  grip_strength: [0, 150], broad_jump: [1, 400], single_leg_10s: [0, 10],
  tandem_10s: [0, 10], sppb_balance: [0, 4], sitting_rising: [0, 10],
  pushups_max: [0, 200], pushups_knees: [0, 200], pushups_wall: [0, 200],
  pullups_max: [0, 100], chair_stand_30s: [0, 60], squats_max: [0, 250],
  step_3min: [35, 220], march_2min: [0, 260], seated_reach: [0, 100],
} as const;
export type CombineStation = keyof typeof combineStationBounds;
const stationKey = z.custom<CombineStation>(value => typeof value === "string" && Object.hasOwn(combineStationBounds, value));
const integerStations = new Set<CombineStation>(["pushups_max", "pushups_knees", "pushups_wall", "pullups_max",
  "chair_stand_30s", "squats_max", "step_3min", "march_2min", "sppb_balance"]);
export const combineStationSchema = z.object({
  key: stationKey, value: z.number().finite().optional(), skipped: z.boolean().optional(),
  variant: z.enum(["toes", "knees", "wall"]).optional(),
}).strict().refine(row => {
  if (row.variant && row.key !== "pushups_max") return false;
  if (row.skipped && row.value === undefined) return true;
  const [min, max] = combineStationBounds[row.key];
  return row.value !== undefined && row.value >= min && row.value <= max
    && (!integerStations.has(row.key) || Number.isInteger(row.value))
    && (row.key !== "sitting_rising" || Number.isInteger(row.value * 2));
}, "Invalid station result.");
export function combineProtocolKey(row: z.infer<typeof combineStationSchema>): CombineStation {
  if (row.variant === "knees") return "pushups_knees";
  if (row.variant === "wall") return "pushups_wall";
  return row.key;
}
export const combineTestsSchema = z.array(combineStationSchema).min(1).max(15)
  .refine(rows => new Set(rows.map(combineProtocolKey)).size === rows.length, "Duplicate station.");

export const foodWeekLimits = {
  vegetables: 140, fruit: 140, whole_grains: 140, plants: 140, red_meat: 140,
  processed_meat: 140, sweet_drinks: 140, sweets: 140, eating_days: 7,
  seafood: 21, plant_oil: 100, fried_days: 7, packaged_days: 7, alcohol: 100, max_occasion: 30,
} as const;
export type FoodWeekKey = keyof typeof foodWeekLimits;
const foodAnswer = z.object({
  key: z.custom<FoodWeekKey>(v => typeof v === "string" && Object.hasOwn(foodWeekLimits, v)),
  value: z.number().finite().nonnegative(),
}).strict().refine(({ key, value }) => value <= foodWeekLimits[key] && (!key.endsWith("_days") || Number.isInteger(value)));
export const foodWeekAnswersSchema = z.array(foodAnswer).min(1).max(15).refine(rows => {
  const values = new Map(rows.map(row => [row.key, row.value]));
  const eatingDays = values.get("eating_days") ?? 7;
  return ["vegetables", "fruit", "whole_grains", "plants", "red_meat", "processed_meat", "sweet_drinks", "sweets", "eating_days"]
    .every(key => rows.some(row => row.key === key)) && values.size === rows.length && (values.get("fried_days") ?? 0) <= eatingDays
    && (values.get("packaged_days") ?? 0) <= eatingDays
    && (values.get("max_occasion") ?? 0) <= (values.get("alcohol") ?? 100);
});
const yesNoUnsure = z.enum(["yes", "no", "unsure"]);
export const oneOffAnswerSchema = z.discriminatedUnion("key", [
  z.strictObject({ key: z.literal("whoopZones"), value: z.enum(["yes", "no", "notSure"]) }),
  z.strictObject({ key: z.literal("smoking"), value: z.enum(["never", "former", "current", "unsure"]) }),
  z.strictObject({ key: z.literal("quitDate"), value: z.iso.date() }),
  z.strictObject({ key: z.literal("alcoholDrinksPerWeek"), value: z.number().finite().min(0).max(150) }),
  z.strictObject({ key: z.literal("diabetes"), value: yesNoUnsure }),
  z.strictObject({ key: z.literal("seriousDisease"), value: yesNoUnsure }),
  z.strictObject({ key: z.literal("selfRatedHealth"), value: z.enum(["excellent", "veryGood", "good", "fair", "poor"]) }),
]);
export const checkInInstrumentSchema = z.discriminatedUnion("instrument", [
  z.object({ instrument: z.literal("combine"), instrumentVersion: z.literal(1), date: z.iso.date(), tests: combineTestsSchema }).strict(),
  z.object({ instrument: z.literal("food-week"), instrumentVersion: z.literal(1), answers: foodWeekAnswersSchema }).strict(),
  z.object({ instrument: z.literal("you-answer"), instrumentVersion: z.literal(1), answer: oneOffAnswerSchema }).strict(),
]);
export type CheckInInstrument = z.infer<typeof checkInInstrumentSchema>;
export const assessmentCheckInSchema = z.object({
  kind: z.literal("assessment.respond"), version: z.literal(1), response: checkInInstrumentSchema,
}).strict();

export const bloodPressureFields = z.object({
  systolic: z.number().int().positive().max(400), diastolic: z.number().int().positive().max(300),
  takenAt: z.isoDateTime({ offset: true }),
}).strict().refine(pair => pair.systolic > pair.diastolic);
export const bloodPressureActionSchema = bloodPressureFields.safeExtend({
  kind: z.literal("measurement.blood-pressure"), version: z.literal(1), date: z.iso.date().optional(),
});

export const projectedCheckInSchema = z.object({
  id: z.string().uuid(), date: z.iso.date(), response: checkInInstrumentSchema,
}).strict();
