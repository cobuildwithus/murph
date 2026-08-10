import assert from "node:assert/strict";

import {
  act,
  createElement,
  type ButtonHTMLAttributes,
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

vi.mock("@/src/components/ui/card", () => ({
  Card: ({ children }: { children?: ReactNode }) =>
    createElement("section", null, children),
  CardContent: ({ children }: { children?: ReactNode }) =>
    createElement("div", null, children),
  CardDescription: ({ children }: { children?: ReactNode }) =>
    createElement("p", null, children),
  CardFooter: ({ children }: { children?: ReactNode }) =>
    createElement("footer", null, children),
  CardHeader: ({ children }: { children?: ReactNode }) =>
    createElement("header", null, children),
  CardTitle: ({ children }: { children?: ReactNode }) =>
    createElement("h2", null, children),
}));

vi.mock("@/src/components/ui/choice-card", () => ({
  ChoiceCard: ({ title }: { title: string }) => createElement("span", null, title),
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
  {
    action: "cancel",
    button: "Cancel sponsorship",
    initialStatus: "active" as const,
    responseStatus: "active" as const,
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
  Object.defineProperty(rendered.window, "confirm", {
    configurable: true,
    value: vi.fn(() => true),
  });

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
  Object.defineProperty(rendered.window, "confirm", {
    configurable: true,
    value: vi.fn(() => true),
  });

  try {
    const capButton = [...rendered.container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Choose $20");
    assert.ok(capButton);
    await act(async () => {
      capButton.click();
    });

    assert.equal(fetchMock.mock.calls.length, 0);

    const applyButton = [...rendered.container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Confirm $20 limit");
    assert.ok(applyButton);
    await act(async () => {
      applyButton.click();
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
  Object.defineProperty(rendered.window, "confirm", {
    configurable: true,
    value: vi.fn(() => true),
  });

  try {
    const cancelButton = [...rendered.container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Cancel sponsorship");
    assert.ok(cancelButton);
    await act(async () => {
      cancelButton.click();
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
