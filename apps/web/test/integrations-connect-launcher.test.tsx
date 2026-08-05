import { act, createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { IntegrationsConnectLauncher } from "@/src/components/connected-apps/integrations-connect-launcher";

import { renderClientComponent } from "./render-client-component";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("waits five seconds before starting the single-use connection", async () => {
  vi.useFakeTimers();
  const redirectUrl = "https://auth.composio.dev/connect/test";
  const fetchMock = vi.fn(async () => successfulResponse(redirectUrl));
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createElement(IntegrationsConnectLauncher, { claim: "test claim" }),
    {
      location: {
        href: "https://example.test/integrations/connect/test-claim",
      },
    },
  );

  try {
    expect(rendered.container.textContent).toContain(
      "Continuing in 5 seconds",
    );
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/integrations/connect/test%20claim/start",
      expect.objectContaining({
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        method: "POST",
      }),
    );
    expect(rendered.window.location.href).toBe(redirectUrl);
  } finally {
    await rendered.cleanup();
  }
});

test("lets the member continue immediately without starting twice", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn(async () =>
    successfulResponse("https://auth.composio.dev/connect/now"),
  );
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createElement(IntegrationsConnectLauncher, { claim: "test-claim" }),
    {
      location: {
        href: "https://example.test/integrations/connect/test-claim",
      },
    },
  );

  try {
    await act(async () => {
      rendered.button.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rendered.container.textContent).toContain("Opening Composio");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.cleanup();
  }
});

function successfulResponse(redirectUrl: string): Response {
  return new Response(JSON.stringify({ redirectUrl }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}
