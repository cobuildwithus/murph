import { afterEach, vi } from "vitest";

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
process.env.HOSTED_WEB_ENCRYPTION_KEY ??= HOSTED_WEB_TEST_KEY;
process.env.HOSTED_WEB_ENCRYPTION_KEY_VERSION ??= "v1";
process.env.HOSTED_WAKE_ENCRYPTION_KEY ??= HOSTED_WEB_TEST_KEY;
process.env.HOSTED_WAKE_ENCRYPTION_KEY_VERSION ??= "v1";

afterEach(() => {
  delete globalForHostedWebTests.__murphHostedOnboardingEnv;
  delete globalForHostedWebTests.__murphHostedOnboardingStripe;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
