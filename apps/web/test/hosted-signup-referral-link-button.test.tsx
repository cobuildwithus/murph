import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HostedSignupReferralLinkButton,
} from "@/src/components/settings/hosted-signup-referral-link-button";

import { renderClientComponent } from "./render-client-component";

const IDENTITY_KEY = "member_referrer";
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
        identityKey: IDENTITY_KEY,
        signupUrl: SIGNUP_URL,
      }),
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await React.act(async () => {
      rendered.button.click();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(SIGNUP_URL);
    expect(rendered.button.textContent).toBe("Copied");
    expect(rendered.container.textContent).toContain("Referral link copied.");

    await rendered.cleanup();
  });

  it("loads identity-bound URLs independently for concurrent Settings actions", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(referralResponse("first_surface"))
      .mockResolvedValueOnce(referralResponse("second_surface"));
    vi.stubGlobal("fetch", fetchMock);

    const rendered = await renderClientComponent(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(HostedSignupReferralLinkButton, {
          identityKey: IDENTITY_KEY,
        }),
        React.createElement(HostedSignupReferralLinkButton, {
          identityKey: IDENTITY_KEY,
        }),
      ),
      { requireButton: false },
    );
    await React.act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      [...rendered.container.querySelectorAll("button")].map(
        (button) => button.textContent,
      ),
    ).toEqual(["Copy link", "Copy link"]);
    expect(rendered.container.textContent).not.toContain(
      "Referral link ready to copy.",
    );

    await rendered.cleanup();
  });

  it("clears an old account URL before reloading another account", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(referralResponse("new_account"));
    vi.stubGlobal("fetch", fetchMock);
    const rendered = await renderClientComponent(
      React.createElement(HostedSignupReferralLinkButton, {
        identityKey: "member_old",
        signupUrl: "https://www.withmurph.ai/r/old_account",
      }),
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await rendered.rerender(
      React.createElement(HostedSignupReferralLinkButton, {
        identityKey: "member_new",
      }),
    );
    await React.act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.button.textContent).toBe("Reload link");
    expect(writeText).not.toHaveBeenCalled();

    await React.act(async () => {
      rendered.button.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(rendered.button.textContent).toBe("Copy link");

    await React.act(async () => {
      rendered.button.click();
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      "https://www.withmurph.ai/r/new_account",
    );
    expect(writeText).not.toHaveBeenCalledWith(
      "https://www.withmurph.ai/r/old_account",
    );

    await rendered.cleanup();
  });

  it("distinguishes reloading a link from retrying a clipboard write", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(referralResponse("reloaded"));
    vi.stubGlobal("fetch", fetchMock);
    const rendered = await renderClientComponent(
      React.createElement(HostedSignupReferralLinkButton, {
        identityKey: IDENTITY_KEY,
      }),
    );
    await React.act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.button.textContent).toBe("Reload link");
    expect(rendered.button.getAttribute("aria-label")).toBe(
      "Reload link, your Murph referral link",
    );
    expect(rendered.container.textContent).toContain(
      "Could not load the referral link.",
    );

    await React.act(async () => {
      rendered.button.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(rendered.button.textContent).toBe("Copy link");
    expect(rendered.container.textContent).toContain(
      "Referral link ready to copy.",
    );

    await rendered.cleanup();
  });

  it("keeps the loaded URL selectable after repeated clipboard denial", async () => {
    const rendered = await renderClientComponent(
      React.createElement(HostedSignupReferralLinkButton, {
        identityKey: IDENTITY_KEY,
        signupUrl: SIGNUP_URL,
      }),
    );
    const writeText = vi.fn().mockRejectedValue(
      new DOMException("Clipboard unavailable", "NotAllowedError"),
    );
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText,
      },
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await React.act(async () => {
        rendered.button.click();
      });
    }

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(rendered.button.textContent).toBe("Try copy again");
    expect(rendered.container.textContent).toContain(
      "Automatic copying was blocked.",
    );
    expect(rendered.container.querySelector('[aria-live="polite"]')?.textContent)
      .toBe(
        "Could not copy the referral link. Select the link field below to copy it manually.",
      );
    const manualCopyInput = rendered.container.querySelector(
      'input[aria-label="Referral link for manual copy"]',
    );
    expect(manualCopyInput?.tagName).toBe("INPUT");
    const manualCopyField = manualCopyInput as HTMLInputElement;
    expect(manualCopyField.value).toBe(SIGNUP_URL);
    expect(manualCopyField.getAttribute("tabindex")).toBeNull();
    const select = vi.fn();
    Object.defineProperty(manualCopyField, "select", {
      configurable: true,
      value: select,
    });
    manualCopyField.dispatchEvent(
      new rendered.window.Event("focusin", { bubbles: true }),
    );
    expect(select).toHaveBeenCalledOnce();

    await rendered.cleanup();
  });

  it("clears the manual fallback before another identity can paint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => undefined)));
    vi.stubGlobal("navigator", {});
    const rendered = await renderClientComponent(
      React.createElement(HostedSignupReferralLinkButton, {
        identityKey: "member_old",
        signupUrl: "https://www.withmurph.ai/r/old_account",
      }),
    );

    await React.act(async () => {
      rendered.button.click();
    });
    expect(rendered.container.querySelector(
      'input[aria-label="Referral link for manual copy"]',
    )).toHaveProperty("value", "https://www.withmurph.ai/r/old_account");

    await rendered.rerender(
      React.createElement(HostedSignupReferralLinkButton, {
        identityKey: "member_new",
      }),
    );

    expect(rendered.container.querySelector(
      'input[aria-label="Referral link for manual copy"]',
    )).toBeNull();
    expect(rendered.container.textContent).not.toContain("old_account");
    expect(rendered.button.textContent).toBe("Loading...");

    await rendered.cleanup();
  });

  it("keeps the busy action focusable and aligns its accessible name", async () => {
    let resolveClipboardWrite: (() => void) | undefined;
    const clipboardWrite = new Promise<void>((resolve) => {
      resolveClipboardWrite = resolve;
    });
    const rendered = await renderClientComponent(
      React.createElement(HostedSignupReferralLinkButton, {
        identityKey: IDENTITY_KEY,
        signupUrl: SIGNUP_URL,
      }),
    );
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn().mockReturnValue(clipboardWrite),
      },
    });

    await React.act(async () => {
      rendered.button.click();
      await Promise.resolve();
    });

    expect(rendered.button.disabled).toBe(false);
    expect(rendered.button.getAttribute("aria-label")).toBe(
      "Copying..., your Murph referral link",
    );
    expect(rendered.button.getAttribute("aria-busy")).toBe("true");

    await React.act(async () => {
      resolveClipboardWrite?.();
      await clipboardWrite;
    });
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
