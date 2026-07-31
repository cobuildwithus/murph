import { act, createElement, useEffect, type ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  panelRender: vi.fn(),
  providerMount: vi.fn(),
  providerUnmount: vi.fn(),
  ready: false,
  track: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: mocks.ready }),
}));

vi.mock("@vercel/analytics", () => ({
  track: mocks.track,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-panel", () => ({
  HostedAuthPanel(props: {
    onPrivyWaitChange?: (
      reason: "action" | "session" | null
    ) => void;
  }) {
    mocks.panelRender(props);
    const ready = mocks.ready;
    const { onPrivyWaitChange } = props;
    useEffect(() => {
      if (ready) {
        onPrivyWaitChange?.(null);
      }
    }, [onPrivyWaitChange, ready]);
    return createElement(
      "div",
      { "data-hosted-auth-panel": "visible" },
      "Sign in form",
      createElement(
        "button",
        {
          onClick: () => props.onPrivyWaitChange?.("action"),
          type: "button",
        },
        "Queue phone",
      ),
      createElement(
        "button",
        {
          onClick: () => props.onPrivyWaitChange?.(null),
          type: "button",
        },
        "Cancel queue",
      ),
      createElement(
        "button",
        {
          onClick: () => props.onPrivyWaitChange?.("session"),
          type: "button",
        },
        "Check session",
      ),
    );
  },
}));

vi.mock("@/src/components/hosted-onboarding/privy-provider", () => ({
  HostedPrivyProvider({ children }: { children: ReactNode }) {
    useEffect(() => {
      mocks.providerMount();
      return () => mocks.providerUnmount();
    }, []);

    return createElement(
      "div",
      { "data-hosted-privy-provider": "mounted" },
      children,
    );
  },
}));

import { HostedAuthPanelIsland } from "@/src/components/hosted-onboarding/hosted-auth-panel-island";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ready = false;
  vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "test-privy-app");
  vi.stubEnv("NEXT_PUBLIC_PRIVY_CLIENT_ID", "test-privy-client");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("keeps the ordinary auth form visible while Privy initializes", async () => {
  const rendered = await renderClientComponent(renderAuthIsland(), {
    requireButton: false,
  });

  try {
    expect(rendered.container.textContent).toContain("Sign in form");
    expect(
      rendered.container.querySelector("[data-hosted-auth-panel='visible']"),
    ).toBeTruthy();
    expect(rendered.container.querySelector("[role='status']")).toBeNull();
    expect(mocks.panelRender).toHaveBeenCalledTimes(1);
    expect(mocks.providerMount).toHaveBeenCalledTimes(1);

    mocks.ready = true;
    await rendered.rerender(renderAuthIsland());

    expect(rendered.container.textContent).toContain("Sign in form");
    expect(mocks.panelRender).toHaveBeenCalledTimes(2);
    expect(mocks.providerMount).toHaveBeenCalledTimes(1);
    expect(mocks.providerUnmount).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

test("shows compact delayed feedback only after an auth action is queued", async () => {
  vi.useFakeTimers();
  const rendered = await renderClientComponent(renderAuthIsland(), {
    location: bareHomepageLocation(),
    requireButton: false,
  });

  try {
    expect(rendered.container.querySelector("[role='status']")).toBeNull();
    await clickButton(rendered, "Queue phone");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_499);
    });
    expect(rendered.container.querySelector("[role='status']")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(rendered.container.textContent).toContain(
      "Your selection is saved",
    );
    expect(
      rendered.container.querySelector("[role='status']")?.getAttribute(
        "aria-live",
      ),
    ).toBe("polite");
    expect(
      rendered.container.querySelector("[role='status']")?.getAttribute(
        "aria-atomic",
      ),
    ).toBe("true");
    expect(
      rendered.container
        .querySelector("[data-slot='spinner']")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(rendered.container.textContent).toContain("Sign in form");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_500);
    });

    expect(mocks.track).toHaveBeenCalledWith(
      "hosted_auth_privy_ready_timeout",
      expect.objectContaining({
        attempt: 1,
        reason: "action",
        timeoutCount: 1,
      }),
    );
    expect(rendered.container.textContent).not.toContain("Restart sign in");
    expect(mocks.providerMount).toHaveBeenCalledTimes(1);
    expect(mocks.providerUnmount).not.toHaveBeenCalled();

    mocks.ready = true;
    await rendered.rerender(renderAuthIsland());

    expect(rendered.container.textContent).toContain("Sign in form");
    expect(rendered.container.querySelector("[role='status']")).toBeNull();
    expect(mocks.providerMount).toHaveBeenCalledTimes(1);
    expect(mocks.providerUnmount).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

test("shows truthful feedback immediately while an existing session hydrates", async () => {
  vi.useFakeTimers();
  const rendered = await renderClientComponent(renderAuthIsland(), {
    location: bareHomepageLocation(),
    requireButton: false,
  });

  try {
    await clickButton(rendered, "Check session");

    expect(rendered.container.textContent).toContain(
      "Secure sign in is checking your existing session.",
    );
    expect(rendered.container.querySelector("[role='status']")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(mocks.track).toHaveBeenCalledWith(
      "hosted_auth_privy_ready_timeout",
      expect.objectContaining({
        attempt: 1,
        reason: "session",
        timeoutCount: 2,
      }),
    );
    expect(rendered.container.textContent).toContain("Restart sign in");
  } finally {
    await rendered.cleanup();
  }
});

test("offers an explicit provider restart only after a second timeout", async () => {
  vi.useFakeTimers();
  const rendered = await renderClientComponent(renderAuthIsland(), {
    location: bareHomepageLocation(),
    requireButton: false,
  });

  try {
    await clickButton(rendered, "Queue phone");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(rendered.container.textContent).not.toContain("Restart sign in");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(rendered.container.textContent).toContain("Restart sign in");
    expect(mocks.providerMount).toHaveBeenCalledTimes(1);
    expect(mocks.providerUnmount).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });

    expect(mocks.track).toHaveBeenCalledTimes(2);

    await clickButton(rendered, "Restart sign in");

    expect(rendered.container.textContent).toContain("Sign in form");
    expect(rendered.container.querySelector("[role='status']")).toBeNull();
    expect(mocks.providerMount).toHaveBeenCalledTimes(2);
    expect(mocks.providerUnmount).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledWith(
      "hosted_auth_privy_ready_restart",
      expect.objectContaining({ attempt: 1, timeoutCount: 2 }),
    );
  } finally {
    await rendered.cleanup();
  }
});

test.each([
  {
    label: "an invite route",
    location: {
      hash: "",
      href: "https://example.test/groups/join/test-code",
      origin: "https://example.test",
      pathname: "/groups/join/test-code",
      search: "",
    },
  },
  {
    label: "a homepage query",
    location: {
      hash: "",
      href: "https://example.test/?invite=test-token",
      origin: "https://example.test",
      pathname: "/",
      search: "?invite=test-token",
    },
  },
  {
    label: "a homepage fragment",
    location: {
      hash: "#auth",
      href: "https://example.test/#auth",
      origin: "https://example.test",
      pathname: "/",
      search: "",
    },
  },
])("does not emit readiness telemetry on $label", async ({ location }) => {
  vi.useFakeTimers();
  const rendered = await renderClientComponent(renderAuthIsland(), {
    location,
    requireButton: false,
  });

  try {
    await clickButton(rendered, "Queue phone");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(rendered.container.textContent).toContain(
      "Your selection is saved",
    );
    expect(mocks.track).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

test("cancels delayed feedback when the queued action is cleared", async () => {
  vi.useFakeTimers();
  const rendered = await renderClientComponent(renderAuthIsland(), {
    requireButton: false,
  });

  try {
    await clickButton(rendered, "Queue phone");
    await clickButton(rendered, "Cancel queue");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(rendered.container.querySelector("[role='status']")).toBeNull();
    expect(mocks.track).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

async function clickButton(
  rendered: Awaited<ReturnType<typeof renderClientComponent>>,
  label: string,
) {
  const button = Array.from(
    rendered.container.querySelectorAll("button"),
  ).find((candidate) => candidate.textContent === label);
  expect(button).toBeTruthy();

  await act(async () => {
    button?.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });
}

function bareHomepageLocation() {
  return {
    hash: "",
    href: "https://example.test/",
    origin: "https://example.test",
    pathname: "/",
    search: "",
  };
}

function renderAuthIsland() {
  return createElement(HostedAuthPanelIsland, {
    methods: ["phone", "telegram", "email"] as const,
  });
}
