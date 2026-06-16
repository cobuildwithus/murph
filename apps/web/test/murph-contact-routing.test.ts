import assert from "node:assert/strict";

import { test } from "vitest";

import {
  MURPH_CONTACT_EMAIL,
  MURPH_TELEGRAM_URL,
  resolveMurphContactOptions,
  resolveMurphWebmailShortcut,
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

test("resolveMurphContactOptions exposes copy values for email and text", () => {
  const options = resolveMurphContactOptions({
    contactChannels: { email: true, telegram: true, text: true },
    murphEmailAddress: "murph+alias123@mail.withmurph.ai",
    murphPhoneNumber: "+15550100001",
  });

  assert.equal(options[0]?.copyValue, "+15550100001");
  assert.equal(options[1]?.copyValue, "@withmurph_bot");
  assert.equal(options[2]?.copyValue, "murph+alias123@mail.withmurph.ai");
});

test("resolveMurphContactOptions adds a Gmail shortcut for gmail users", () => {
  const options = resolveMurphContactOptions({
    contactChannels: { email: true, telegram: false, text: false },
    murphEmailAddress: "murph+alias123@mail.withmurph.ai",
    userEmailAddress: "member@gmail.com",
  });

  const webmail = options[0]?.webmail;
  assert.equal(webmail?.label, "Gmail");
  assert.ok(webmail?.href.startsWith("https://mail.google.com/mail/u/0/?"));
  assert.ok(!webmail?.href.includes("fs=1"));
  assert.ok(webmail?.href.includes("tf=cm"));
  assert.ok(webmail?.href.includes("to=murph%2Balias123%40mail.withmurph.ai"));
  assert.ok(webmail?.href.includes("su=Hey+Murph"));
});

test("resolveMurphWebmailShortcut maps outlook-family and yahoo domains", () => {
  assert.equal(
    resolveMurphWebmailShortcut({
      address: MURPH_CONTACT_EMAIL,
      userEmailAddress: "someone@hotmail.com",
    })?.label,
    "Outlook",
  );
  assert.equal(
    resolveMurphWebmailShortcut({
      address: MURPH_CONTACT_EMAIL,
      userEmailAddress: "someone@yahoo.com",
    })?.label,
    "Yahoo Mail",
  );
});

test("resolveMurphWebmailShortcut returns null for unknown or missing domains", () => {
  assert.equal(
    resolveMurphWebmailShortcut({
      address: MURPH_CONTACT_EMAIL,
      userEmailAddress: "someone@customdomain.com",
    }),
    null,
  );
  assert.equal(
    resolveMurphWebmailShortcut({
      address: MURPH_CONTACT_EMAIL,
      userEmailAddress: null,
    }),
    null,
  );
  assert.equal(
    resolveMurphWebmailShortcut({
      address: MURPH_CONTACT_EMAIL,
      userEmailAddress: "not-an-email",
    }),
    null,
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
