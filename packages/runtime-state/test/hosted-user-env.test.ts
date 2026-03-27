import assert from "node:assert/strict";

import { test } from "vitest";

import {
  createHostedVerifiedEmailUserEnv,
  HOSTED_USER_VERIFIED_EMAIL_ENV_KEY,
  HOSTED_USER_VERIFIED_EMAIL_VERIFIED_AT_ENV_KEY,
  normalizeHostedVerifiedEmailAddress,
  normalizeHostedVerifiedEmailTimestamp,
  readHostedVerifiedEmailFromEnv,
} from "../src/index.ts";

test("hosted verified email env helpers normalize and round-trip a verified email", () => {
  const env = createHostedVerifiedEmailUserEnv({
    address: " user@example.com ",
    verifiedAt: "2026-03-27T08:30:00.000Z",
  });

  assert.deepEqual(env, {
    [HOSTED_USER_VERIFIED_EMAIL_ENV_KEY]: "user@example.com",
    [HOSTED_USER_VERIFIED_EMAIL_VERIFIED_AT_ENV_KEY]: "2026-03-27T08:30:00.000Z",
  });
  assert.deepEqual(readHostedVerifiedEmailFromEnv(env), {
    address: "user@example.com",
    verifiedAt: "2026-03-27T08:30:00.000Z",
  });
});

test("hosted verified email env helpers reject invalid addresses and timestamps", () => {
  assert.equal(normalizeHostedVerifiedEmailAddress("bad address"), null);
  assert.equal(normalizeHostedVerifiedEmailTimestamp("not-a-date"), null);
  assert.equal(readHostedVerifiedEmailFromEnv({
    [HOSTED_USER_VERIFIED_EMAIL_ENV_KEY]: "bad address",
  }), null);
  assert.throws(
    () =>
      createHostedVerifiedEmailUserEnv({
        address: "bad address",
        verifiedAt: "2026-03-27T08:30:00.000Z",
      }),
    /Hosted verified email address must be a valid email address\./u,
  );
});

test("hosted verified email env helpers omit an invalid verified-at value instead of rejecting the email", () => {
  assert.deepEqual(
    readHostedVerifiedEmailFromEnv({
      [HOSTED_USER_VERIFIED_EMAIL_ENV_KEY]: "user@example.com",
      [HOSTED_USER_VERIFIED_EMAIL_VERIFIED_AT_ENV_KEY]: "yesterday sometime",
    }),
    {
      address: "user@example.com",
      verifiedAt: null,
    },
  );
});
