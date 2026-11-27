import { foodWeekLimits, type FoodWeekKey } from "@murphai/contracts";

const rows: readonly [FoodWeekKey, string, "servings" | "days" | "percent" | "drinks", "more" | "less"][] = [
  ["vegetables", "Vegetable portions?", "servings", "more"],
  ["fruit", "Whole fruit portions?", "servings", "more"],
  ["whole_grains", "Whole grain portions?", "servings", "more"],
  ["plants", "Portions of beans, nuts or seeds?", "servings", "more"],
  ["red_meat", "Unprocessed red meat portions?", "servings", "less"],
  ["processed_meat", "Processed meat portions?", "servings", "less"],
  ["sweet_drinks", "Servings of sweet drinks or juice?", "servings", "less"],
  ["sweets", "Portions of sweets?", "servings", "less"],
  ["eating_days", "On how many days did you eat?", "days", "more"],
  ["seafood", "Servings of lower-mercury, nonfried fish or shellfish?", "servings", "more"],
  ["plant_oil", "How often was the main added fat liquid plant oil (%)?", "percent", "more"],
  ["fried_days", "Days with deep-fried savory food?", "days", "less"],
  ["packaged_days", "Days with salty packaged snacks or instant meals?", "days", "less"],
  ["alcohol", "Standard drinks this week? Most in one sitting?", "drinks", "less"],
];
export const foodWeekQuestions = rows.map(([key, text, kind, group]) => ({ key, text, kind, group, max: foodWeekLimits[key] }));
