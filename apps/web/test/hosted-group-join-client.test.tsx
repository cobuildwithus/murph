import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

vi.mock("@/src/components/legal/hosted-legal-consent-card", () => ({
  HostedLegalConsentCard() {
    return createElement("div", { "data-consent-card": "true" }, "Consent card");
  },
}));

test("renders a not-now escape link with the group join legal consent gate", async () => {
  const { GroupJoinLegalConsentGate } = await import(
    "@/src/components/hosted-groups/group-join-client"
  );

  const markup = renderToStaticMarkup(
    createElement(GroupJoinLegalConsentGate, { initialStatus: null }),
  );

  expect(markup).toContain('data-consent-card="true"');
  expect(markup).toContain('href="/home"');
  expect(markup).toContain("Not now");
});
