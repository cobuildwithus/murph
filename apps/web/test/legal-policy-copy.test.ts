import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { test } from "vitest";

function readLegalMarkdown(fileName: string): string {
  return readFileSync(
    path.resolve(process.cwd(), "apps/web/legal", fileName),
    "utf8",
  );
}

test("Terms keep health data model-training and adtech promises aligned with the Privacy Policy", () => {
  const terms = readLegalMarkdown("terms-of-service.md");

  assert.match(
    terms,
    /we do not use health data, consumer health data, HealthKit data, wearable data, journal content, health files, health memories, health prompts, assistant outputs based on health data, imported records, or derived health insights to train, fine-tune, or improve Murph's or any third party's general-purpose AI models/u,
  );
  assert.match(
    terms,
    /We do not sell, rent, license, or otherwise disclose consumer health data, HealthKit data, wearable data, journal content, health files, health memories, health prompts, or derived health insights to data brokers, advertising networks, third-party advertising platforms, information resellers, or similar parties/u,
  );
  assert.match(
    terms,
    /We do not use such data for targeted advertising, cross-context behavioral advertising, retargeting, lookalike audience creation, ad attribution, ad measurement, insurance\/employment\/credit eligibility decisions, or general-purpose AI model training/u,
  );
});

test("Privacy Policy includes consumer health breach-notice language", () => {
  const privacyPolicy = readLegalMarkdown("privacy-policy.md");

  assert.match(
    privacyPolicy,
    /If Murph determines that a security incident triggers a legally required breach notice, including under applicable consumer health data, personal data, health breach notification, or similar laws/u,
  );
  assert.match(
    privacyPolicy,
    /Murph will provide notices to affected users, regulators, service providers, or other parties as required by law/u,
  );
});

test("Consumer Health Data Privacy Policy keeps the stronger model-training promise", () => {
  const consumerHealthPolicy = readLegalMarkdown(
    "consumer-health-data-privacy-policy.md",
  );

  assert.match(
    consumerHealthPolicy,
    /Unless we present a separate, specific opt-in consent that clearly identifies the Consumer Health Data involved and applicable law permits the use/u,
  );
  assert.match(
    consumerHealthPolicy,
    /Murph does not use Consumer Health Data you submit through Murph to train, fine-tune, or improve Murph’s or any third party’s general-purpose AI models/u,
  );
  assert.match(
    consumerHealthPolicy,
    /third-party AI model providers that process Consumer Health Data for the Hosted Service not to use that data to train their models/u,
  );
});
