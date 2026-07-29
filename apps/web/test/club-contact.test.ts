import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildClubChallengeMailto,
  MURPH_CLUBS_EMAIL,
} from "../src/lib/club-contact";

test("buildClubChallengeMailto keeps one clubs inbox and useful challenge prompts", () => {
  const mailto = buildClubChallengeMailto();
  const url = new URL(mailto);

  assert.equal(url.protocol, "mailto:");
  assert.equal(url.pathname, MURPH_CLUBS_EMAIL);
  assert.doesNotMatch(mailto, /\+/);
  assert.match(mailto, /subject=Start%20a%20Murph%20club%20challenge/);
  assert.match(mailto, /Club%20or%20community%3A%0AApproximate%20participants/);
  assert.equal(
    url.searchParams.get("subject"),
    "Start a Murph club challenge",
  );
  assert.equal(
    url.searchParams.get("body"),
    [
      "Club or community:",
      "Approximate participants:",
      "Challenge idea:",
      "Ideal start date:",
    ].join("\n"),
  );
});
