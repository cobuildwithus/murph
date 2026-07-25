import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { test } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("stale launch documents do not gate current inbound texts or container wakes", () => {
  const currentConversationPath = [
    "app/api/hosted-onboarding/linq/webhook/route.ts",
    "src/lib/hosted-onboarding/webhook-service.ts",
    "src/lib/hosted-onboarding/webhook-provider-linq.ts",
    "src/lib/hosted-onboarding/webhook-service-wake.ts",
    "app/api/internal/hosted-mailbox/fetch/route.ts",
    "src/lib/hosted-mailbox/runtime-access.ts",
  ];

  for (const relativePath of currentConversationPath) {
    const source = readSource(relativePath);
    assert.doesNotMatch(
      source,
      /assertHostedLaunchRequiredConsentGranted|HOSTED_CONSENT_REQUIRED|lib\/legal\/consent/u,
      `${relativePath} must preserve current inbound reply handling across legal document updates`,
    );
  }
});
