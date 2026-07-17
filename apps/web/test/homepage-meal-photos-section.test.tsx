import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { MealPhotosSection } from "@/src/components/homepage/meal-photos-section";

test("MealPhotosSection renders the static photo calorie counting copy", () => {
  const markup = renderToStaticMarkup(createElement(MealPhotosSection));

  assert.match(markup, /Calorie counting/);
  assert.match(markup, /Coming next week/);
  assert.match(markup, /The calorie tracker you never open\./);
  assert.match(
    markup,
    /Take a picture of your plate and put your phone away\. No logging, no weighing, no forgetting\./,
  );
  assert.match(markup, /You take the picture\./);
  assert.match(
    markup,
    /Like you already do\. Don&#x27;t open anything, don&#x27;t type anything\./,
  );
  assert.match(markup, /Murph logs it by itself\./);
  assert.match(
    markup,
    /The app spots new food photos in the background and reads them right on your phone\./,
  );
  assert.match(markup, /Grain bowl/);
  assert.match(markup, /✓ LOGGED/);
  assert.match(markup, /Found in your camera roll · read on your phone/);
  assert.match(markup, /Brown rice/);
  assert.match(markup, /Roasted sweet potato/);
  assert.match(markup, /Half an avocado/);
  assert.match(markup, /Chickpeas/);
  assert.match(markup, /Arugula/);
  assert.match(markup, /Meal total/);
  assert.match(markup, /≈ 570 cal/);
  assert.match(markup, /Your tally texts you at night\./);
  assert.match(
    markup,
    /Calories, macros, and streaks, in the same thread as everything else\./,
  );
  assert.match(markup, /Murph · 9:30 PM/);
  assert.match(
    markup,
    /Dinner closed you out at 2,140\. That&#x27;s five days straight hitting your protein target\./,
  );
  assert.match(markup, /Daily tally/);
  assert.match(markup, /3 meals/);
  assert.match(markup, /2,140 cal/);
  assert.match(markup, /138 g/);
  assert.match(markup, /214 g/);
  assert.match(markup, /81 g/);
  assert.doesNotMatch(markup, /personal health assistant/i);
});
