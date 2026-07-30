import { act, createElement, useEffect, useState, type ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  providerMount: vi.fn(),
  providerUnmount: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-panel-island", () => ({
  HostedAuthPanelWithinPrivy() {
    return createElement("div", { "data-shared-auth-panel": "true" });
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

import { HostedAuthRuntime } from "@/src/components/hosted-onboarding/hosted-auth-runtime";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "test-privy-app");
  vi.stubEnv("NEXT_PUBLIC_PRIVY_CLIENT_ID", "test-privy-client");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test("keeps one Privy provider mounted while the dialog opens and remounts only for explicit restart", async () => {
  const rendered = await renderClientComponent(createElement(RuntimeHarness));

  try {
    expect(mocks.providerMount).toHaveBeenCalledTimes(1);
    expect(mocks.providerUnmount).not.toHaveBeenCalled();
    expect(readRuntimeAttempt(rendered.container)).toBe("1");
    expect(rendered.container.textContent).not.toContain("Dialog open");

    await clickButton(rendered, "Open dialog");

    expect(rendered.container.textContent).toContain("Dialog open");
    expect(mocks.providerMount).toHaveBeenCalledTimes(1);
    expect(mocks.providerUnmount).not.toHaveBeenCalled();
    expect(readRuntimeAttempt(rendered.container)).toBe("1");

    await clickButton(rendered, "Restart runtime");

    expect(mocks.providerMount).toHaveBeenCalledTimes(2);
    expect(mocks.providerUnmount).toHaveBeenCalledTimes(1);
    expect(readRuntimeAttempt(rendered.container)).toBe("2");
  } finally {
    await rendered.cleanup();
  }
});

test("reports an unconfigured runtime without mounting Privy", async () => {
  vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "");
  const rendered = await renderClientComponent(
    <HostedAuthRuntime>
      {(runtime) => <p>Runtime: {runtime.kind}</p>}
    </HostedAuthRuntime>,
    { requireButton: false },
  );

  try {
    expect(rendered.container.textContent).toContain("Runtime: unconfigured");
    expect(mocks.providerMount).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});

function RuntimeHarness() {
  const [open, setOpen] = useState(false);

  return (
    <HostedAuthRuntime>
      {(runtime) => {
        if (runtime.kind !== "configured") {
          return <p>Runtime unavailable</p>;
        }

        return (
          <div>
            <p data-runtime-attempt="true">{runtime.attempt}</p>
            <button onClick={() => setOpen(true)} type="button">
              Open dialog
            </button>
            <button onClick={runtime.restart} type="button">
              Restart runtime
            </button>
            {open ? <p>Dialog open</p> : null}
          </div>
        );
      }}
    </HostedAuthRuntime>
  );
}

function readRuntimeAttempt(container: HTMLElement): string | null {
  return container.querySelector("[data-runtime-attempt]")?.textContent ?? null;
}

async function clickButton(
  rendered: Awaited<ReturnType<typeof renderClientComponent>>,
  label: string,
) {
  const button = Array.from(rendered.container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label,
  );
  expect(button).toBeTruthy();

  await act(async () => {
    button?.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });
}
