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

  it("deduplicates concurrent preload reads without caching across mounts", async () => {
    let resolveFirstFetch!: (response: Response) => void;
    const firstFetch = new Promise<Response>((resolve) => {
      resolveFirstFetch = resolve;
    });
    const fetchMock = vi.fn()
      .mockReturnValueOnce(firstFetch)
      .mockResolvedValueOnce(referralResponse("new_session_referral"));
    vi.stubGlobal("fetch", fetchMock);

    const firstMount = await renderClientComponent(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(HostedSignupReferralLinkButton),
        React.createElement(HostedSignupReferralLinkButton),
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await React.act(async () => {
      resolveFirstFetch(referralResponse("shared_in_flight_referral"));
      await firstFetch;
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      [...firstMount.container.querySelectorAll("button")].map(
        (button) => button.textContent,
      ),
    ).toEqual(["Copy link", "Copy link"]);
    await firstMount.cleanup();

    const secondMount = await renderClientComponent(
      React.createElement(HostedSignupReferralLinkButton),
    );
    await React.act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(secondMount.button.textContent).toBe("Copy link");

    await secondMount.cleanup();
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

function referralResponse(suffix: string): Response {
  return new Response(JSON.stringify({
    signupUrl: `https://www.withmurph.ai/r/${suffix}`,
  }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}
