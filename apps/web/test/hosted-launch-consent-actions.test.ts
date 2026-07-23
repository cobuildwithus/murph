import { act, createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { HostedLaunchConsentActions } from "@/src/components/legal/hosted-launch-consent-actions";

import { renderClientComponent } from "./render-client-component";

let cleanupRender: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
});

test("launch consent exposes a clear decline action beside the affirmative flow", async () => {
  const onDecline = vi.fn();
  const { cleanup, container, window } = await renderClientComponent(
    createElement(
      HostedLaunchConsentActions,
      { onDecline },
      createElement("button", { type: "button" }, "Agree, consent & continue"),
    ),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  const declineButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Decline",
  );
  expect(declineButton).toBeTruthy();
  expect((declineButton as HTMLButtonElement).disabled).toBe(false);

  await act(async () => {
    declineButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(onDecline).toHaveBeenCalledTimes(1);
});

test("launch consent disables the decline action while decline is pending", async () => {
  const { cleanup, container } = await renderClientComponent(
    createElement(
      HostedLaunchConsentActions,
      { declinePending: true, onDecline: () => {} },
      createElement("div", null, "Consent prompt"),
    ),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  const declineButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Declining...",
  ) as HTMLButtonElement | undefined;
  expect(declineButton).toBeTruthy();
  expect(declineButton?.disabled).toBe(true);
});
