import { expect, it } from "vitest";

import { activityNameTitle, activityNameWord, admitActivityName, cleanActivityName } from "./activity-name";
import cases from "./fixtures/activity-names.json";

const invalidName = { code: "HEALTH_ACTIVITY_NAME_INVALID", httpStatus: 400, retryable: false };

it.each(cases)("applies shared activity-name rules to $id", ({ input, cleaned, word, title, refused }) => {
  expect(cleanActivityName(input)).toBe(cleaned);
  if (cleaned !== null) {
    expect(activityNameWord(cleaned)).toBe(word);
    expect(activityNameTitle(cleaned)).toBe(title);
  }
  if (cleaned === null || refused) {
    expect(() => admitActivityName(input, "choice")).toThrowError(expect.objectContaining(invalidName));
    expect(() => admitActivityName(input, "recording")).toThrowError(expect.objectContaining(invalidName));
    return;
  }
  expect(admitActivityName(input, "choice")).toBe(cleaned);
  expect(admitActivityName(cleaned, "recording")).toBe(cleaned);
  if (input !== cleaned) {
    expect(() => admitActivityName(input, "recording")).toThrowError(expect.objectContaining(invalidName));
  }
});
