import { afterEach, vi } from "vitest";

import { setHostedSecureBoxStringTestCodecForTests } from "../src/lib/hosted-crypto/secure-box";

vi.mock("server-only", () => ({}));

const globalForHostedWebTests = globalThis as typeof globalThis & {
  __murphHostedOnboardingEnv?: unknown;
  __murphHostedOnboardingStripe?: unknown;
};

if (!process.env.NODE_ENV) {
  Object.assign(process.env, {
    NODE_ENV: "test",
  });
}
process.env.VITEST ||= "1";
process.env.TZ ??= "UTC";
const HOSTED_WEB_TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:1/murph_test";
const HOSTED_WEB_TEST_KEY = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";
const HOSTED_WEB_TEST_APP_SESSION_HMAC_KEY = Buffer.alloc(32, 8).toString("base64url");

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = HOSTED_WEB_TEST_DATABASE_URL;
}
process.env.HOSTED_CONTACT_PRIVACY_KEYS ??= `v1:${HOSTED_WEB_TEST_KEY}`;
process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION ??= "v1";
process.env.HOSTED_APP_SESSION_HMAC_KEY ??= HOSTED_WEB_TEST_APP_SESSION_HMAC_KEY;
process.env.HOSTED_MAILBOX_FINGERPRINT_KEY ??= HOSTED_WEB_TEST_KEY;
process.env.HOSTED_DEVICE_ROUTING_INDEX_KEY ??= HOSTED_WEB_TEST_KEY;

setHostedSecureBoxStringTestCodecForTests({
  decrypt(input) {
    const decoded = JSON.parse(Buffer.from(input.value.replace(/^hsb-test:/u, ""), "base64url").toString("utf8")) as {
      lane?: string;
      scope?: string;
      userId?: string;
      value?: string;
    };
    if (
      decoded.lane !== input.lane
      || decoded.scope !== input.scope
      || decoded.userId !== input.userId
      || typeof decoded.value !== "string"
    ) {
      throw new Error("Hosted secure-box test codec metadata mismatch.");
    }
    return decoded.value;
  },
  encrypt(input) {
    return `hsb-test:${Buffer.from(JSON.stringify({
      lane: input.lane,
      scope: input.scope,
      userId: input.userId,
      value: input.value,
    }), "utf8").toString("base64url")}`;
  },
});

afterEach(() => {
  delete globalForHostedWebTests.__murphHostedOnboardingEnv;
  delete globalForHostedWebTests.__murphHostedOnboardingStripe;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
