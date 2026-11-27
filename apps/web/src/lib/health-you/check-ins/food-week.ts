import { foodWeekDependencies, foodWeekLimits, type FoodWeekKey } from "@murphai/contracts";

const rows: readonly [FoodWeekKey, string, string, "servings" | "days" | "percent" | "drinks", "more" | "less"][] = [
  ["vegetables", "Vegetable portions", "Vegetable portions?", "servings", "more"],
  ["fruit", "Whole fruit", "Whole fruit portions?", "servings", "more"],
  ["whole_grains", "Whole grains", "Whole grain portions?", "servings", "more"],
  ["plants", "Beans and nuts", "Portions of beans, nuts or seeds?", "servings", "more"],
  ["red_meat", "Red meat", "Unprocessed red meat portions?", "servings", "less"],
  ["processed_meat", "Processed meat", "Processed meat portions?", "servings", "less"],
  ["sweet_drinks", "Sweet drinks", "Servings of sweet drinks or juice?", "servings", "less"],
  ["sweets", "Sweet foods", "Portions of sweets?", "servings", "less"],
  ["eating_days", "Days eaten", "On how many days did you eat?", "days", "more"],
  ["seafood", "Fish and shellfish", "Servings of lower-mercury, nonfried fish or shellfish?", "servings", "more"],
  ["plant_oil", "Plant oils", "How often was the main added fat liquid plant oil (%)?", "percent", "more"],
  ["fried_days", "Fried foods", "Days with deep-fried savory food?", "days", "less"],
  ["packaged_days", "Salty snacks", "Days with salty packaged snacks or instant meals?", "days", "less"],
  ["alcohol", "Standard drinks", "How many standard drinks did you have this week?", "drinks", "less"],
  ["max_occasion", "Most in one sitting", "What was the most you drank in one sitting this week, in standard drinks?", "drinks", "less"],
];
export const foodWeekQuestions = rows.map(([key, label, text, kind, group]) => ({
  key, label, text, kind, group, min: 0, max: foodWeekLimits[key], maxFrom: foodWeekDependencies[key]?.maxFrom,
}));
