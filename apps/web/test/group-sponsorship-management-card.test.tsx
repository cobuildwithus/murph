import assert from "node:assert/strict";

import {
  act,
  createElement,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { afterEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

vi.mock("@/src/components/ui/button", () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    createElement("button", props, children),
}));

vi.mock("@/src/components/ui/alert", () => ({
  Alert: ({ children, ...props }: {
    children?: ReactNode;
    role?: string;
  }) => createElement("section", props, children),
  AlertDescription: ({ children }: { children?: ReactNode }) =>
    createElement("p", null, children),
  AlertTitle: ({ children }: { children?: ReactNode }) =>
    createElement("h2", null, children),
}));

vi.mock("@base-ui/react/alert-dialog", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const AlertDialogContext = React.createContext<{
    onOpenChange: (open: boolean) => void;
    open: boolean;
  }>({
    onOpenChange: () => {},
    open: false,
  });

  return {
    AlertDialog: {
      Backdrop: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => {
        const context = React.useContext(AlertDialogContext);
        return context.open ? createElement("div", props, children) : null;
      },
      Close: ({
        children,
        render: _render,
        ...props
      }: ButtonHTMLAttributes<HTMLButtonElement> & { render?: ReactNode }) => {
        const context = React.useContext(AlertDialogContext);
        void _render;
        return createElement("button", {
          ...props,
          onClick: () => context.onOpenChange(false),
        }, children);
      },
      Description: ({ children, ...props }: HTMLAttributes<HTMLParagraphElement>) =>
        createElement("p", props, children),
      Popup: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => {
        const context = React.useContext(AlertDialogContext);
        return context.open ? createElement("div", props, children) : null;
      },
      Portal: ({ children }: { children?: ReactNode }) => children,
      Root: ({
        children,
        onOpenChange = () => {},
        open = false,
      }: {
        children?: ReactNode;
        onOpenChange?: (open: boolean) => void;
        open?: boolean;
      }) => createElement(
        AlertDialogContext.Provider,
        { value: { onOpenChange, open } },
        children,
      ),
      Title: ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) =>
        createElement("h2", props, children),
    },
  };
});

vi.mock("@/src/components/ui/choice-card", () => ({
  ChoiceCard: ({ title }: { title: ReactNode }) => createElement("span", null, title),
}));

vi.mock("@/src/components/ui/spinner", () => ({
  Spinner: () => createElement("span", null, "Loading"),
}));

vi.mock("@/src/components/ui/radio-group", () => ({
  RadioGroup: ({ children, onValueChange }: {
    children?: ReactNode;
    onValueChange?: (value: string) => void;
  }) => createElement(
    "div",
    null,
    children,
    createElement("button", {
      onClick: () => onValueChange?.("2000"),
      type: "button",
    }, "Choose $20"),
  ),
}));

const AUTHORIZATION_ID = "hgsa_abcdefghijklmnop";

const baseManagement = {
  authorizationId: AUTHORIZATION_ID,
  chargedThisPeriodMinor: 500,
  monthlyCapMinor: 1_000 as const,
  pendingThisPeriodMinor: 500,
  pendingMonthlyCapMinor: null,
  periodEnd: "2026-08-30T12:00:00.000Z",
  status: "active" as const,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test.each([
  {
    action: "pause",
    button: "Pause automatic refills",
    initialStatus: "active" as const,
    responseStatus: "paused" as const,
  },
  {
    action: "resume",
    button: "Resume automatic refills",
    initialStatus: "paused" as const,
    responseStatus: "active" as const,
  },
  {
    action: "recover",
    button: "Review payment",
    initialStatus: "recovery_required" as const,
    responseStatus: "recovery_required" as const,
  },
])("binds the $action mutation to the displayed authorization", async ({
  action,
  button,
  initialStatus,
  responseStatus,
}) => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    json: async () => ({
      management: responseStatus === null
        ? null
        : { ...baseManagement, status: responseStatus },
    }),
    ok: true,
    init,
  }));
  vi.stubGlobal("fetch", fetchMock);

  const { GroupSponsorshipManagementCard } = await import(
    "@/src/components/hosted-groups/group-sponsorship-management-card"
  );
  const rendered = await renderClientComponent(createElement(
    GroupSponsorshipManagementCard,
    {
      endpoint: "/api/groups/fund/example/sponsorship",
      management: { ...baseManagement, status: initialStatus },
    },
  ));
  try {
    const mutationButton = [...rendered.container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === button);
    assert.ok(mutationButton);
    await act(async () => {
      mutationButton.click();
    });

    assert.equal(fetchMock.mock.calls.length, 1);
    const init = fetchMock.mock.calls[0]?.[1];
    assert.deepEqual(JSON.parse(String(init?.body)), {
      action,
      authorizationId: AUTHORIZATION_ID,
    });
  } finally {
    await rendered.cleanup();
  }
});

test("binds a confirmed cap increase to the displayed authorization", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    json: async () => ({
      management: { ...baseManagement, monthlyCapMinor: 2_000 },
    }),
    ok: true,
    init,
  }));
  vi.stubGlobal("fetch", fetchMock);

  const { GroupSponsorshipManagementCard } = await import(
    "@/src/components/hosted-groups/group-sponsorship-management-card"
  );
  const rendered = await renderClientComponent(createElement(
    GroupSponsorshipManagementCard,
    {
      endpoint: "/api/groups/fund/example/sponsorship",
      management: baseManagement,
    },
  ));
  try {
    const capButton = [...rendered.container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Choose $20");
    assert.ok(capButton);
    await act(async () => {
      capButton.click();
    });

    assert.equal(fetchMock.mock.calls.length, 0);

    const applyButton = [...rendered.container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Review $20 limit");
    assert.ok(applyButton);
    await act(async () => {
      applyButton.click();
    });

    expect(rendered.container.textContent).toContain("Increase your limit to $20?");
    expect(rendered.container.textContent).toContain(
      "Your monthly limit will change from $10 to $20",
    );
    expect(rendered.container.textContent).toContain(
      "When automatic refills are on, Murph may charge $5 at a time",
    );
    expect(rendered.container.textContent).toContain("Keep $10 limit");
    assert.equal(fetchMock.mock.calls.length, 0);

    const confirmButton = rendered.container.querySelector<HTMLButtonElement>(
      "[data-slot='alert-dialog-action']",
    );
    assert.ok(confirmButton);
    expect(confirmButton.textContent).toBe("Increase to $20");
    await act(async () => {
      confirmButton.click();
    });

    assert.equal(fetchMock.mock.calls.length, 1);
    const init = fetchMock.mock.calls[0]?.[1];
    assert.deepEqual(JSON.parse(String(init?.body)), {
      action: "change_cap",
      authorizationId: AUTHORIZATION_ID,
      confirmed: true,
      monthlyCapMinor: 2_000,
    });
  } finally {
    await rendered.cleanup();
  }
});

test.each([
  {
    remainingCopy: "Resume automatic refills",
    status: "paused" as const,
  },
  {
    remainingCopy: "Automatic refills are paused until payment is fixed",
    status: "recovery_required" as const,
  },
])("keeps a confirmed cap increase in the existing $status state", async ({
  remainingCopy,
  status,
}) => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    json: async () => ({
      management: { ...baseManagement, monthlyCapMinor: 2_000, status },
    }),
    ok: true,
    init,
  }));
  vi.stubGlobal("fetch", fetchMock);

  const { GroupSponsorshipManagementCard } = await import(
    "@/src/components/hosted-groups/group-sponsorship-management-card"
  );
  const rendered = await renderClientComponent(createElement(
    GroupSponsorshipManagementCard,
    {
      endpoint: "/api/groups/fund/example/sponsorship",
      management: { ...baseManagement, status },
    },
  ));
  try {
    const capButton = [...rendered.container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Choose $20");
    assert.ok(capButton);
    await act(async () => {
      capButton.click();
    });

    const applyButton = [...rendered.container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Review $20 limit");
    assert.ok(applyButton);
    await act(async () => {
      applyButton.click();
    });

    assert.equal(fetchMock.mock.calls.length, 0);
    expect(rendered.container.textContent).toContain(
      "When automatic refills are on, Murph may charge $5 at a time",
    );

    const confirmButton = rendered.container.querySelector<HTMLButtonElement>(
      "[data-slot='alert-dialog-action']",
    );
    assert.ok(confirmButton);
    await act(async () => {
      confirmButton.click();
    });

    assert.equal(fetchMock.mock.calls.length, 1);
    assert.deepEqual(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)), {
      action: "change_cap",
      authorizationId: AUTHORIZATION_ID,
      confirmed: true,
      monthlyCapMinor: 2_000,
    });
    expect(rendered.container.textContent).toContain(remainingCopy);
  } finally {
    await rendered.cleanup();
  }
});

test("keeps an uncertain cap increase actionable and reloads on dismissal", async () => {
  const fetchMock = vi.fn(async () => ({
    json: async () => ({}),
    ok: false,
  }));
  vi.stubGlobal("fetch", fetchMock);

  const { GroupSponsorshipManagementCard } = await import(
    "@/src/components/hosted-groups/group-sponsorship-management-card"
  );
  const rendered = await renderClientComponent(createElement(
    GroupSponsorshipManagementCard,
    {
      endpoint: "/api/groups/fund/example/sponsorship",
      management: baseManagement,
    },
  ));
  try {
    const capButton = [...rendered.container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Choose $20");
    assert.ok(capButton);
    await act(async () => {
      capButton.click();
    });

    const applyButton = [...rendered.container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Review $20 limit");
    assert.ok(applyButton);
    await act(async () => {
      applyButton.click();
    });

    const confirmButton = rendered.container.querySelector<HTMLButtonElement>(
      "[data-slot='alert-dialog-action']",
    );
    assert.ok(confirmButton);
    await act(async () => {
      confirmButton.click();
    });

    assert.equal(fetchMock.mock.calls.length, 1);
    expect(rendered.container.textContent).toContain("Increase your limit to $20?");
    expect(rendered.container.textContent).toContain(
      "We’re not sure whether your limit changed",
    );
    expect(confirmButton.textContent).toBe("Increase to $20");

    await act(async () => {
      confirmButton.click();
    });
    assert.equal(fetchMock.mock.calls.length, 2);

    const checkButton = [...rendered.container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Check current setup");
    assert.ok(checkButton);
    await act(async () => {
      checkButton.click();
    });
    expect(rendered.reload).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.cleanup();
  }
});

test("offers only cancellation when billing changes are unavailable", async () => {
  const { GroupSponsorshipManagementCard } = await import(
    "@/src/components/hosted-groups/group-sponsorship-management-card"
  );
  const rendered = await renderClientComponent(createElement(
    GroupSponsorshipManagementCard,
    {
      cancelOnly: true,
      endpoint: "/api/groups/fund/example/sponsorship",
      management: baseManagement,
    },
  ));

  try {
    const labels = [...rendered.container.querySelectorAll("button")]
      .map((button) => button.textContent);
    expect(labels).toContain("Cancel sponsorship");
    expect(labels).not.toContain("Pause automatic refills");
    expect(labels).not.toContain("Resume automatic refills");
    expect(labels).not.toContain("Review payment");
    expect(labels).not.toContain("Choose $20");
    expect(rendered.container.textContent).toContain(
      "you can still stop future automatic refills",
    );
  } finally {
    await rendered.cleanup();
  }
});

test("keeps a terminal receipt visible after cancellation succeeds", async () => {
  const fetchMock = vi.fn(async () => ({
    json: async () => ({ management: null }),
    ok: true,
  }));
  vi.stubGlobal("fetch", fetchMock);

  const { GroupSponsorshipManagementCard } = await import(
    "@/src/components/hosted-groups/group-sponsorship-management-card"
  );
  const rendered = await renderClientComponent(createElement(
    GroupSponsorshipManagementCard,
    {
      cancelOnly: true,
      endpoint: "/api/groups/fund/example/sponsorship",
      management: baseManagement,
    },
  ));
  try {
    const cancelButton = [...rendered.container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Cancel sponsorship");
    assert.ok(cancelButton);
    await act(async () => {
      cancelButton.click();
    });

    assert.equal(fetchMock.mock.calls.length, 0);
    expect(rendered.container.textContent).toContain(
      "Cancel your monthly sponsorship?",
    );
    expect(rendered.container.textContent).toContain(
      "Any usage credit already purchased will stay with the group",
    );

    const confirmButton = rendered.container.querySelector<HTMLButtonElement>(
      "[data-slot='alert-dialog-action']",
    );
    assert.ok(confirmButton);
    await act(async () => {
      confirmButton.click();
    });

    expect(rendered.reload).not.toHaveBeenCalled();
    expect(rendered.container.textContent).toContain(
      "Monthly sponsorship canceled",
    );
    expect(rendered.container.textContent).toContain(
      "Future automatic refills are stopped",
    );
    expect(
      [...rendered.container.querySelectorAll("button")]
        .map((button) => button.textContent),
    ).not.toContain("Cancel sponsorship");
  } finally {
    await rendered.cleanup();
  }
});

test.each([false, true])(
  "reaches the canceled receipt after an uncertain cancellation with cancelOnly=%s",
  async (cancelOnly) => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        throw new Error("Connection lost after request");
      }
      return {
        json: async () => ({ management: null }),
        ok: true,
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { GroupSponsorshipManagementCard } = await import(
      "@/src/components/hosted-groups/group-sponsorship-management-card"
    );
    const rendered = await renderClientComponent(createElement(
      GroupSponsorshipManagementCard,
      {
        cancelOnly,
        endpoint: "/api/groups/fund/example/sponsorship",
        management: baseManagement,
      },
    ));
    try {
      const cancelButton = [...rendered.container.querySelectorAll("button")]
        .find((candidate) => candidate.textContent === "Cancel sponsorship");
      assert.ok(cancelButton);
      await act(async () => {
        cancelButton.click();
      });

      const confirmButton = rendered.container.querySelector<HTMLButtonElement>(
        "[data-slot='alert-dialog-action']",
      );
      assert.ok(confirmButton);
      await act(async () => {
        confirmButton.click();
      });

      expect(rendered.container.textContent).toContain(
        "We’re not sure whether your sponsorship was canceled",
      );
      expect(confirmButton.textContent).toBe("Check cancellation status");
      expect(rendered.container.textContent).not.toContain("Check current setup");
      await act(async () => {
        confirmButton.click();
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(rendered.reload).not.toHaveBeenCalled();
      expect(rendered.container.textContent).toContain(
        "Monthly sponsorship canceled",
      );
    } finally {
      await rendered.cleanup();
    }
  }
);

test.each([
  {
    message: "Sign in to continue.",
    status: 401,
  },
  {
    message: "This monthly sponsorship changed. Refresh and try again.",
    status: 409,
  },
])(
  "reloads current state after an authoritative $status cancellation rejection",
  async ({ message, status }) => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({
        error: {
          code: status === 401
            ? "AUTH_REQUIRED"
            : "HOSTED_GROUP_SPONSORSHIP_STATE_CONFLICT",
          message,
        },
      }),
      ok: false,
      status,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { GroupSponsorshipManagementCard } = await import(
      "@/src/components/hosted-groups/group-sponsorship-management-card"
    );
    const rendered = await renderClientComponent(createElement(
      GroupSponsorshipManagementCard,
      {
        cancelOnly: true,
        endpoint: "/api/groups/fund/example/sponsorship",
        management: baseManagement,
      },
    ));
    try {
      const cancelButton = [...rendered.container.querySelectorAll("button")]
        .find((candidate) => candidate.textContent === "Cancel sponsorship");
      assert.ok(cancelButton);
      await act(async () => {
        cancelButton.click();
      });

      const confirmButton = rendered.container.querySelector<HTMLButtonElement>(
        "[data-slot='alert-dialog-action']",
      );
      assert.ok(confirmButton);
      await act(async () => {
        confirmButton.click();
      });

      expect(rendered.container.textContent).toContain(message);
      expect(rendered.container.textContent).not.toContain(
        "Check cancellation status",
      );
      expect(
        rendered.container.querySelector("[data-slot='alert-dialog-action']"),
      ).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const refreshButton = [...rendered.container.querySelectorAll("button")]
        .find((candidate) => candidate.textContent === "Refresh current setup");
      assert.ok(refreshButton);
      await act(async () => {
        refreshButton.click();
      });
      expect(rendered.reload).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await rendered.cleanup();
    }
  },
);
