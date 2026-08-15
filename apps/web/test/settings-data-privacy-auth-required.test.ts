import { createElement } from "react";
import { act } from "react";
import { readFile } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  openAuthDialog: vi.fn(),
  openDataPrivacyAuthDialog: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/auth-dialog-provider", () => ({
  useAuth: () => ({
    authenticated: false,
    openAuthDialog: mocks.openAuthDialog,
    openDataPrivacyAuthDialog: mocks.openDataPrivacyAuthDialog,
  }),
}));

import {
  SettingsDataPrivacyAuthRequired,
} from "@/app/settings/data-privacy/settings-data-privacy-auth-required";

beforeEach(() => {
  vi.clearAllMocks();
});

test("keeps the deletion disclosure visible until the visitor chooses to sign in", async () => {
  const rendered = await renderClientComponent(
    createElement(SettingsDataPrivacyAuthRequired),
  );

  try {
    expect(mocks.openAuthDialog).not.toHaveBeenCalled();
    expect(mocks.openDataPrivacyAuthDialog).not.toHaveBeenCalled();
    expect(rendered.container.textContent).toContain("Delete your Murph account");
    expect(rendered.container.textContent).toContain(
      "external carrier, Telegram, Linq, or email systems cannot be recalled",
    );
    expect(rendered.container.querySelector("a[href='mailto:legal@justco.build']"))
      .not.toBeNull();
    expect(rendered.container.querySelector("a[href='/legal/privacy']"))
      .not.toBeNull();

    await act(async () => {
      rendered.button.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });

    expect(mocks.openDataPrivacyAuthDialog).toHaveBeenCalledTimes(1);
    expect(mocks.openAuthDialog).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

test("the public handoff retains the canonical policy and deletion-owner limits", async () => {
  const [handoff, policy, deletionOwner] = await Promise.all([
    readFile(new URL(
      "../app/settings/data-privacy/settings-data-privacy-auth-required.tsx",
      import.meta.url,
    ), "utf8"),
    readFile(new URL("../legal/privacy-policy.md", import.meta.url), "utf8"),
    readFile(new URL(
      "../src/lib/hosted-privacy/account-data-service.ts",
      import.meta.url,
    ), "utf8"),
  ]);
  const normalizedHandoff = handoff.replace(/\s+/gu, " ");
  const normalizedDeletionOwner = deletionOwner.replace(/\s+/gu, " ");

  for (const [handoffLimit, policyLimit] of [
    ["within 30 days", "within 30 days"],
    ["within 90 days", "within 90 days"],
    ["up to 3 years", "up to 3 years"],
    ["90–365 days", "90-365 days"],
  ]) {
    expect(normalizedHandoff).toContain(handoffLimit);
    expect(policy).toContain(policyLimit);
  }
  expect(normalizedHandoff).toContain("external carrier, Telegram, Linq, or");
  expect(normalizedDeletionOwner).toContain(
    "external carrier, Telegram, Linq, or email provider systems",
  );
});
