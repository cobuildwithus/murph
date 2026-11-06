import { act, createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { IntegrationsConnectLauncher } from "@/src/components/connected-apps/integrations-connect-launcher";

import { renderClientComponent } from "./render-client-component";

const LAUNCHER_PROPS = {
  accountLabel: "Gmail",
  claim: "test-claim",
  logoSrc: "/brand-logos/connect/gmail.svg",
};

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
    createElement(IntegrationsConnectLauncher, { ...LAUNCHER_PROPS, claim: "test claim" }),
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
    expect(rendered.button.textContent).toBe("Continuing in 5");
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(rendered.button.textContent).toBe("Continuing in 3");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(rendered.button.textContent).toBe("Continuing in 1");
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
    createElement(IntegrationsConnectLauncher, LAUNCHER_PROPS),
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
    expect(rendered.container.querySelector('[role="status"]')?.textContent)
      .toBe("Opening…");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.cleanup();
  }
});

test("lets the member pause automatic continuation and continue later", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn(async () =>
    successfulResponse("https://auth.composio.dev/connect/paused"),
  );
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createElement(IntegrationsConnectLauncher, LAUNCHER_PROPS),
    {
      location: {
        href: "https://example.test/integrations/connect/test-claim",
      },
    },
  );

  try {
    const buttons = [...rendered.container.querySelectorAll("button")];
    const stayHereButton = buttons.find(
      (button) => button.textContent?.includes("Stay here"),
    );
    expect(stayHereButton).toBeDefined();

    await act(async () => {
      stayHereButton?.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });
    expect(rendered.container.textContent).toContain(
      "Automatic continuation paused",
    );
    expect(rendered.button.textContent).toBe("Continue");
    expect(rendered.container.textContent).not.toContain("Stay here");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      rendered.button.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.cleanup();
  }
});

test("does not abort a connection that starts as the member pauses", async () => {
  vi.useFakeTimers();
  const redirectUrl = "https://auth.composio.dev/connect/boundary";
  let requestSignal: AbortSignal | null | undefined;
  let resolveFetch: ((response: Response) => void) | undefined;
  const fetchResult = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });
  const fetchMock = vi.fn((
    _input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    requestSignal = init?.signal;
    return fetchResult;
  });
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createElement(IntegrationsConnectLauncher, LAUNCHER_PROPS),
    {
      location: {
        href: "https://example.test/integrations/connect/test-claim",
      },
    },
  );

  try {
    const stayHereButton = [...rendered.container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Stay here"));
    expect(stayHereButton).toBeDefined();

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      stayHereButton?.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestSignal?.aborted).toBe(false);

    resolveFetch?.(successfulResponse(redirectUrl));
    await act(async () => {
      await fetchResult;
      await Promise.resolve();
    });

    expect(requestSignal?.aborted).toBe(false);
    expect(rendered.window.location.href).toBe(redirectUrl);
  } finally {
    await rendered.cleanup();
  }
});

test("waits for five visible seconds when mounted in a hidden tab", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn(async () =>
    successfulResponse("https://auth.composio.dev/connect/visible"),
  );
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createElement(IntegrationsConnectLauncher, LAUNCHER_PROPS),
    {
      location: {
        href: "https://example.test/integrations/connect/test-claim",
      },
      visibilityState: "hidden",
    },
  );

  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    Object.defineProperty(rendered.window.document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    rendered.window.document.dispatchEvent(
      new rendered.window.Event("visibilitychange"),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.cleanup();
  }
});

test("restarts the five-second interval after the tab becomes visible again", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn(async () =>
    successfulResponse("https://auth.composio.dev/connect/resumed"),
  );
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createElement(IntegrationsConnectLauncher, LAUNCHER_PROPS),
    {
      location: {
        href: "https://example.test/integrations/connect/test-claim",
      },
    },
  );

  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    Object.defineProperty(rendered.window.document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    rendered.window.document.dispatchEvent(
      new rendered.window.Event("visibilitychange"),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    Object.defineProperty(rendered.window.document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    rendered.window.document.dispatchEvent(
      new rendered.window.Event("visibilitychange"),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.cleanup();
  }
});

test("stays on the page with an alert and retries only by reloading when the start request fails", async () => {
  vi.useFakeTimers();
  const initialHref = "https://example.test/integrations/connect/test-claim";
  const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createElement(IntegrationsConnectLauncher, LAUNCHER_PROPS),
    { location: { href: initialHref } },
  );

  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rendered.window.location.href).toBe(initialHref);
    expect(rendered.container.textContent).toContain("Gmail didn’t connect.");
    expect(rendered.container.querySelector('[role="alert"]')?.textContent)
      .toContain("Try again, or ask Murph for a new link.");

    // A claim is single-use, so Try again reloads the page and never posts again.
    const retryButton = rendered.container.querySelector("button");
    expect(retryButton?.textContent).toBe("Try again");
    await act(async () => {
      retryButton?.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });
    expect(rendered.reload).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    await rendered.cleanup();
  }
});

test("aborts an in-flight start and ignores its late success after unmount", async () => {
  vi.useFakeTimers();
  const initialHref = "https://example.test/integrations/connect/test-claim";
  let requestSignal: AbortSignal | null | undefined;
  let resolveFetch: ((response: Response) => void) | undefined;
  const fetchResult = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });
  const fetchMock = vi.fn((
    _input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    requestSignal = init?.signal;
    return fetchResult;
  });
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createElement(IntegrationsConnectLauncher, LAUNCHER_PROPS),
    { location: { href: initialHref } },
  );
  let cleanedUp = false;

  try {
    await act(async () => {
      rendered.button.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestSignal?.aborted).toBe(false);

    await rendered.cleanup();
    cleanedUp = true;
    expect(requestSignal?.aborted).toBe(true);

    resolveFetch?.(successfulResponse("https://auth.composio.dev/connect/late"));
    await fetchResult;
    await Promise.resolve();

    expect(rendered.window.location.href).toBe(initialHref);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    if (!cleanedUp) {
      await rendered.cleanup();
    }
  }
});

function successfulResponse(redirectUrl: string): Response {
  return new Response(JSON.stringify({ redirectUrl }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}
