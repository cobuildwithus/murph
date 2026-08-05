import assert from "node:assert/strict";

import { act, createElement, type HTMLAttributes, type ReactNode } from "react";
import { afterEach, beforeEach, test, vi } from "vitest";

import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

import { renderClientComponent } from "./render-client-component";

vi.mock("@/src/components/murph/murph-persona-picker", () => ({
  MurphPersonaPicker({
    onComplete,
    onOpenChange,
    open,
    savePreference,
    skipPreference,
  }: {
    onComplete?: (preferences: object | null) => void;
    onOpenChange: (open: boolean) => void;
    open: boolean;
    savePreference?: (preferences: {
      persona: "classic";
      tone: "formal";
      voice: "upbeat";
    }) => Promise<object>;
    skipPreference?: () => Promise<void>;
  }) {
    const preferences = {
      persona: "classic" as const,
      tone: "formal" as const,
      voice: "upbeat" as const,
    };
    return open
      ? createElement(
          "section",
          { "data-murph-persona-picker": "open" },
          createElement("p", null, "Choose Murph’s main personality"),
          createElement(
            "button",
            {
              onClick: async () => {
                await skipPreference?.();
                onComplete?.(null);
                onOpenChange(false);
              },
              type: "button",
            },
            "Close persona picker",
          ),
          createElement(
            "button",
            {
              onClick: async () => {
                const saved = await savePreference?.(preferences) ?? preferences;
                onComplete?.(saved);
                onOpenChange(false);
              },
              type: "button",
            },
            "Complete persona picker",
          ),
          createElement(
            "button",
            {
              onClick: async () => {
                await skipPreference?.();
                onComplete?.(null);
                onOpenChange(false);
              },
              type: "button",
            },
            "Skip persona picker",
          ),
        )
      : null;
  },
}));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({ completedNow: true, status: "completed" }), {
      headers: { "content-type": "application/json" },
      status: 200,
    }),
  ));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

vi.mock("@/src/components/murph/murph-contact-card-picker", () => ({
  MurphContactCardPicker({
    onAddToContacts,
    onOpenChange,
    onSkip,
    open,
  }: {
    onAddToContacts?: () => void;
    onOpenChange: (open: boolean) => void;
    onSkip?: () => void;
    open: boolean;
  }) {
    return open
      ? createElement(
          "section",
          { "data-murph-contact-card-picker": "open" },
          createElement("p", null, "Add Murph to your contacts"),
          createElement(
            "button",
            { onClick: () => onAddToContacts?.(), type: "button" },
            "Add contact",
          ),
          createElement(
            "button",
            { onClick: () => onSkip?.(), type: "button" },
            "Skip contact card",
          ),
          createElement(
            "button",
            { onClick: () => onOpenChange(false), type: "button" },
            "Dismiss contact card",
          ),
        )
      : null;
  },
}));

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: {
    children?: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) =>
    open
      ? createElement("div", { "data-dialog-open": "true" }, children)
      : null,
  DialogContent: ({ children, className }: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", { className, "data-dialog-content": "true" }, children),
  DialogDescription: (props: HTMLAttributes<HTMLParagraphElement>) =>
    createElement("p", props),
  DialogHeader: (props: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props),
  DialogTitle: (props: HTMLAttributes<HTMLHeadingElement>) =>
    createElement("h2", props),
}));

test("HomeInitialVisitPersonaPickerClient opens the production persona picker without mutating the URL", async () => {
  const { HomeInitialVisitPersonaPickerClient } = await import(
    "../app/(dashboard)/home/initial-visit-persona-picker-client"
  );
  const { cleanup, container, replaceState } = await renderClientComponent(
    createElement(HomeInitialVisitPersonaPickerClient, { contactAction: null }),
    { requireButton: false },
  );

  try {
    assert.match(container.textContent ?? "", /Choose Murph’s main personality/u);
    assert.ok(container.querySelector("[data-murph-persona-picker='open']"));
    assert.equal(replaceState.mock.calls.length, 0);
  } finally {
    await cleanup();
  }
});

test("HomeInitialVisitPersonaPickerClient closes when the picker is dismissed", async () => {
  const { HomeInitialVisitPersonaPickerClient } = await import(
    "../app/(dashboard)/home/initial-visit-persona-picker-client"
  );
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HomeInitialVisitPersonaPickerClient, { contactAction: null }),
    { requireButton: false },
  );

  try {
    const closeButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Close persona picker",
    );
    assert.ok(closeButton);

    await act(async () => {
      closeButton.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    assert.equal(container.querySelector("[data-murph-persona-picker='open']"), null);
    assert.doesNotMatch(container.textContent ?? "", /Welcome to Murph/u);
  } finally {
    await cleanup();
  }
});

test("HomeInitialVisitPersonaPickerClient advances to the final Text Murph dialog after persona completion", async () => {
  const { HomeInitialVisitPersonaPickerClient } = await import(
    "../app/(dashboard)/home/initial-visit-persona-picker-client"
  );
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HomeInitialVisitPersonaPickerClient, {
      contactAction: {
        href: "sms:+15550100001",
        kind: "text",
        label: "Messages",
      },
    }),
    { requireButton: false },
  );

  try {
    const skipContactButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Skip contact card",
    );
    assert.ok(skipContactButton);

    await act(async () => {
      skipContactButton.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    const completeButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Complete persona picker",
    );
    assert.ok(completeButton);

    await act(async () => {
      completeButton.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    assert.match(container.textContent ?? "", /Welcome to Murph/u);
    assert.match(container.textContent ?? "", /Text Murph/u);
    assert.equal(
      container.querySelector("a")?.getAttribute("href"),
      "sms:+15550100001",
    );
  } finally {
    await cleanup();
  }
});

test("HomeInitialVisitPersonaPickerClient uses settings as the final Text Murph fallback", async () => {
  const { HomeInitialVisitPersonaPickerClient } = await import(
    "../app/(dashboard)/home/initial-visit-persona-picker-client"
  );
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HomeInitialVisitPersonaPickerClient, { contactAction: null }),
    { requireButton: false },
  );

  try {
    const completeButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Complete persona picker",
    );
    assert.ok(completeButton);

    await act(async () => {
      completeButton.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    assert.match(container.textContent ?? "", /Welcome to Murph/u);
    assert.equal(container.querySelector("a")?.getAttribute("href"), "/settings");
  } finally {
    await cleanup();
  }
});

test("HomeInitialVisitPersonaPickerClient closes without welcome when another surface completed first", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ completedNow: false, status: "completed" }), {
      headers: { "content-type": "application/json" },
      status: 200,
    }),
  );
  const { HomeInitialVisitPersonaPickerClient } = await import(
    "../app/(dashboard)/home/initial-visit-persona-picker-client"
  );
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HomeInitialVisitPersonaPickerClient, { contactAction: null }),
    { requireButton: false },
  );

  try {
    const completeButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Complete persona picker",
    );
    assert.ok(completeButton);

    await act(async () => {
      completeButton.dispatchEvent(new window.Event("click", { bubbles: true }));
      await Promise.resolve();
    });

    assert.equal(container.querySelector("[data-murph-persona-picker='open']"), null);
    assert.doesNotMatch(container.textContent ?? "", /Welcome to Murph/u);
  } finally {
    await cleanup();
  }
});

test("HomeInitialVisitPersonaPickerClient preserves the resolved webmail composer", async () => {
  const { HomeInitialVisitPersonaPickerClient } = await import(
    "../app/(dashboard)/home/initial-visit-persona-picker-client"
  );
  const contactAction: MurphContactOption = {
    href: "mailto:murph@example.test",
    kind: "email",
    label: "Email",
    webmail: {
      href: "https://mail.google.com/mail/u/0/?tf=cm&to=murph%40example.test",
      label: "Gmail",
    },
  };
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HomeInitialVisitPersonaPickerClient, { contactAction }),
    { requireButton: false },
  );

  try {
    const completeButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Complete persona picker",
    );
    assert.ok(completeButton);

    await act(async () => {
      completeButton.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    const contactLink = container.querySelector("a");
    assert.equal(contactLink?.getAttribute("href"), contactAction.webmail?.href);
    assert.equal(contactLink?.getAttribute("target"), "_blank");
    assert.equal(contactLink?.getAttribute("rel"), "noopener noreferrer");
    assert.equal(
      contactLink?.getAttribute("aria-label"),
      "Text Murph in Gmail (opens in a new tab)",
    );
  } finally {
    await cleanup();
  }
});

test("HomeInitialVisitPersonaPickerClient does not show the final dialog when persona setup is skipped", async () => {
  const { HomeInitialVisitPersonaPickerClient } = await import(
    "../app/(dashboard)/home/initial-visit-persona-picker-client"
  );
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HomeInitialVisitPersonaPickerClient, { contactAction: null }),
    { requireButton: false },
  );

  try {
    const skipButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Skip persona picker",
    );
    assert.ok(skipButton);

    await act(async () => {
      skipButton.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    assert.equal(container.querySelector("[data-murph-persona-picker='open']"), null);
    assert.doesNotMatch(container.textContent ?? "", /Welcome to Murph/u);
  } finally {
    await cleanup();
  }
});

test("HomeInitialVisitPersonaPickerClient restores the contact-card download before persona setup for text members", async () => {
  const { HomeInitialVisitPersonaPickerClient } = await import(
    "../app/(dashboard)/home/initial-visit-persona-picker-client"
  );
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HomeInitialVisitPersonaPickerClient, {
      contactAction: {
        href: "sms:+15550100001",
        kind: "text",
        label: "Messages",
      },
    }),
    { requireButton: false },
  );

  try {
    assert.ok(container.querySelector("[data-murph-contact-card-picker='open']"));
    assert.equal(container.querySelector("[data-murph-persona-picker='open']"), null);

    const addContact = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Add contact",
    );
    assert.ok(addContact);

    await act(async () => {
      addContact.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    assert.equal(container.querySelector("[data-murph-contact-card-picker='open']"), null);
    assert.ok(container.querySelector("[data-murph-persona-picker='open']"));
  } finally {
    await cleanup();
  }
});

test("HomeInitialVisitPersonaPickerClient advances to persona setup when the contact card is skipped or dismissed", async () => {
  const { HomeInitialVisitPersonaPickerClient } = await import(
    "../app/(dashboard)/home/initial-visit-persona-picker-client"
  );

  for (const buttonText of ["Skip contact card", "Dismiss contact card"]) {
    const { cleanup, container, window } = await renderClientComponent(
      createElement(HomeInitialVisitPersonaPickerClient, {
        contactAction: {
          href: "sms:+15550100001",
          kind: "text",
          label: "Messages",
        },
      }),
      { requireButton: false },
    );

    try {
      const button = Array.from(container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent === buttonText,
      );
      assert.ok(button);

      await act(async () => {
        button.dispatchEvent(new window.Event("click", { bubbles: true }));
      });

      assert.equal(
        container.querySelector("[data-murph-contact-card-picker='open']"),
        null,
      );
      assert.ok(container.querySelector("[data-murph-persona-picker='open']"));
    } finally {
      await cleanup();
    }
  }
});
