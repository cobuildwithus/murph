import assert from "node:assert/strict";

import { act, createElement } from "react";
import { test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

vi.mock("@/src/components/murph/murph-persona-picker", () => ({
  MurphPersonaPicker({
    onComplete,
    onOpenChange,
    open,
  }: {
    onComplete?: () => void;
    onOpenChange: (open: boolean) => void;
    open: boolean;
  }) {
    return open
      ? createElement(
          "section",
          { "data-murph-persona-picker": "open" },
          createElement("p", null, "Choose Murph’s main personality"),
          createElement(
            "button",
            { onClick: () => onOpenChange(false), type: "button" },
            "Close persona picker",
          ),
          createElement(
            "button",
            { onClick: () => onComplete?.(), type: "button" },
            "Complete persona picker",
          ),
        )
      : null;
  },
}));

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

test("HomeInitialVisitPersonaPickerClient opens the production persona picker and consumes the query marker", async () => {
  const { HomeInitialVisitPersonaPickerClient } = await import(
    "../app/(dashboard)/home/initial-visit-persona-picker-client"
  );
  const { cleanup, container, replaceState } = await renderClientComponent(
    createElement(HomeInitialVisitPersonaPickerClient, { showContactCard: false }),
    {
      location: {
        hash: "#notes",
        href: "https://join.example.test/home?initialVisit=true&tab=overview#notes",
        pathname: "/home",
        search: "?initialVisit=true&tab=overview",
      },
      requireButton: false,
    },
  );

  try {
    assert.match(container.textContent ?? "", /Choose Murph’s main personality/u);
    assert.ok(container.querySelector("[data-murph-persona-picker='open']"));
    assert.deepEqual(replaceState.mock.calls[0], [
      {},
      "",
      "/home?tab=overview#notes",
    ]);
  } finally {
    await cleanup();
  }
});

test("HomeInitialVisitPersonaPickerClient closes when the picker is dismissed", async () => {
  const { HomeInitialVisitPersonaPickerClient } = await import(
    "../app/(dashboard)/home/initial-visit-persona-picker-client"
  );
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HomeInitialVisitPersonaPickerClient, { showContactCard: false }),
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
      showContactCard: true,
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
        showContactCard: true,
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
