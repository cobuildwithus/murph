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

test("pre-member group join outreach is not consent-gated", () => {
  const reactionSource = readSource(
    "src/lib/hosted-groups/join-offer-reaction.ts",
  );
  const branchStart = reactionSource.indexOf("  if (!member) {");
  const branchEnd = reactionSource.indexOf(
    "\n  if (\n    member.suspendedAt",
    branchStart,
  );
  assert.ok(branchStart >= 0 && branchEnd > branchStart);
  assert.doesNotMatch(
    reactionSource.slice(branchStart, branchEnd),
    /assertHostedLaunchRequiredConsentGranted|HOSTED_CONSENT_REQUIRED|lib\/legal\/consent/u,
    "the pre-member reaction path must enqueue outreach without a consent grant",
  );

  for (const relativePath of [
    "src/lib/hosted-groups/group-join-outreach-store.ts",
    "src/lib/hosted-groups/group-join-outreach-drain.ts",
    "app/api/internal/hosted-onboarding/stripe/cron/route.ts",
  ]) {
    assert.doesNotMatch(
      readSource(relativePath),
      /assertHostedLaunchRequiredConsentGranted|HOSTED_CONSENT_REQUIRED|lib\/legal\/consent/u,
      `${relativePath} must not gate texting on consent`,
    );
  }
});
