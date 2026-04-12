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
process.env.TZ ??= "UTC";
const HOSTED_WEB_TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:1/murph_test";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = HOSTED_WEB_TEST_DATABASE_URL;
}

afterEach(() => {
  delete globalForHostedWebTests.__murphHostedOnboardingEnv;
  delete globalForHostedWebTests.__murphHostedOnboardingStripe;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
