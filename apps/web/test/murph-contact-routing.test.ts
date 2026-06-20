import assert from "node:assert/strict";

import { afterEach, test } from "vitest";

import {
  MURPH_CONTACT_EMAIL,
  MURPH_TELEGRAM_URL,
  normalizeMurphTelegramUsername,
  resolveMurphContactOptions,
  resolveMurphTelegramBotUsername,
  resolveMurphWebmailShortcut,
} from "@/src/lib/murph-contact-routing";

const originalMurphTelegramUsernameOverride = process.env.MURPH_TELEGRAM_USERNAME_OVERRIDE;

afterEach(() => {
  if (originalMurphTelegramUsernameOverride === undefined) {
    delete process.env.MURPH_TELEGRAM_USERNAME_OVERRIDE;
  } else {
    process.env.MURPH_TELEGRAM_USERNAME_OVERRIDE = originalMurphTelegramUsernameOverride;
  }
});

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

test("resolveMurphContactOptions honors the Murph Telegram username override", () => {
  process.env.MURPH_TELEGRAM_USERNAME_OVERRIDE = "@murphdevelopment_bot";

  const options = resolveMurphContactOptions({
    contactChannels: { telegram: true },
    message: {
      body: "Start local dev",
    },
  });

  assert.equal(options[0]?.copyValue, "@murphdevelopment_bot");
  assert.equal(
    options[0]?.href,
    "tg://resolve?domain=murphdevelopment_bot&text=Start%20local%20dev",
  );
  assert.equal(options[0]?.target, undefined);
  assert.equal(options[0]?.rel, undefined);
});

test("resolveMurphContactOptions uses Telegram app links for prefilled text", () => {
  process.env.MURPH_TELEGRAM_USERNAME_OVERRIDE = "@murphdevelopment_bot";

  const options = resolveMurphContactOptions({
    contactChannels: { telegram: true },
    message: {
      body: "Let's sync: A&B",
    },
  });

  assert.equal(
    options[0]?.href,
    "tg://resolve?domain=murphdevelopment_bot&text=Let's%20sync%3A%20A%26B",
  );
});

test("resolveMurphTelegramBotUsername falls back when the override is invalid", () => {
  assert.equal(
    resolveMurphTelegramBotUsername({
      MURPH_TELEGRAM_USERNAME_OVERRIDE: "not valid",
    }),
    "withmurph_bot",
  );
  assert.equal(normalizeMurphTelegramUsername("@murphdevelopment_bot"), "murphdevelopment_bot");
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

test("resolveMurphWebmailShortcut wraps Proton Mail and Fastmail addresses as mailto handlers", () => {
  const proton = resolveMurphWebmailShortcut({
    address: "murph+alias@mail.withmurph.ai",
    subject: "Hey Murph",
    userEmailAddress: "member@proton.me",
  });
  assert.equal(proton?.label, "Proton Mail");
  assert.ok(proton?.href.startsWith("https://mail.proton.me/inbox?mailto="));
  assert.ok(
    proton?.href.includes(
      encodeURIComponent("mailto:murph+alias@mail.withmurph.ai?subject=Hey%20Murph"),
    ),
  );

  const fastmail = resolveMurphWebmailShortcut({
    address: MURPH_CONTACT_EMAIL,
    userEmailAddress: "member@fastmail.com",
  });
  assert.equal(fastmail?.label, "Fastmail");
  assert.ok(fastmail?.href.startsWith("https://app.fastmail.com/mail/compose?mailto="));
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
