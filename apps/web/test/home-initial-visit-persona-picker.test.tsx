import assert from "node:assert/strict";

import { act, createElement } from "react";
import { test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

vi.mock("@/src/components/murph/murph-persona-picker", () => ({
  MurphPersonaPicker({
    onOpenChange,
    open,
  }: {
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
        )
      : null;
  },
}));

test("HomeInitialVisitPersonaPickerClient opens the production persona picker and consumes the query marker", async () => {
  const { HomeInitialVisitPersonaPickerClient } = await import(
    "../app/(dashboard)/home/initial-visit-persona-picker-client"
  );
  const { cleanup, container, replaceState } = await renderClientComponent(
    createElement(HomeInitialVisitPersonaPickerClient),
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
    createElement(HomeInitialVisitPersonaPickerClient),
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
