import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { test } from "vitest";

import {
  dmSans400FontPath,
  dmSans600FontPath,
} from "../app/font-files";
import {
  DM_SANS_400_FONT_SHA256,
  measureDmSans400Text,
} from "../src/components/imessage/dm-sans-400-card-metrics";
import {
  DM_SANS_600_FONT_SHA256,
  measureDmSans600Text,
} from "../src/components/imessage/dm-sans-600-card-metrics";

const FOUR_COLUMN_VALUE_WIDTH = 160.05;

test("card metrics stay pinned to the exact bundled DM Sans font", async () => {
  const font = await readFile(dmSans400FontPath);
  assert.equal(
    createHash("sha256").update(font).digest("hex"),
    DM_SANS_400_FONT_SHA256,
  );

  assertClose(measureDmSans400Text("deep sleep and", 23), 164.519);
  assertClose(measureDmSans400Text("mood guidance", 23), 166.198);
  assertClose(measureDmSans400Text("Bodyweight ×", 23), 144.693);
  assertClose(measureDmSans400Text("slow gait, ankle", 23), 160.862);
  assertClose(measureDmSans400Text("impact, or load", 23), 160.563);
});

test("native-parity semibold text stays pinned to its exact bundled font", async () => {
  const font = await readFile(dmSans600FontPath);
  assert.equal(
    createHash("sha256").update(font).digest("hex"),
    DM_SANS_600_FONT_SHA256,
  );

  assertClose(
    measureDmSans600Text("activity standings progress challenge", 64, -0.025),
    1098.176,
  );
  assertClose(
    measureDmSans600Text("morning recovery workout focus", 64, -0.025),
    958.144,
  );
  assertClose(
    measureDmSans600Text("More progress may be pending", 56),
    838.88,
  );
  assertClose(
    measureDmSans600Text("OF 1,000,000 PTS", 41, 0.06),
    391.837,
  );
});

test("positive kerning stays inside the measured four-column lines", () => {
  for (const line of ["slow gait,", "ankle impact,", "or load"]) {
    assert.ok(measureDmSans400Text(line, 23) <= FOUR_COLUMN_VALUE_WIDTH);
  }
  assert.ok(
    measureDmSans400Text("slow gait, ankle", 23) > FOUR_COLUMN_VALUE_WIDTH,
  );
  assert.ok(
    measureDmSans400Text("impact, or load", 23) > FOUR_COLUMN_VALUE_WIDTH,
  );
});

test("real-font word lines fit the four-column value width", () => {
  for (const line of ["deep sleep", "and mood", "guidance"]) {
    assert.ok(measureDmSans400Text(line, 23) <= FOUR_COLUMN_VALUE_WIDTH);
  }
  assert.ok(
    measureDmSans400Text("deep sleep and", 23) > FOUR_COLUMN_VALUE_WIDTH,
  );
  assert.ok(
    measureDmSans400Text("and mood guidance", 23) > FOUR_COLUMN_VALUE_WIDTH,
  );
});

function assertClose(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 0.000_001);
}
