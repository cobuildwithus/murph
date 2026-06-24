import assert from "node:assert/strict";

import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ComputerHandoffActiveView } from "@/src/components/computer-use/computer-handoff-active-view";

import { renderClientComponent } from "./render-client-component";

const DONE_ENDPOINT = "/api/computer/handoff/handoff-token/done";

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

test("ComputerHandoffActiveView renders the live view iframe immediately", async () => {
  vi.mocked(fetch).mockReturnValue(new Promise<Response>(() => {}));

  const { cleanup, container } = await renderClientComponent(
    createElement(ComputerHandoffActiveView, {
      doneEndpoint: DONE_ENDPOINT,
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
});

test("ComputerHandoffActiveView covers the iframe with the saving overlay while completing a handoff", async () => {
  let resolveDone!: (response: Response) => void;
  const donePromise = new Promise<Response>((resolve) => {
    resolveDone = resolve;
  });
  vi.mocked(fetch).mockReturnValue(donePromise);

  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(ComputerHandoffActiveView, {
      doneEndpoint: DONE_ENDPOINT,
      iframeAllow: "clipboard-read",
      liveViewUrl: "https://browser.example.test/live",
    }),
  );
  cleanupRender = cleanup;

  const iframe = container.querySelector("iframe");
  assert.ok(iframe);

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  await flushReact();

  expect(fetch).toHaveBeenCalledWith(DONE_ENDPOINT, {
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
  expect(container.querySelector("iframe")).toBe(iframe);
});

test.each([
  ["HTTP error", new Response("server error", { status: 500 })],
  ["invalid JSON", new Response("not-json", { status: 200 })],
])("ComputerHandoffActiveView clears the saving overlay after %s", async (_label, response) => {
  vi.mocked(fetch).mockResolvedValue(response);

  const { button, cleanup, container, window } = await renderClientComponent(
    createElement(ComputerHandoffActiveView, {
      doneEndpoint: DONE_ENDPOINT,
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
