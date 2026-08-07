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
    expect(rendered.container.textContent).toContain(
      "Allow the requested action.",
    );
    expect(rendered.container.textContent).not.toContain(
      "Approval applies only while Murph still has this request pending.",
    );
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

test("records approval without promising that a cancelled request will run", async () => {
  mocks.requestHostedOnboardingJson
    .mockResolvedValueOnce({
      message: "approval challenge",
      token: "challenge-token",
    })
    .mockResolvedValueOnce({ redirectTo: null, status: "approved" });
  mocks.signChallenge.mockResolvedValue({
    signature: `0x${"a".repeat(130)}`,
    token: "challenge-token",
  });
  const rendered = await renderClientComponent(createElement(ActionApprovalCard, {
    approval: {
      approvalId: "approval-test",
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
    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      await vi.waitFor(() => {
        expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);
      });
    });

    expect(rendered.container.textContent).toContain(
      "Approval recorded. Murph will continue only if this request is still pending.",
    );
    expect(rendered.container.textContent).not.toContain(
      "Approval saved.",
    );
  } finally {
    await rendered.cleanup();
  }
});

test("reports a denied decision truthfully when no return link is available", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
    redirectTo: null,
    status: "denied",
  });
  const rendered = await renderClientComponent(createElement(ActionApprovalCard, {
    approval: {
      approvalId: "approval-test",
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
    const denyButton = Array.from(rendered.container.querySelectorAll("button"))
      .find((button) => button.textContent === "Deny");
    expect(denyButton).toBeDefined();

    await act(async () => {
      denyButton?.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      await vi.waitFor(() => {
        expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);
      });
    });

    expect(rendered.container.querySelector("[role='status']")?.textContent).toBe("Denied.");
    expect(rendered.container.textContent).toContain(
      "Denied. Murph will not continue with this action.",
    );
    expect(rendered.container.textContent).not.toContain("Approval recorded.");
    expect(rendered.container.textContent).not.toContain("Murph will continue");
    expect(
      Array.from(rendered.container.querySelectorAll("button"))
        .every((button) => button.disabled),
    ).toBe(true);
  } finally {
    await rendered.cleanup();
  }
});

test("announces denial before following a valid return link", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
    redirectTo: "https://murph.example/thread",
    status: "denied",
  });
  const rendered = await renderClientComponent(createElement(ActionApprovalCard, {
    approval: {
      approvalId: "approval-test",
      expiresAt: "2099-01-01T00:00:00.000Z",
      presentation: {
        body: "Allow the requested action.",
        title: "Approve action",
      },
      returnContactKind: "text",
      status: "pending",
    },
  }));

  try {
    const denyButton = Array.from(rendered.container.querySelectorAll("button"))
      .find((button) => button.textContent === "Deny");
    expect(denyButton).toBeDefined();

    await act(async () => {
      denyButton?.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      await vi.waitFor(() => {
        expect(rendered.assign).toHaveBeenCalledWith("https://murph.example/thread");
      });
    });

    expect(rendered.container.querySelector("[role='status']")?.textContent).toBe(
      "Denied. Returning to Murph…",
    );
    expect(rendered.container.textContent).not.toContain("Approval recorded.");
    expect(rendered.container.textContent).not.toContain("Murph will continue");
  } finally {
    await rendered.cleanup();
  }
});
