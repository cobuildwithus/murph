import { describe, expect, it } from "vitest";
import { mealNameViolation, preserveMealNameDetails } from "../src/companion-meals.ts";

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
  it("keeps all source detail once", () => {
    const old = "Harbor Kitchen falafel wrap and iced tea";
    const note = preserveMealNameDetails(old, "One wrap, half a glass.");
    expect(note).toBe(`One wrap, half a glass.\n${old}`);
    expect(preserveMealNameDetails(old, note)).toBe(note);
    expect(preserveMealNameDetails("Bean tacos", "Two BEAN TACOS with salsa")).toBe("Two BEAN TACOS with salsa");
  });
});
