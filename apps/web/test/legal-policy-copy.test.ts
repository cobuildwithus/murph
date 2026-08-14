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
    /We do not use health data, consumer health data, HealthKit data, wearable data, journal content, health files, health memories, prompts involving health data, assistant outputs based on health data, or derived health insights to train, fine-tune, or improve Murph's or any third party's general-purpose AI models/u,
  );
  assert.match(
    terms,
    /This applies even if you provide feedback/u,
  );
  assert.match(
    terms,
    /Third-party AI model providers that process Murph-managed health data for the Hosted Service must be configured or contractually restricted not to use that data to train their models/u,
  );
  assert.match(
    terms,
    /We do not sell, rent, license, or otherwise disclose consumer health data, HealthKit data, wearable data, journal content, health files, health memories, health prompts, or derived health insights to data brokers, advertising networks, third-party advertising platforms, information resellers, or similar parties/u,
  );
  assert.match(
    terms,
    /We do not use such data for targeted advertising, cross-context behavioral advertising, retargeting, lookalike audience creation, ad attribution, ad measurement, insurance\/employment\/credit eligibility decisions, or general-purpose AI model training/u,
  );
  assert.match(
    terms,
    /We do not use consumer health data for advertising, sale, data brokerage, or general-purpose model training/u,
  );
  assert.match(terms, /### Observational Results and Illustrative Examples/u);
  assert.match(terms, /does not establish that an intervention caused an outcome/u);
  assert.match(terms, /This is limited task-specific authority only/u);
  assert.match(terms, /### Groups, Family, Newsletters, and Delivered Copies/u);
  assert.match(terms, /### Source-Specific Connected-Service Rules/u);
  assert.match(terms, /Your instruction or consent does not authorize Murph to use data in a way the source provider prohibits/u);
  assert.match(terms, /### Connected-Service Provider Disclaimer/u);
  assert.doesNotMatch(terms, /Unless we present a separate, specific opt-in consent/u);
});

test("Privacy Policy keeps tightened health-data commitments and consumer-health pointer", () => {
  const privacyPolicy = readLegalMarkdown("privacy-policy.md");

  assert.match(
    privacyPolicy,
    /For health data and consumer health data, Murph uses identifiable data for product improvement only where necessary to provide, secure, support, troubleshoot, or maintain features you use/u,
  );
  assert.match(
    privacyPolicy,
    /Separate research consents, if offered, will be limited to the research or product-evaluation purpose described in that consent and will not authorize general-purpose AI model training on health data/u,
  );
  assert.match(
    privacyPolicy,
    /Murph does not connect an optional health source until you affirmatively enable it and authorize the permissions requested by the source, device, or platform/u,
  );
  assert.match(
    privacyPolicy,
    /Where applicable law requires separate consent for a disclosure beyond the service providers necessary to deliver the feature, Murph will request that consent separately/u,
  );
  assert.match(
    privacyPolicy,
    /Murph does not disclose HealthKit data to third parties except to service providers as necessary to provide or improve the health, fitness, wellness, import, export, sync, or personalization feature you request/u,
  );
  assert.match(
    privacyPolicy,
    /the store listing, Health Connect permission flow, and in-product legal links will point users to the same HTML Privacy Policy/u,
  );
  assert.match(
    privacyPolicy,
    /We will not apply materially different sale, sharing, targeted-advertising, data-broker, eligibility-decision, or general-purpose model-training practices to previously collected health data unless we first provide required notice and obtain any required opt-in consent or authorization/u,
  );
  assert.match(
    privacyPolicy,
    /User-visible assistant history containing health data \| Until you delete it or your account is deleted/u,
  );
  assert.match(
    privacyPolicy,
    /Operational prompt\/tool traces containing health data \| Not retained by default outside user-visible history/u,
  );
  assert.match(
    privacyPolicy,
    /encryption at rest for hosted health data and sensitive account data/u,
  );
  assert.match(
    privacyPolicy,
    /If Murph determines that a security incident triggers a legally required breach notice, including under applicable consumer health data, personal data, health breach notification, or similar laws/u,
  );
  assert.match(
    privacyPolicy,
    /Murph will provide notices to affected users, regulators, service providers, or other parties as required by law/u,
  );
  assert.match(
    privacyPolicy,
    /A health-data breach may include unauthorized access, acquisition, use, or disclosure of unsecured health data, including certain disclosures inconsistent with our privacy promises/u,
  );
  assert.match(
    privacyPolicy,
    /Optional telemetry is off by default for health content and does not include journal entries, prompts, files, health metrics, health memories, wearable data, integration tokens, or other health content unless we clearly disclose the telemetry and obtain any required consent/u,
  );
  assert.match(
    privacyPolicy,
    /## 17\. Consumer Health Data Notice/u,
  );
  assert.match(
    privacyPolicy,
    /You can access the Consumer Health Data Notice at \[withmurph\.ai\/consumer-health-data-privacy-policy\]/u,
  );
  assert.match(privacyPolicy, /### H\. Calls, browser actions, and user-directed transactions/u);
  assert.match(privacyPolicy, /\*\*Source-specific provider limits\.\*\*/u);
  assert.match(privacyPolicy, /Strava states that it may monitor and collect usage data relating to access to its API/u);
  assert.match(privacyPolicy, /A portal, laboratory, wearable company, merchant, or other service does not become a Murph subprocessor/u);
  assert.match(
    privacyPolicy,
    /Paying for another adult's Family access does not give the payer access to that adult's private health data or conversations/u,
  );
  assert.doesNotMatch(
    privacyPolicy,
    /## 17\. U\.S\. Consumer Health Data Supplemental Notice/u,
  );
  assert.doesNotMatch(privacyPolicy, /### A\. Categories of consumer health data/u);
  assert.doesNotMatch(privacyPolicy, /model-improvement consent/u);
});

test("Consumer Health Data Notice keeps the stronger model-training promise", () => {
  const consumerHealthPolicy = readLegalMarkdown(
    "consumer-health-data-notice.md",
  );

  assert.match(
    consumerHealthPolicy,
    /Murph does not use Consumer Health Data you submit through Murph to train, fine-tune, or improve Murph's or any third party's general-purpose AI models/u,
  );
  assert.match(
    consumerHealthPolicy,
    /Separate research consents, if offered, will be limited to the research or product-evaluation purpose described in that consent and will not authorize general-purpose AI model training on Consumer Health Data/u,
  );
  assert.match(
    consumerHealthPolicy,
    /third-party AI model providers that process Consumer Health Data for the Hosted Service not to use that data to train their models/u,
  );
  assert.match(
    consumerHealthPolicy,
    /including within 45 days where Washington law requires it/u,
  );
  assert.match(
    consumerHealthPolicy,
    /Murph may use one 45-day extension if reasonably necessary/u,
  );
  assert.match(
    consumerHealthPolicy,
    /Murph will review the appeal and respond within the time required by applicable law, including within 45 days where Washington law requires it/u,
  );
  assert.match(
    consumerHealthPolicy,
    /provide the applicable complaint mechanism or other method for contacting the relevant regulator or attorney general/u,
  );
  assert.match(consumerHealthPolicy, /Family sponsorship is not health-data sharing/u);
  assert.match(consumerHealthPolicy, /\*\*Source-specific restrictions\.\*\*/u);
  assert.match(consumerHealthPolicy, /shorter deletion, cache, or display period/u);
  assert.match(
    consumerHealthPolicy,
    /Murph cannot delete copies that another person or independent third party already received and controls/u,
  );
  assert.doesNotMatch(
    consumerHealthPolicy,
    /Unless we present a separate, specific opt-in consent/u,
  );
});

test("Health AI Safety Disclosure states AI, causation, and action boundaries", () => {
  const disclosure = readLegalMarkdown("health-ai-safety-disclosure.md");

  assert.match(disclosure, /Murph is an artificial intelligence system/u);
  assert.match(disclosure, /## 3\. Patterns are not proof of causation/u);
  assert.match(disclosure, /A before-and-after change, correlation, timing relationship/u);
  assert.match(disclosure, /provider-controlled interface or separate written authorization/u);
  assert.match(disclosure, /## 8\. AI calls and user-directed actions/u);
  assert.match(disclosure, /Murph is not your general agent, healthcare proxy/u);
});

test("Subprocessor register separates connected services and powers the public page", () => {
  const register = readLegalMarkdown("subprocessors.md");
  const page = readFileSync(
    path.resolve(process.cwd(), "apps/web/app/subprocessors/page.tsx"),
    "utf8",
  );

  assert.match(register, /# Murph Subprocessors, Model Providers, and Connected Services/u);
  assert.match(register, /\*\*Last Updated:\*\* August 9, 2026/u);
  assert.match(
    register,
    /\| incident\.io \| Public status-page hosting and the browser-readable incident summary used by Murph's footer availability indicator\./u,
  );
  assert.match(
    register,
    /The fixed footer request sends no page path, query, fragment, account data, prompt, health content, or message content\./u,
  );
  assert.match(
    register,
    /Status-page provider \/ subprocessor; independent controller for provider-owned security or legal processing where applicable\./u,
  );
  assert.match(register, /\| Oura \|/u);
  assert.match(register, /\| WHOOP \|/u);
  assert.match(register, /\| Garmin \|/u);
  assert.match(register, /\| Strava \|/u);
  assert.match(
    register,
    /Strava \| Existing user-authorized activity connection lifecycle support; new connections and reconnect offers are currently disabled/u,
  );
  assert.doesNotMatch(register, /Oura, WHOOP, Garmin, Strava, and similar wearable providers/u);
  assert.match(page, /markdownFileName: "subprocessors\.md"/u);
});
