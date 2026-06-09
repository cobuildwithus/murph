import assert from "node:assert/strict";

import { test } from "vitest";

import {
  MURPH_CONTACT_EMAIL,
  MURPH_TELEGRAM_URL,
  resolveMurphContactOptions,
} from "@/src/lib/murph-contact-routing";

test("resolveMurphContactOptions returns connected channels in priority order", () => {
  const options = resolveMurphContactOptions({
    contactChannels: { email: true, telegram: true, text: true },
    murphEmailAddress: "murph+alias123@mail.withmurph.ai",
    murphPhoneNumber: "+15550100001",
  });

  assert.deepEqual(options.map((option) => option.kind), ["text", "telegram", "email"]);
  assert.equal(options[0]?.href, "sms:+15550100001");
  assert.equal(options[1]?.href, MURPH_TELEGRAM_URL);
  assert.equal(
    options[2]?.href,
    "mailto:murph+alias123@mail.withmurph.ai?subject=Hey%20Murph",
  );
});

test("resolveMurphContactOptions skips text without an assigned Murph number", () => {
  const options = resolveMurphContactOptions({
    contactChannels: { email: true, telegram: false, text: true },
    murphEmailAddress: "murph+alias123@mail.withmurph.ai",
    murphPhoneNumber: null,
  });

  assert.deepEqual(options.map((option) => option.kind), ["email"]);
});

test("resolveMurphContactOptions falls back to the public address without an alias", () => {
  const options = resolveMurphContactOptions({
    contactChannels: { email: true, telegram: false, text: false },
    murphEmailAddress: null,
    murphPhoneNumber: null,
  });

  assert.equal(
    options[0]?.href,
    `mailto:${MURPH_CONTACT_EMAIL}?subject=Hey%20Murph`,
  );
});

test("resolveMurphContactOptions returns no options without connected channels", () => {
  assert.deepEqual(
    resolveMurphContactOptions({
      contactChannels: null,
      murphPhoneNumber: "+15550100001",
    }),
    [],
  );
});
