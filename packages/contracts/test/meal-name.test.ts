import { describe, expect, it } from "vitest";
import { mealNameViolation } from "../src/companion-meals.ts";

describe("shared meal naming policy", () => {
  it.each([
    "turkey, couscous, peas and squash", "Apple peach almond butter protein smoothie",
    "Harbor Kitchen falafel wrap", "Estimated lentil soup", "Photo shows bean tacos",
    "Retained image reviewed: fish tacos", "rice and beans and greens", "bean tacos",
    "One two three four five six", "A".repeat(41), "",
  ])("detects legacy violation: %s", name => expect(mealNameViolation(name)).not.toBeNull());
  it.each(["Turkey grain bowl", "Apple peach smoothie", "Protein smoothie", "Falafel wrap",
    "New York strip steak", "Mac and cheese", "Greek salad", "Chicken Kiev", "Berry mango PB smoothie"])(
    "accepts natural dish: %s", name => expect(mealNameViolation(name)).toBeNull());
});
