import assert from "node:assert/strict";

import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ComputerHandoffActiveView } from "@/src/components/computer-use/computer-handoff-active-view";
import { resolveComputerBrowserViewportPreset } from "@/src/lib/computer-use/viewport";

import { renderClientComponent } from "./render-client-component";

const DONE_ENDPOINT = "/api/computer/handoff/handoff-token/done";
const VIEWPORT_ENDPOINT = "/api/computer/handoff/handoff-token/viewport";

let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
});

test.each([
  [undefined, "mobile"],
  [767, "mobile"],
  [768, "tablet"],
  [1023, "tablet"],
  [1024, "desktop"],
] as const)("resolves viewport width %s to %s", (width, expected) => {
  expect(resolveComputerBrowserViewportPreset(width)).toBe(expected);
});

test.each([
  [390, "mobile"],
  [1280, "desktop"],
] as const)(
  "ComputerHandoffActiveView waits for viewport matching at width %s, then opens the live view as %s",
  async (viewportWidth, expectedPreset) => {
    let resolveViewport!: (response: Response) => void;
    const viewportPromise = new Promise<Response>((resolve) => {
      resolveViewport = resolve;
    });
    vi.mocked(fetch).mockReturnValue(viewportPromise);

    const { cleanup, container } = await renderClientComponent(
      createElement(ComputerHandoffActiveView, {
        doneEndpoint: DONE_ENDPOINT,
        iframeAllow: "clipboard-read",
        liveViewUrl: "https://browser.example.test/live",
        viewportEndpoint: VIEWPORT_ENDPOINT,
      }),
      { requireButton: false, viewportWidth },
    );
    cleanupRender = cleanup;

    expect(container.querySelector("iframe")).toBeNull();
    const preparingStatus = container.querySelector('[aria-busy="true"][role="status"]');
    assert.ok(preparingStatus);
    expect(preparingStatus.textContent).toContain("Preparing your browser");
    expect(fetch).toHaveBeenCalledWith(
      VIEWPORT_ENDPOINT,
      expect.objectContaining({
        body: JSON.stringify({ preset: expectedPreset }),
        credentials: "same-origin",
        method: "POST",
      }),
    );

    await act(async () => {
      resolveViewport(new Response(null, { status: 204 }));
      await viewportPromise;
      await flushMicrotasks();
    });

    const iframe = container.querySelector("iframe");
    assert.ok(iframe);
    expect(iframe.getAttribute("src")).toBe("https://browser.example.test/live");
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(container.querySelector("button")).toBeTruthy();
  },
);

test("ComputerHandoffActiveView fails open with an inline error when viewport matching fails", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response("server error", { status: 502 }));

  const { cleanup, container } = await renderClientComponent(
    createElement(ComputerHandoffActiveView, {
      doneEndpoint: DONE_ENDPOINT,
      iframeAllow: "clipboard-read",
      liveViewUrl: "https://browser.example.test/live",
      viewportEndpoint: VIEWPORT_ENDPOINT,
    }),
    { viewportWidth: 1280 },
  );
  cleanupRender = cleanup;

  expect(container.querySelector("iframe")).toBeTruthy();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Could not fit the browser to this screen. Showing the current view.",
  );
});

test("ComputerHandoffActiveView covers the iframe with the saving overlay while completing a handoff", async () => {
  let resolveDone!: (response: Response) => void;
  const donePromise = new Promise<Response>((resolve) => {
    resolveDone = resolve;
  });
  vi.mocked(fetch).mockImplementation((input) => {
    if (input === VIEWPORT_ENDPOINT) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (input === DONE_ENDPOINT) {
      return donePromise;
    }
    return Promise.reject(new Error("Unexpected fetch URL."));
  });

  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(ComputerHandoffActiveView, {
      doneEndpoint: DONE_ENDPOINT,
      iframeAllow: "clipboard-read; clipboard-write",
      liveViewUrl: "https://browser.example.test/live",
      viewportEndpoint: VIEWPORT_ENDPOINT,
    }),
    { viewportWidth: 390 },
  );
  cleanupRender = cleanup;

  const iframe = container.querySelector("iframe");
  assert.ok(iframe);
  expect(iframe.getAttribute("allow")).toBe("clipboard-read; clipboard-write");
  expect(iframe.getAttribute("referrerPolicy")).toBe("no-referrer");
  expect(iframe.getAttribute("sandbox")).toBe(
    "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals",
  );

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  await flushReact();

  const savingStatus = container.querySelector('[aria-busy="true"][role="status"]');
  assert.ok(savingStatus);
  expect(savingStatus.textContent).toContain("Saving your progress");
  expect(savingStatus.querySelector("svg .murph-loader-dot")).toBeTruthy();
  expect(container.querySelector("iframe")).toBe(iframe);

  await act(async () => {
    resolveDone(new Response(JSON.stringify({ redirectTo: "sms:+15550100001?body=Done" }), {
      headers: { "content-type": "application/json" },
      status: 200,
    }));
    await donePromise;
    await flushMicrotasks();
  });

  expect(window.location.href).toBe("sms:+15550100001?body=Done");
  expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  const successStatus = container.querySelector('[role="status"]');
  assert.ok(successStatus);
  expect(successStatus.textContent).toContain("All set");
  const fallbackLink = successStatus.querySelector("a");
  assert.ok(fallbackLink);
  expect(fallbackLink.getAttribute("href")).toBe("sms:+15550100001?body=Done");
  expect(fallbackLink.textContent).toContain("Open Murph");
});

test.each([
  ["HTTP error", new Response("server error", { status: 500 })],
  ["invalid JSON", new Response("not-json", { status: 200 })],
])("ComputerHandoffActiveView clears the saving overlay after %s", async (_label, response) => {
  vi.mocked(fetch).mockImplementation(async (input) => {
    if (input === VIEWPORT_ENDPOINT) {
      return new Response(null, { status: 204 });
    }
    return response;
  });

  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(ComputerHandoffActiveView, {
      doneEndpoint: DONE_ENDPOINT,
      iframeAllow: "clipboard-read",
      liveViewUrl: "https://browser.example.test/live",
      viewportEndpoint: VIEWPORT_ENDPOINT,
    }),
    { viewportWidth: 390 },
  );
  cleanupRender = cleanup;

  const iframeBeforeClick = container.querySelector("iframe");
  assert.ok(iframeBeforeClick);
  expect(iframeBeforeClick.getAttribute("src")).toBe("https://browser.example.test/live");

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  await flushReact();

  expect(container.querySelector("iframe")).toBe(iframeBeforeClick);
  expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Could not complete. Try again.",
  );
  expect(button.disabled).toBe(false);
});

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushReact() {
  await act(async () => {
    await flushMicrotasks();
  });
}
