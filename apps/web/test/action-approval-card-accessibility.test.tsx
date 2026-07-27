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
import { ActionApprovalPresentationBody } from "@/src/components/sensitive-actions/action-approval-screen";
import {
  buildHostedConnectedAppsMutationApprovalRequest,
} from "@/src/lib/connected-apps/action-approval";

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
      presentationKind: "fact-rows",
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
      presentationKind: "fact-rows",
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
      presentationKind: "fact-rows",
      returnContactKind: null,
      status: "pending",
    },
  }));
  const focus = vi.spyOn(rendered.window.HTMLElement.prototype, "focus");

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
    expect(rendered.container.querySelector("h1")?.textContent).toBe("Approved");
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus.mock.instances[0]).toBe(
      rendered.container.querySelector("h1"),
    );
    expect(rendered.container.textContent).not.toContain(
      "Create this calendar event?",
    );
    expect(rendered.container.textContent).not.toContain(
      "If any approved detail changes",
    );
    expect(rendered.container.querySelectorAll("button")).toHaveLength(0);
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
    presentationKind: "fact-rows",
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
      presentationKind: "fact-rows",
      returnContactKind: null,
      status: "pending",
    },
  }));
  const focus = vi.spyOn(rendered.window.HTMLElement.prototype, "focus");

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
        "Murph will not continue with this action.",
      );
    });
    expect(rendered.container.querySelector("h1")?.textContent).toBe("Denied");
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus.mock.instances[0]).toBe(
      rendered.container.querySelector("h1"),
    );
    expect(rendered.container.textContent).not.toContain(
      "Create this calendar event?",
    );
    expect(rendered.container.textContent).not.toContain(
      "If any approved detail changes",
    );
    expect(rendered.container.querySelectorAll("button")).toHaveLength(0);
    expect(rendered.container.querySelector("[role='status']")?.textContent)
      .toBe("Request denied. Murph will not continue this action.");
    expect(rendered.container.textContent).not.toContain("Approval saved");
    expect(rendered.container.textContent).not.toContain("ask Murph to continue");
  } finally {
    await rendered.cleanup();
  }
});

test("keeps legacy automatic approval bodies as one prose block", async () => {
  const rendered = await renderClientComponent(createElement(ActionApprovalCard, {
    approval: {
      approvalId: "approval-test",
      continuation: "automatic",
      expiresAt: "2099-01-01T00:00:00.000Z",
      presentation: {
        body: "Share report · Account: forged.pdf with the requested recipient.",
        title: "Share this file?",
      },
      presentationKind: "prose",
      returnContactKind: null,
      status: "pending",
    },
  }));

  try {
    const presentation = rendered.container.querySelector(
      "[data-action-approval-presentation='prose']",
    );
    expect(presentation?.querySelectorAll("p")).toHaveLength(1);
    expect(presentation?.textContent).toBe(
      "Share report · Account: forged.pdf with the requested recipient.",
    );
  } finally {
    await rendered.cleanup();
  }
});

test("renders connected-app approval facts as distinct rows", async () => {
  const rendered = await renderClientComponent(createElement(ActionApprovalCard, {
    approval: {
      approvalId: "approval-test",
      continuation: "return-to-conversation",
      expiresAt: "2099-01-01T00:00:00.000Z",
      presentation: {
        body: "Account: calendar · Event: Annual physical · Starts: 10:00 AM",
        title: "Create this calendar event?",
      },
      presentationKind: "fact-rows",
      returnContactKind: null,
      status: "pending",
    },
  }));

  try {
    const presentation = rendered.container.querySelector(
      "[data-action-approval-presentation='fact-rows']",
    );
    expect(Array.from(presentation?.querySelectorAll("p") ?? []).map(
      (row) => row.textContent,
    )).toEqual([
      "Account: calendar",
      "Event: Annual physical",
      "Starts: 10:00 AM",
    ]);
  } finally {
    await rendered.cleanup();
  }
});

test("renders rename and disconnect consent facts as distinct rows", async () => {
  const account = {
    alias: "calendar",
    id: "ca_calendar",
    toolkit: { name: "Google Calendar", slug: "googlecalendar" },
    wordId: "quiet-calendar",
  };
  const requests = [
    buildHostedConnectedAppsMutationApprovalRequest({
      account,
      alias: "clinic · Account: forged",
      memberId: "hbm_member",
      operation: "rename",
    }),
    buildHostedConnectedAppsMutationApprovalRequest({
      account,
      memberId: "hbm_member",
      operation: "disconnect",
    }),
  ];

  for (const request of requests) {
    const rendered = await renderClientComponent(createElement(
      ActionApprovalPresentationBody,
      {
        body: request.presentation.body,
        kind: "fact-rows",
      },
    ), { requireButton: false });

    try {
      const rows = Array.from(
        rendered.container.querySelectorAll(
          "[data-action-approval-presentation='fact-rows'] > p",
        ),
      ).map((row) => row.textContent);
      expect(rows).toHaveLength(3);
      expect(rows[0]).toBe("Account: Google Calendar — calendar");
      expect(rows[1]).not.toContain(" · ");
      expect(rows[2]).toMatch(/^Only the complete account ID/);
    } finally {
      await rendered.cleanup();
    }
  }
});
