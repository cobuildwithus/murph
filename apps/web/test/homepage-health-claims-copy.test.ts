import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { test } from "vitest";

// Homepage demos are advertising: a chat bubble that rules out an alternative
// cause, clears someone for a session, or prescribes a dose reads as a claim
// no matter what the footer says. These guards keep the demo copy at
// observation level.
const HOMEPAGE_SOURCES = [
  "asks-section.tsx",
  "hero-clocks-in.tsx",
  "personas-section.tsx",
] as const;

const RETIRED_PHRASES = [
  // Attributing a result to a single cause from a short personal comparison.
  /is the lever/u,
  /are doing the work/u,
  /are finally showing up/u,
  /it['’]s the caffeine, not the stress/u,
  /to be sure\./u,
  // Clearance and dosing language.
  /\bCleared for\b/u,
  /can hit the hard session/u,
  /\d+g of carbs/u,
  /reads clean/u,
  /load clean/u,
  // Deciding a supplement or dose off a biomarker.
  /Same dose since/u,
  /moving you the right way/u,
] as const;

function readHomepageSource(fileName: string): string {
  return readFileSync(
    path.resolve(process.cwd(), "apps/web/src/components/homepage", fileName),
    "utf8",
  );
}

test("homepage demo copy avoids causal, clearance, and dosing claims", () => {
  for (const fileName of HOMEPAGE_SOURCES) {
    const source = readHomepageSource(fileName);
    for (const phrase of RETIRED_PHRASES) {
      assert.doesNotMatch(
        source,
        phrase,
        `${fileName} still contains retired claim copy: ${String(phrase)}`,
      );
    }
  }
});
