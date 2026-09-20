import { createElement, act } from "react";
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
  useSensitiveActionAuthorization: () => ({ signChallenge: mocks.signChallenge }),
}));
import { ActionApprovalCard } from "@/src/components/sensitive-actions/action-approval-card";

beforeEach(() => { vi.resetAllMocks(); });

test("a rejected session cannot reach passkey signing or a decision", async () => {
  mocks.requestHostedOnboardingJson.mockRejectedValue(new Error("Sign in to continue."));
  const rendered = await renderClientComponent(createElement(ActionApprovalCard, { approval: pendingApproval() }));
  try {
    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);
    expect(mocks.signChallenge).not.toHaveBeenCalled();
    expect(rendered.button.disabled).toBe(false);
    expect(rendered.container.textContent).toContain("Sign in to continue.");
  } finally { await rendered.cleanup(); }
});

function pendingApproval() {
  return {
    approvalId: "approval-test",
    expiresAt: "2099-01-01T00:00:00.000Z",
    presentation: {
      body: "Allow the requested action.",
      title: "Approve action",
    },
    returnContactKind: null,
    status: "pending" as const,
  };
}
