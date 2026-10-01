import assert from "node:assert/strict";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";
import { MurphChatAction, MurphChatActionFallback } from "@/src/components/murph/murph-chat-action";

vi.mock("@/src/components/hosted-onboarding/auth-dialog", () => ({
  AuthDialog: ({ open, requireLaunchConsentOnCompletion }: { open: boolean; requireLaunchConsentOnCompletion: boolean }) =>
    open ? <div role="dialog" data-require-consent={requireLaunchConsentOnCompletion}>Sign in</div> : null,
}));

test("Message Murph links directly to a single connected channel with link semantics", () => {
  const markup = renderToStaticMarkup(<MurphChatAction authenticated options={[
    { kind: "telegram", label: "Telegram", href: "https://t.me/withmurph_bot", target: "_blank", rel: "noopener noreferrer" },
  ]} />);
  assert.match(markup, /href="https:\/\/t.me\/withmurph_bot"/);
  assert.match(markup, /Message Murph in Telegram \(opens in a new tab\)/);
  assert.match(markup, /target="_blank"/);
  assert.match(markup, /rel="noopener noreferrer"/);
  assert.doesNotMatch(markup, /role="button"|<button/);
});

test("Message Murph sends signed-in members without channels to settings", () => {
  const markup = renderToStaticMarkup(<MurphChatAction authenticated options={[]} />);
  assert.match(markup, /href="\/settings"/);
  assert.match(markup, /Link a contact method to message Murph/);
  assert.match(markup, />Message Murph<\/a>/);
});

test("Message Murph opens the existing sign-in dialog for guests", async () => {
  const rendered = await renderClientComponent(<MurphChatAction authenticated={false} options={[]} />);
  try {
    assert.equal(rendered.container.querySelector('[role="dialog"]'), null);
    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });
    assert.equal(rendered.container.querySelector('[role="dialog"]')?.getAttribute("data-require-consent"), "true");
  } finally {
    await rendered.cleanup();
  }
});

test("Message Murph remains disabled until its contact route loads", () => {
  const markup = renderToStaticMarkup(<MurphChatActionFallback />);
  assert.match(markup, /disabled=""/);
  assert.match(markup, /aria-busy="true"/);
  assert.doesNotMatch(markup, /href=/);
});
