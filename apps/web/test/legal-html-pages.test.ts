import assert from "node:assert/strict";

import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import ConsumerHealthDataPrivacyPolicyAliasPage, {
  metadata as consumerHealthAliasMetadata,
} from "../app/consumer-health-data-privacy-policy/page";
import HealthAiSafetyDisclosurePage, {
  metadata as healthAiSafetyMetadata,
} from "../app/legal/health-ai-safety-disclosure/page";
import LegalDocumentsPage, {
  metadata as legalDocumentsMetadata,
} from "../app/legal/page";
import PrivacyPolicyPage, {
  metadata as privacyPolicyMetadata,
} from "../app/legal/privacy/page";
import TermsOfServicePage, {
  metadata as termsMetadata,
} from "../app/legal/terms/page";
import SubprocessorsPage from "../app/subprocessors/page";

test("HTML legal policy routes render authored policies with PDF downloads", async () => {
  assert.equal(privacyPolicyMetadata.title, "Murph Privacy Policy");
  assert.equal(privacyPolicyMetadata.alternates?.canonical, "/legal/privacy");
  const privacyMarkup = renderToStaticMarkup(await PrivacyPolicyPage());
  assert.match(privacyMarkup, /Murph Privacy Policy/);
  assert.match(privacyMarkup, /href="\/legal\/privacy\.pdf"/u);
  assert.match(privacyMarkup, /Download PDF/);
  assert.match(privacyMarkup, /Consumer Health Data Notice/);
  assert.match(privacyMarkup, /Operational prompt\/tool traces containing health data/);
  assert.match(
    privacyMarkup,
    /<ol class="[^"]*list-decimal[^"]*" start="1"><li><strong[^>]*>Local or self-hosted use\.<\/strong>/u,
  );
  assert.doesNotMatch(
    privacyMarkup,
    />1\. <strong[^>]*>Local or self-hosted use\.<\/strong>/u,
  );

  assert.equal(termsMetadata.title, "Murph Terms of Service");
  assert.equal(termsMetadata.alternates?.canonical, "/legal/terms");
  const termsMarkup = renderToStaticMarkup(await TermsOfServicePage());
  assert.match(termsMarkup, /Murph Terms of Service/);
  assert.match(termsMarkup, /href="\/legal\/terms\.pdf"/u);
  assert.match(termsMarkup, /Download PDF/);
  assert.match(termsMarkup, /Model training/);
  assert.match(
    termsMarkup,
    /<ol class="[^"]*list-decimal[^"]*" start="1"><li>violate any law, regulation, court order, or third-party right;/u,
  );

  assert.equal(
    consumerHealthAliasMetadata.title,
    "Murph Consumer Health Data Notice",
  );
  assert.equal(
    consumerHealthAliasMetadata.alternates?.canonical,
    "/consumer-health-data-privacy-policy",
  );
  const consumerHealthMarkup = renderToStaticMarkup(
    await ConsumerHealthDataPrivacyPolicyAliasPage(),
  );
  assert.match(consumerHealthMarkup, /Murph Consumer Health Data Notice/);
  assert.match(
    consumerHealthMarkup,
    /href="\/legal\/consumer-health-data-notice\.pdf"/u,
  );
  assert.match(consumerHealthMarkup, /including within 45 days/);

  assert.equal(healthAiSafetyMetadata.title, "Murph Health AI Safety Disclosure");
  assert.equal(
    healthAiSafetyMetadata.alternates?.canonical,
    "/legal/health-ai-safety-disclosure",
  );
  const healthAiMarkup = renderToStaticMarkup(await HealthAiSafetyDisclosurePage());
  assert.match(healthAiMarkup, /Murph Health AI Safety Disclosure/);
  assert.match(healthAiMarkup, /href="\/legal\/health-ai-safety-disclosure\.pdf"/u);
  assert.match(healthAiMarkup, /not a substitute for professional medical judgment/u);

  assert.equal(legalDocumentsMetadata.title, "Murph Legal Documents");
  assert.equal(legalDocumentsMetadata.alternates?.canonical, "/legal");
  const legalDocumentsMarkup = renderToStaticMarkup(await LegalDocumentsPage());
  assert.match(legalDocumentsMarkup, /Murph Legal Documents/);
  assert.match(legalDocumentsMarkup, /href="\/legal\/legal-documents\.pdf"/u);
  assert.match(legalDocumentsMarkup, /\/legal\/manifest\.json/u);
});

test("SubprocessorsPage uses affirmative model and search provider wording", async () => {
  const markup = renderToStaticMarkup(await SubprocessorsPage());

  assert.match(
    markup,
    /Hosted member, routing, billing reference, mailbox, workspace checkpoint, consent, and operational records\./u,
  );
  assert.match(
    markup,
    /Encrypted stored workspace data, transient execution content needed to run requested hosted workflows, execution metadata, runtime logs, and operational artifacts/u,
  );
  assert.match(markup, /Configured AI model providers/);
  assert.match(
    markup,
    /No for Murph-managed health data\. Murph does not route health data to configured model providers unless no-training controls are in place/u,
  );
  assert.match(markup, /Configured search providers/);
  assert.match(
    markup,
    /Murph does not send health data to search providers unless the feature requires it, the user requests it, and applicable no-training\/no-secondary-use controls are in place/u,
  );
  assert.doesNotMatch(
    markup,
    /Not used for Murph health data unless no-training controls are in place/u,
  );
});
