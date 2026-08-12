import assert from "node:assert/strict";

import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

import { track } from "@vercel/analytics";

import { ComputerHandoffActiveView } from "@/src/components/computer-use/computer-handoff-active-view";

import { renderClientComponent } from "./render-client-component";

const DONE_ENDPOINT = "/api/computer/handoff/handoff-token/done";

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
  vi.useRealTimers();
});

test("ComputerHandoffActiveView renders the live view behind a takeover overlay", async () => {
  vi.mocked(fetch).mockReturnValue(new Promise<Response>(() => {}));

  const { cleanup, container } = await renderHandoff();
  cleanupRender = cleanup;

  const iframe = container.querySelector("iframe");
  assert.ok(iframe);
  expect(iframe.getAttribute("src")).toBe("https://browser.example.test/live");
  expect(iframe.getAttribute("allow")).toBe("clipboard-read; clipboard-write");
  expect(iframe.getAttribute("referrerPolicy")).toBe("no-referrer");
  expect(iframe.getAttribute("sandbox")).toBe(
    "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals",
  );
  expect(iframe.getAttribute("aria-hidden")).toBe("true");
  expect(iframe.getAttribute("tabindex")).toBe("-1");

  const dialog = container.querySelector('[role="dialog"]');
  assert.ok(dialog);
  expect(dialog.textContent).toContain("Your turn");
  expect(dialog.textContent).toContain("Use the keyboard icon");
  expect(findTakeoverButton(container)).toBeTruthy();
  expect(findDoneButton(container)).toBeNull();
  expect(container.querySelector('[aria-busy="true"]')).toBeNull();
});

test("ComputerHandoffActiveView starts takeover with one click", async () => {
  const { cleanup, container, window } = await renderHandoff();
  cleanupRender = cleanup;

  const iframe = container.querySelector("iframe");
  assert.ok(iframe);
  const iframeFocus = vi.fn();
  (iframe as unknown as { focus: (options?: FocusOptions) => void }).focus = iframeFocus;

  await click(window, findTakeoverButton(container));

  expect(iframeFocus).toHaveBeenCalledOnce();
  expect(iframeFocus).toHaveBeenCalledWith({ preventScroll: true });
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(iframe.getAttribute("aria-hidden")).toBe("false");
  expect(iframe.getAttribute("tabindex")).toBe("0");
  expect(findDoneButton(container)).toBeTruthy();
  expect(findFocusButton(container)).toBeTruthy();
  expect(track).toHaveBeenCalledWith("live_view_focus_enabled");
});

test("ComputerHandoffActiveView can refocus the live view after takeover", async () => {
  const { cleanup, container, window } = await renderHandoff();
  cleanupRender = cleanup;

  const iframe = container.querySelector("iframe");
  assert.ok(iframe);
  const iframeFocus = vi.fn();
  (iframe as unknown as { focus: (options?: FocusOptions) => void }).focus = iframeFocus;

  await click(window, findTakeoverButton(container));
  await click(window, findFocusButton(container));
  await click(window, findFocusButton(container));

  expect(iframeFocus).toHaveBeenCalledTimes(3);
  expect(iframeFocus).toHaveBeenNthCalledWith(1, { preventScroll: true });
  expect(iframeFocus).toHaveBeenNthCalledWith(2, { preventScroll: true });
  expect(iframeFocus).toHaveBeenNthCalledWith(3, { preventScroll: true });
  expect(
    vi.mocked(track).mock.calls.filter(([name]) => name === "live_view_focus_enabled"),
  ).toHaveLength(1);
});

test("ComputerHandoffActiveView unmounts the iframe while completing a handoff", async () => {
  let resolveDone!: (response: Response) => void;
  const donePromise = new Promise<Response>((resolve) => {
    resolveDone = resolve;
  });
  vi.mocked(fetch).mockReturnValue(donePromise);

  const { cleanup, container, window } = await renderHandoff({
    iframeAllow: "clipboard-read",
  });
  cleanupRender = cleanup;

  const iframe = container.querySelector("iframe");
  assert.ok(iframe);

  await click(window, findTakeoverButton(container));
  const doneButton = findDoneButton(container);
  const focusButton = findFocusButton(container);
  assert.ok(doneButton);
  assert.ok(focusButton);

  await click(window, doneButton);

  expect(fetch).toHaveBeenCalledWith(DONE_ENDPOINT, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const savingStatus = container.querySelector('[aria-busy="true"][role="status"]');
  assert.ok(savingStatus);
  expect(savingStatus.textContent).toContain("Saving your progress");
  expect(savingStatus.querySelector("svg .murph-loader-dot")).toBeTruthy();
  expect(container.querySelector("iframe")).toBeNull();
  expect(findDoneButton(container)).toBeNull();
  expect(findFocusButton(container)).toBeNull();

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
  expect(fallbackLink.getAttribute("aria-label")).toBe("Open Murph");
  expect(fallbackLink.textContent).toContain("Open Murph");
  expect(container.querySelector("iframe")).toBeNull();
  expect(track).toHaveBeenCalledWith("handoff_completed");
});

test("ComputerHandoffActiveView fires handoff_abandoned on pagehide while idle", async () => {
  vi.mocked(fetch).mockReturnValue(new Promise<Response>(() => {}));

  const { cleanup, window } = await renderHandoff({ iframeAllow: "clipboard-read" });
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

  const { cleanup, container, window } = await renderHandoff({
    iframeAllow: "clipboard-read",
  });
  cleanupRender = cleanup;

  await click(window, findTakeoverButton(container));
  await click(window, findDoneButton(container));

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
  let resolveDone!: (doneResponse: Response) => void;
  const donePromise = new Promise<Response>((resolve) => {
    resolveDone = resolve;
  });
  vi.mocked(fetch).mockReturnValue(donePromise);

  const { cleanup, container, window } = await renderHandoff({
    iframeAllow: "clipboard-read",
  });
  cleanupRender = cleanup;

  const iframeBeforeClick = container.querySelector("iframe");
  assert.ok(iframeBeforeClick);

  await click(window, findTakeoverButton(container));
  const doneButton = findDoneButton(container);
  const focusButton = findFocusButton(container);
  assert.ok(doneButton);
  assert.ok(focusButton);

  await click(window, doneButton);

  expect(container.querySelector("iframe")).toBeNull();
  expect(container.querySelector('[aria-busy="true"]')?.textContent).toContain(
    "Saving your progress",
  );

  await act(async () => {
    resolveDone(response);
    await donePromise;
    await flushMicrotasks();
  });

  expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Could not complete. Try again.",
  );
  expect(container.querySelector("iframe")).not.toBe(iframeBeforeClick);
  expect(findDoneButton(container)).not.toBe(doneButton);
  expect(findFocusButton(container)).not.toBe(focusButton);
  expect(findDoneButton(container)?.disabled).toBe(false);
  expect(findFocusButton(container)?.disabled).toBe(false);
});

async function renderHandoff(overrides: {
  iframeAllow?: string;
} = {}) {
  return await renderClientComponent(
    createElement(ComputerHandoffActiveView, {
      doneEndpoint: DONE_ENDPOINT,
      iframeAllow: overrides.iframeAllow ?? "clipboard-read; clipboard-write",
      liveViewUrl: "https://browser.example.test/live",
    }),
  );
}

function findTakeoverButton(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-label="Take over the private browser"]',
  );
}

function findDoneButton(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-label="Finish this step and return to Murph"]',
  );
}

function findFocusButton(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-label="Focus the private browser"]',
  );
}

async function click(
  window: Window & typeof globalThis,
  button: HTMLButtonElement | null,
): Promise<void> {
  assert.ok(button);
  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  await flushReact();
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushReact() {
  await act(async () => {
    await flushMicrotasks();
  });
}
