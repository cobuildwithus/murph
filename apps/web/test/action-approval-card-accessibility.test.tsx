import { createElement } from "react";
import { act } from "react";
import { beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
  signChallenge: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

vi.mock("@/src/components/sensitive-actions/use-sensitive-action-authorization", () => ({
  useSensitiveActionAuthorization: () => ({
    setup: {
      clientAuthenticated: true,
      error: null,
      pendingLabel: null,
      ready: true,
    },
    signChallenge: mocks.signChallenge,
  }),
}));

import { ActionApprovalCard } from "@/src/components/sensitive-actions/action-approval-card";

beforeEach(() => {
  vi.clearAllMocks();
});

test("announces the disabled approval controls while approval is pending", async () => {
  mocks.requestHostedOnboardingJson.mockReturnValue(new Promise(() => {}));
  const rendered = await renderClientComponent(createElement(ActionApprovalCard, {
    approval: {
      approvalId: "approval-test",
      continuation: "return-to-conversation",
      expiresAt: "2099-01-01T00:00:00.000Z",
      presentation: {
        body: "Allow the requested action.",
        title: "Approve action",
      },
      returnContactKind: null,
      status: "pending",
    },
  }));

  try {
    expect(rendered.container.querySelector("[role='status']")).toBeNull();
    expect(rendered.container.querySelector("[aria-busy='true']")).toBeNull();

    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      await Promise.resolve();
    });

    const controls = rendered.container.querySelector("[aria-busy='true']");
    const status = rendered.container.querySelector("[role='status']");
    expect(controls).not.toBeNull();
    expect(
      Array.from(rendered.container.querySelectorAll("button"))
        .every((button) => button.disabled),
    ).toBe(true);
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.textContent).toBe("Verifying approval…");
  } finally {
    await rendered.cleanup();
  }
});

test("announces and shows the required connected-app continuation", async () => {
  mocks.signChallenge.mockResolvedValue({ authorization: "signed" });
  mocks.requestHostedOnboardingJson
    .mockResolvedValueOnce({ challenge: "approval-challenge" })
    .mockResolvedValueOnce({
      approvalId: "approval-test",
      continuation: "return-to-conversation",
      expiresAt: "2099-01-01T00:00:00.000Z",
      presentation: {
        body: "Create the requested event.",
        title: "Create this calendar event?",
      },
      redirectTo: null,
      returnContactKind: null,
      status: "approved",
    });
  const rendered = await renderClientComponent(createElement(ActionApprovalCard, {
    approval: {
      approvalId: "approval-test",
      continuation: "return-to-conversation",
      expiresAt: "2099-01-01T00:00:00.000Z",
      presentation: {
        body: "Create the requested event.",
        title: "Create this calendar event?",
      },
      returnContactKind: null,
      status: "pending",
    },
  }));

  try {
    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
      }));
    });
    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain(
        "Return to the Murph conversation where you requested this action, then ask Murph to continue.",
      );
    });
    expect(rendered.container.querySelector("[role='status']")?.textContent)
      .toBe("Approval saved. Return to Murph and ask to continue.");
    expect(rendered.container.textContent).not.toContain("requested this file");
  } finally {
    await rendered.cleanup();
  }
});

test("announces denial without telling the member to continue", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
    approvalId: "approval-test",
    continuation: "return-to-conversation",
    expiresAt: "2099-01-01T00:00:00.000Z",
    presentation: {
      body: "Create the requested event.",
      title: "Create this calendar event?",
    },
    redirectTo: null,
    returnContactKind: null,
    status: "denied",
  });
  const rendered = await renderClientComponent(createElement(ActionApprovalCard, {
    approval: {
      approvalId: "approval-test",
      continuation: "return-to-conversation",
      expiresAt: "2099-01-01T00:00:00.000Z",
      presentation: {
        body: "Create the requested event.",
        title: "Create this calendar event?",
      },
      returnContactKind: null,
      status: "pending",
    },
  }));

  try {
    const denyButton = Array.from(rendered.container.querySelectorAll("button"))
      .find((button) => button.textContent === "Deny");
    expect(denyButton).toBeDefined();

    await act(async () => {
      denyButton?.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
      }));
    });
    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain(
        "Request denied. Murph will not continue this action.",
      );
    });
    expect(rendered.container.querySelector("[role='status']")?.textContent)
      .toBe("Request denied. Murph will not continue this action.");
    expect(rendered.container.textContent).not.toContain("Approval saved");
    expect(rendered.container.textContent).not.toContain("ask Murph to continue");
  } finally {
    await rendered.cleanup();
  }
});
