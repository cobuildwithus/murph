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
  HostedAuthPanel(props: unknown) {
    mocks.panelRender(props);
    return createElement(
      "div",
      { "data-hosted-auth-panel": "ready" },
      "Ready auth",
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

test("keeps every auth method hidden until Privy is ready", async () => {
  const rendered = await renderClientComponent(renderAuthIsland(), {
    requireButton: false,
  });

  try {
    expect(rendered.container.textContent).toContain("Preparing secure sign in");
    expect(
      rendered.container.querySelector("[data-hosted-auth-panel='ready']"),
    ).toBeNull();
    expect(mocks.panelRender).not.toHaveBeenCalled();
    expect(mocks.providerMount).toHaveBeenCalledTimes(1);
    expect(
      rendered.container
        .querySelector("[role='status']")
        ?.getAttribute("aria-live"),
    ).toBe("polite");
    expect(
      rendered.container
        .querySelector("[data-slot='spinner']")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");

    mocks.ready = true;
    await rendered.rerender(renderAuthIsland());

    expect(rendered.container.textContent).toContain("Ready auth");
    expect(mocks.panelRender).toHaveBeenCalledTimes(1);
    expect(mocks.providerMount).toHaveBeenCalledTimes(1);
    expect(mocks.providerUnmount).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

test("keeps a slow provider mounted and accepts late readiness", async () => {
  vi.useFakeTimers();
  const rendered = await renderClientComponent(renderAuthIsland(), {
    location: bareHomepageLocation(),
    requireButton: false,
  });

  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(rendered.container.textContent).toContain(
      "Sign in is taking longer",
    );
    expect(rendered.container.textContent).toContain("Nothing was submitted");
    expect(mocks.panelRender).not.toHaveBeenCalled();
    expect(mocks.track).toHaveBeenCalledWith(
      "hosted_auth_privy_ready_timeout",
      expect.objectContaining({ attempt: 1, timeoutCount: 1 }),
    );

    const keepWaitingButton = Array.from(
      rendered.container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Keep waiting");
    expect(keepWaitingButton).toBeTruthy();
    expect(rendered.container.textContent).not.toContain("Restart sign in");

    await act(async () => {
      keepWaitingButton?.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });

    expect(rendered.container.textContent).toContain("Preparing secure sign in");
    expect(mocks.providerMount).toHaveBeenCalledTimes(1);
    expect(mocks.providerUnmount).not.toHaveBeenCalled();
    expect(mocks.track).toHaveBeenCalledWith(
      "hosted_auth_privy_ready_continue_waiting",
      expect.objectContaining({ attempt: 1, timeoutCount: 1 }),
    );

    mocks.ready = true;
    await rendered.rerender(renderAuthIsland());

    expect(rendered.container.textContent).toContain("Ready auth");
    expect(mocks.panelRender).toHaveBeenCalledTimes(1);
    expect(mocks.providerMount).toHaveBeenCalledTimes(1);
    expect(mocks.providerUnmount).not.toHaveBeenCalled();
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(rendered.container.textContent).not.toContain("Restart sign in");
    await clickButton(rendered, "Keep waiting");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(rendered.container.textContent).toContain("Restart sign in");
    expect(mocks.providerMount).toHaveBeenCalledTimes(1);
    expect(mocks.providerUnmount).not.toHaveBeenCalled();

    await clickButton(rendered, "Restart sign in");

    expect(rendered.container.textContent).toContain("Preparing secure sign in");
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(rendered.container.textContent).toContain(
      "Sign in is taking longer",
    );
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
