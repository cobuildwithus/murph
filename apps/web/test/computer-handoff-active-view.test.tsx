import assert from "node:assert/strict";

import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

import { track } from "@vercel/analytics";

import { ComputerHandoffActiveView } from "@/src/components/computer-use/computer-handoff-active-view";

import { renderClientComponent } from "./render-client-component";

let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.mocked(track).mockClear();
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
});

test("ComputerHandoffActiveView covers the iframe with the saving overlay while completing a handoff", async () => {
  let resolveFetch!: (response: Response) => void;
  const fetchPromise = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });
  vi.mocked(fetch).mockReturnValue(fetchPromise);

  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(ComputerHandoffActiveView, {
      doneEndpoint: "/api/computer/handoff/handoff-token/done",
      iframeAllow: "clipboard-read; clipboard-write",
      liveViewUrl: "https://browser.example.test/live",
    }),
  );
  cleanupRender = cleanup;

  const iframe = container.querySelector("iframe");
  assert.ok(iframe);
  expect(iframe.getAttribute("src")).toBe("https://browser.example.test/live");
  expect(iframe.getAttribute("allow")).toBe("clipboard-read; clipboard-write");
  expect(iframe.getAttribute("referrerPolicy")).toBe("no-referrer");
  expect(iframe.getAttribute("sandbox")).toBe(
    "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals",
  );
  expect(container.querySelector('[aria-busy="true"]')).toBeNull();

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  await flushReact();

  expect(fetch).toHaveBeenCalledWith("/api/computer/handoff/handoff-token/done", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const savingStatus = container.querySelector('[aria-busy="true"][role="status"]');
  assert.ok(savingStatus);
  expect(savingStatus.textContent).toContain("Saving your progress");
  expect(savingStatus.querySelector("svg .murph-loader-dot")).toBeTruthy();
  expect(container.querySelector("iframe")).toBe(iframe);

  await act(async () => {
    resolveFetch(new Response(JSON.stringify({ redirectTo: "sms:+15550100001?body=Done" }), {
      headers: { "content-type": "application/json" },
      status: 200,
    }));
    await fetchPromise;
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
  expect(container.querySelector("iframe")).toBe(iframe);
  expect(track).toHaveBeenCalledWith("handoff_completed");
});

test("ComputerHandoffActiveView focuses the iframe when the keyboard button is clicked", async () => {
  const { cleanup, container, window } = await renderClientComponent(
    createElement(ComputerHandoffActiveView, {
      doneEndpoint: "/api/computer/handoff/handoff-token/done",
      iframeAllow: "clipboard-read; clipboard-write",
      liveViewUrl: "https://browser.example.test/live",
    }),
  );
  cleanupRender = cleanup;

  const iframe = container.querySelector("iframe");
  assert.ok(iframe);
  const iframeFocus = vi.fn();
  (iframe as unknown as { focus: () => void }).focus = iframeFocus;

  const focusButton = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Enable keyboard and paste in the private page"]',
  );
  assert.ok(focusButton);
  expect(focusButton.textContent).toContain("Enable keyboard");

  await act(async () => {
    focusButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  await flushReact();

  expect(iframeFocus).toHaveBeenCalledOnce();
  expect(track).toHaveBeenCalledWith("live_view_focus_enabled");
  expect(focusButton.textContent).toContain("Keyboard ready");
  expect(focusButton.getAttribute("aria-pressed")).toBe("true");

  await act(async () => {
    focusButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  await flushReact();

  expect(iframeFocus).toHaveBeenCalledTimes(2);
  expect(
    vi.mocked(track).mock.calls.filter(([name]) => name === "live_view_focus_enabled"),
  ).toHaveLength(1);
});

test("ComputerHandoffActiveView fires handoff_abandoned on pagehide while idle", async () => {
  vi.mocked(fetch).mockReturnValue(new Promise<Response>(() => {}));

  const { cleanup, window } = await renderClientComponent(
    createElement(ComputerHandoffActiveView, {
      doneEndpoint: "/api/computer/handoff/handoff-token/done",
      iframeAllow: "clipboard-read",
      liveViewUrl: "https://browser.example.test/live",
    }),
  );
  cleanupRender = cleanup;

  await act(async () => {
    window.dispatchEvent(new window.Event("pagehide"));
  });

  expect(track).toHaveBeenCalledWith("handoff_abandoned");

  await act(async () => {
    window.dispatchEvent(new window.Event("pagehide"));
  });

  expect(
    vi.mocked(track).mock.calls.filter(([name]) => name === "handoff_abandoned"),
  ).toHaveLength(1);
});

test("ComputerHandoffActiveView does not fire handoff_abandoned after completion", async () => {
  let resolveFetch!: (response: Response) => void;
  const fetchPromise = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });
  vi.mocked(fetch).mockReturnValue(fetchPromise);

  const { button, cleanup, window } = await renderClientComponent(
    createElement(ComputerHandoffActiveView, {
      doneEndpoint: "/api/computer/handoff/handoff-token/done",
      iframeAllow: "clipboard-read",
      liveViewUrl: "https://browser.example.test/live",
    }),
  );
  cleanupRender = cleanup;

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  await flushReact();

  await act(async () => {
    resolveFetch(new Response(JSON.stringify({ redirectTo: "sms:+15550100001?body=Done" }), {
      headers: { "content-type": "application/json" },
      status: 200,
    }));
    await fetchPromise;
    await flushMicrotasks();
  });

  await act(async () => {
    window.dispatchEvent(new window.Event("pagehide"));
  });

  expect(track).toHaveBeenCalledWith("handoff_completed");
  expect(
    vi.mocked(track).mock.calls.filter(([name]) => name === "handoff_abandoned"),
  ).toHaveLength(0);
});

test.each([
  ["HTTP error", new Response("server error", { status: 500 })],
  ["invalid JSON", new Response("not-json", { status: 200 })],
])("ComputerHandoffActiveView clears the saving overlay after %s", async (_label, response) => {
  vi.mocked(fetch).mockResolvedValue(response);

  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(ComputerHandoffActiveView, {
      doneEndpoint: "/api/computer/handoff/handoff-token/done",
      iframeAllow: "clipboard-read",
      liveViewUrl: "https://browser.example.test/live",
    }),
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
