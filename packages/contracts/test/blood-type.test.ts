import { describe, expect, it } from "vitest";

import {
  BLOOD_TYPE_RESULT_ANALYTE,
  BLOOD_TYPE_RESULT_SLUG,
  combineBloodTypeRows,
  isBloodTypeResultLabel,
  parseBloodType,
} from "../src/index.ts";

describe("blood type parsing", () => {
  it.each([
    ["AB+", "AB+"],
    ["ab pos", "AB+"],
    ["AB Positive", "AB+"],
    ["O neg", "O-"],
    ["O−", "O-"],
    ["0 negative", "O-"],
    ["B (Rh positive)", "B+"],
    ["Blood type: A negative", "A-"],
    ["ABO/Rh: O+", "O+"],
  ])("reads %s as %s", (text, value) => {
    expect(parseBloodType(text)?.value).toBe(value);
  });

  it.each(["unknown", "AB", "positive", "type A", "AB+ maybe", "C+"])("rejects %s", (text) => {
    expect(parseBloodType(text)).toBeNull();
  });

  it("splits the group and Rh factor", () => {
    expect(parseBloodType("ab neg")).toEqual({ abo: "AB", rh: "negative", value: "AB-" });
  });
});

describe("blood type result labels", () => {
  it.each([BLOOD_TYPE_RESULT_SLUG, BLOOD_TYPE_RESULT_ANALYTE, "ABO Group", "ABO/Rh", "abo-rh", "Blood group", "ABO and Rh type"])(
    "recognizes %s",
    (label) => expect(isBloodTypeResultLabel(label)).toBe(true),
  );

  it.each(["Rh Type", "Metabolic panel", "HIV-1/2 Ab", "Blood urea nitrogen"])("ignores %s", (label) => {
    expect(isBloodTypeResultLabel(label)).toBe(false);
  });

  it("combines separate ABO group and Rh rows from one panel", () => {
    expect(combineBloodTypeRows([
      { label: "ABO Group", text: "AB" },
      { label: "Rh Type", text: "Positive" },
    ])?.value).toBe("AB+");
    expect(combineBloodTypeRows([{ label: "ABO Group", text: "AB" }])).toBeNull();
    expect(combineBloodTypeRows([
      { label: "ABO Group", text: "AB" },
      { label: "Ferritin", text: "Positive" },
    ])).toBeNull();
  });
});
