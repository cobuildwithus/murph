import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveVitestBucketFiles } from "../../config/vitest-test-buckets.js";

const appDir = path.dirname(fileURLToPath(import.meta.url));

export const hostedWebVitestProjectSpecs = resolveVitestBucketFiles(
  path.join(appDir, "test"),
  [
    {
      name: "hosted-web-onboarding-integrations",
      patterns: [
        "hosted-onboarding-invite-send-code.test.ts",
        "hosted-onboarding-linq-*.test.ts",
        "hosted-onboarding-privy*.test.ts",
        "hosted-onboarding-telegram-dispatch.test.ts",
        "hosted-phone-auth.test.ts",
        "invite-status-client.test.ts",
      ],
    },
    {
      name: "hosted-web-onboarding-core",
      patterns: ["hosted-onboarding-*.test.ts"],
    },
    {
      name: "hosted-web-execution",
      patterns: [
        "agent-*.test.ts",
        "hosted-execution-*.test.ts",
        "hosted-member-email-runtime-boundary.test.ts",
        "internal.test.ts",
      ],
    },
    {
      name: "hosted-web-sync-settings",
      patterns: [
        "auth.test.ts",
        "device-sync-*.test.ts",
        "hosted-billing-settings.test.tsx",
        "hosted-device-sync-*.test.ts",
        "join-*.test.ts",
        "local-heartbeat-route.test.ts",
        "settings-*.test.ts",
      ],
    },
    {
      includeRemaining: true,
      name: "hosted-web-store-config",
      patterns: [
        "contact-privacy-*.test.ts",
        "crypto.test.ts",
        "dev-local.test.ts",
        "env.test.ts",
        "hosted-contact-privacy.test.ts",
        "http.test.ts",
        "install-script.test.ts",
        "layout.test.ts",
        "next-config.test.ts",
        "page.test.ts",
        "prisma-store-*.test.ts",
        "public-url.test.ts",
        "route-loading.test.tsx",
        "vercel-config.test.ts",
      ],
    },
  ],
  {
    ignorePatterns: [
      "*.db.test.ts",
    ],
    label: "apps/web/test",
  },
);
