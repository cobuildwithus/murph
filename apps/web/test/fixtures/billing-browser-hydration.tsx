import { createElement } from "react";
import { hydrateRoot } from "react-dom/client";

import { HostedFamilyStartButton } from "../../src/components/settings/hosted-family-start-button";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Billing hydration fixture root is missing.");
}
const container = root;
container.addEventListener("click", () => {
  container.dataset.clickCount = String(Number(container.dataset.clickCount ?? 0) + 1);
});
container.addEventListener("hydrate-billing-control", () => {
  hydrateRoot(container, createElement(
    container.dataset.replace === "true" ? "section" : "div",
    null,
    createElement(HostedFamilyStartButton, {
      label: "Start your own Family plan",
      ownershipConfirmation: true,
    }),
  ), {
    onRecoverableError: () => {
      container.dataset.recovered = "true";
    },
  });
}, { once: true });
