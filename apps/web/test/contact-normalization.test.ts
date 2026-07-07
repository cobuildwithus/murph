import assert from "node:assert/strict";

import { test } from "vitest";

import {
  normalizeHostedEmailAddress,
  normalizeHostedTelegramUsernameForLookup,
} from "@/src/lib/hosted-onboarding/contact-normalization";

test("normalizes hosted email addresses", () => {
  assert.equal(normalizeHostedEmailAddress(" MOM@Example.COM "), "mom@example.com");
  assert.equal(normalizeHostedEmailAddress("not-an-email"), null);
});

test("normalizes hosted Telegram usernames", () => {
  assert.equal(normalizeHostedTelegramUsernameForLookup(" @Dad_User "), "dad_user");
  assert.equal(normalizeHostedTelegramUsernameForLookup("@dad"), null);
});
