import { act, createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { HomeInitialVisitContactPickerClient } from "../app/(dashboard)/home/initial-visit-contact-picker-client";
import { renderClientComponent } from "./render-client-component";

vi.mock("@/src/components/murph/murph-contact-card-picker", () => ({
  MurphContactCardPicker(props: {
    onAddToContacts: () => void;
    onOpenChange: (open: boolean) => void;
    onSkip: () => void;
  }) {
    return createElement("section", { "data-contact-picker": true },
      createElement("button", { onClick: props.onAddToContacts }, "Add contact"),
      createElement("button", { onClick: props.onSkip }, "Skip"),
      createElement("button", { onClick: () => props.onOpenChange(false) }, "Dismiss"),
    );
  },
}));

afterEach(() => vi.unstubAllGlobals());

for (const action of ["Add contact", "Skip", "Dismiss"]) {
  test(`initial contact ${action} completes onboarding without a personality or welcome dialog`, async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const rendered = await renderClientComponent(createElement(HomeInitialVisitContactPickerClient, {
      contactAction: { href: "sms:+15550100001", kind: "text", label: "Messages" },
    }));
    try {
      expect(fetchMock).not.toHaveBeenCalled();
      await act(async () => {
        Array.from(rendered.container.querySelectorAll("button"))
          .find((button) => button.textContent === action)?.click();
      });
      expect(rendered.container.textContent).toBe("");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith("/api/settings/initial-onboarding", expect.objectContaining({
        body: JSON.stringify({ action: "skip" }), method: "POST",
      }));
    } finally {
      await rendered.cleanup();
    }
  });
}

for (const contactAction of [null, { href: "mailto:murph@example.com", kind: "email" as const, label: "Email" }]) {
  test(`initial onboarding without text contact completes directly (${contactAction?.kind ?? "none"})`, async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const rendered = await renderClientComponent(createElement(HomeInitialVisitContactPickerClient, { contactAction }), { requireButton: false });
    try {
      expect(rendered.container.textContent).toBe("");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await rendered.cleanup();
    }
  });
}
