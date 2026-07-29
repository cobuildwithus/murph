import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildClubPilotMailto,
  MURPH_CLUBS_EMAIL,
} from "../src/lib/club-contact";

test("buildClubPilotMailto keeps one clubs inbox and useful pilot prompts", () => {
  const url = new URL(buildClubPilotMailto());

  assert.equal(url.protocol, "mailto:");
  assert.equal(url.pathname, MURPH_CLUBS_EMAIL);
  assert.equal(url.searchParams.get("subject"), "Club challenge pilot");
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
