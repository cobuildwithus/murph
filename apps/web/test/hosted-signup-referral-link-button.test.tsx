import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HostedSignupReferralLinkButton,
} from "@/src/components/settings/hosted-signup-referral-link-button";

import { renderClientComponent } from "./render-client-component";

const SIGNUP_URL = "https://www.withmurph.ai/r/stable_referral";

describe("HostedSignupReferralLinkButton", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("copies a preloaded URL in the original click without another request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const rendered = await renderClientComponent(
      React.createElement(HostedSignupReferralLinkButton, {
        signupUrl: SIGNUP_URL,
      }),
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(rendered.window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await React.act(async () => {
      rendered.button.click();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(SIGNUP_URL);
    expect(rendered.button.textContent).toBe("Copied");
    expect(rendered.container.textContent).toContain("Referral link copied.");

    await rendered.cleanup();
  });

  it("keeps a failed clipboard write recoverable", async () => {
    const rendered = await renderClientComponent(
      React.createElement(HostedSignupReferralLinkButton, {
        signupUrl: SIGNUP_URL,
      }),
    );
    Object.defineProperty(rendered.window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(
          new DOMException("Clipboard unavailable", "NotAllowedError"),
        ),
      },
    });

    await React.act(async () => {
      rendered.button.click();
    });

    expect(rendered.button.textContent).toBe("Try again");
    expect(rendered.container.textContent).toContain(
      "Could not load or copy the referral link.",
    );

    await rendered.cleanup();
  });
});
