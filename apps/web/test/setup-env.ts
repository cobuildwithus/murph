import { afterEach, vi } from "vitest";

import { createHostedSecretCodec } from "../src/lib/device-sync/crypto";
import { setHostedSecureBoxStringTestCodecForTests } from "../src/lib/hosted-crypto/secure-box";

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

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = HOSTED_WEB_TEST_DATABASE_URL;
}
process.env.HOSTED_CONTACT_PRIVACY_KEYS ??= `v1:${HOSTED_WEB_TEST_KEY}`;
process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION ??= "v1";
process.env.HOSTED_MAILBOX_FINGERPRINT_KEY ??= HOSTED_WEB_TEST_KEY;

const hostedSecureBoxTestCodec = createHostedSecretCodec({
  key: Buffer.alloc(32, 7),
  keyVersion: "test-v1",
});

setHostedSecureBoxStringTestCodecForTests({
  decrypt(input) {
    const decoded = JSON.parse(hostedSecureBoxTestCodec.decrypt(input.value)) as {
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
    return hostedSecureBoxTestCodec.encrypt(JSON.stringify({
      lane: input.lane,
      scope: input.scope,
      userId: input.userId,
      value: input.value,
    }));
  },
});

afterEach(() => {
  delete globalForHostedWebTests.__murphHostedOnboardingEnv;
  delete globalForHostedWebTests.__murphHostedOnboardingStripe;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
