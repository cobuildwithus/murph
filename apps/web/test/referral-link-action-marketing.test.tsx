import assert from "node:assert/strict";

import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

import {
  ReferralLinkAction,
  ReferralLinkActionView,
} from "@/src/components/referrals/referral-link-action";

import { renderClientComponent } from "./render-client-component";

const SIGNUP_URL = "https://www.withmurph.ai/r/stable_referral";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

test("marketing referral action copies a member's stable link", async () => {
  const rendered = await renderClientComponent(
    createElement(ReferralLinkAction, {
      appearance: "marketing",
      identityKey: "member_referrer",
      signupUrl: SIGNUP_URL,
    }),
  );
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });

  await act(async () => {
    rendered.button.click();
  });

  expect(writeText).toHaveBeenCalledExactlyOnceWith(SIGNUP_URL);
  expect(rendered.button.textContent).toBe("Copied your link");
  expect(rendered.container.textContent).toContain("Referral link copied.");

  await rendered.cleanup();
});

test("marketing referral action exposes manual copy when clipboard access fails", async () => {
  const rendered = await renderClientComponent(
    createElement(ReferralLinkAction, {
      appearance: "marketing",
      identityKey: "member_referrer",
      signupUrl: SIGNUP_URL,
    }),
  );
  vi.stubGlobal("navigator", {
    clipboard: {
      writeText: vi.fn().mockRejectedValue(new Error("copy unavailable")),
    },
  });

  await act(async () => {
    rendered.button.click();
  });

  expect(rendered.button.textContent).toBe("Try copy again");
  expect(rendered.container.querySelector(
    'input[aria-label="Referral link for manual copy"]',
  )).toHaveProperty("value", SIGNUP_URL);

  await rendered.cleanup();
});
