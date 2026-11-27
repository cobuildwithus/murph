import { foodWeekDependencies, foodWeekLimits, type FoodWeekKey } from "@murphai/contracts";

const rows: readonly [FoodWeekKey, string, string, "servings" | "days" | "percent" | "drinks", "more" | "less"][] = [
  ["vegetables", "Vegetables", "How many portions of vegetables did you eat in the last 7 days?", "servings", "more"],
  ["fruit", "Whole fruit", "How many portions of whole fruit did you eat in the last 7 days?", "servings", "more"],
  ["whole_grains", "Whole grains", "How many portions of whole grains did you eat in the last 7 days?", "servings", "more"],
  ["plants", "Beans and nuts", "How many portions of beans, nuts or seeds did you eat in the last 7 days?", "servings", "more"],
  ["red_meat", "Red meat", "How many portions of unprocessed red meat did you eat in the last 7 days?", "servings", "less"],
  ["processed_meat", "Processed meat", "How many portions of processed meat did you eat in the last 7 days?", "servings", "less"],
  ["sweet_drinks", "Sweet drinks", "How many portions of sweet drinks or juice did you have in the last 7 days?", "servings", "less"],
  ["sweets", "Sweet foods", "How many portions of sweets did you eat in the last 7 days?", "servings", "less"],
  ["eating_days", "Days eaten", "On how many of the last 7 days did you eat?", "days", "more"],
  ["seafood", "Fish and shellfish", "How many portions of lower-mercury fish or shellfish did you eat in the last 7 days, excluding fried seafood?", "servings", "more"],
  ["plant_oil", "Plant oils", "In the last 7 days, what percent of the time was liquid plant oil your main added fat?", "percent", "more"],
  ["fried_days", "Fried foods", "On how many of the last 7 days did you eat deep-fried savory food?", "days", "less"],
  ["packaged_days", "Salty snacks", "On how many of the last 7 days did you eat salty packaged snacks or instant meals?", "days", "less"],
  ["alcohol", "Standard drinks", "How many standard drinks did you have in the last 7 days?", "drinks", "less"],
  ["max_occasion", "Most in one sitting", "In the last 7 days, what was the largest number of standard drinks you had in one sitting?", "drinks", "less"],
];
const units = { servings: "portions", days: "days", percent: "percent", drinks: "standard drinks" };
export const foodWeekQuestions = rows.map(([key, label, text, kind, group]) => ({
  key, label, text, kind, unit: units[kind], group, min: 0, max: foodWeekLimits[key], maxFrom: foodWeekDependencies[key]?.maxFrom,
}));
