import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { ReferralLinkActionView } from "@/src/components/referrals/referral-link-action";

const SIGNUP_URL = "https://www.withmurph.ai/r/stable_referral";

test("ReferralLinkActionView exposes a prominent marketing copy action", () => {
  const markup = renderToStaticMarkup(
    createElement(ReferralLinkActionView, {
      appearance: "marketing",
      onAction: () => undefined,
      signupUrl: SIGNUP_URL,
      status: "ready",
    }),
  );

  assert.match(markup, /Copy referral link/);
  assert.match(
    markup,
    /aria-label="Copy referral link, your Murph referral link"/,
  );
  assert.match(markup, /bg-\[#f5f0e8\]/);
  assert.doesNotMatch(markup, /Automatic copying was blocked/);
});

test("ReferralLinkActionView preserves an accessible manual-copy fallback", () => {
  const markup = renderToStaticMarkup(
    createElement(ReferralLinkActionView, {
      appearance: "marketing",
      onAction: () => undefined,
      signupUrl: SIGNUP_URL,
      status: "copy_error",
    }),
  );

  assert.match(markup, /Try copy again/);
  assert.match(markup, /Automatic copying was blocked/);
  assert.match(markup, /aria-label="Referral link for manual copy"/);
  assert.match(markup, /value="https:\/\/www\.withmurph\.ai\/r\/stable_referral"/);
  assert.match(markup, /aria-live="polite"/);
});
