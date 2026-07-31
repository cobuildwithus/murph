import assert from "node:assert/strict";

import { act, createElement, StrictMode, type ReactNode } from "react";
import { test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(async () => undefined),
  vault: {
    client: null,
    dataVersion: "data-v1",
    deviceSyncImportPending: false,
    error: null,
    freshness: "fresh",
    ref: null,
    refreshPending: false,
    status: "empty",
    workspaceVersion: "workspace-v1",
  },
}));

vi.mock("@/src/lib/browser-vault/context", () => ({
  useBrowserVault: () => ({
    ...mocks.vault,
    refresh: mocks.refresh,
  }),
}));

vi.mock(
  "../app/(dashboard)/environment/environment-voice-capture",
  () => ({
    EnvironmentVoiceCapture: ({
      disabled,
      onAccepted,
      triggerLabel,
    }: {
      disabled?: boolean;
      onAccepted?: () => void;
      triggerLabel: ReactNode;
    }) =>
      createElement(
        "button",
        { disabled, onClick: disabled ? undefined : onAccepted, type: "button" },
        triggerLabel,
      ),
  }),
);

import EnvironmentPageClient from "../app/(dashboard)/environment/environment-page-client";
import { renderClientComponent } from "./render-client-component";

test("keeps processing through intermediate checkpoints until the voice job finishes", async () => {
  vi.useFakeTimers();
  mocks.refresh.mockClear();
  const originalFetch = globalThis.fetch;
  const processingResponses = [false, true, false];
  const fetchMock = vi.fn(async () =>
    Response.json({ processing: processingResponses.shift() ?? false })
  );
  globalThis.fetch = fetchMock;
  const rendered = await renderClientComponent(
    createElement(EnvironmentPageClient, { contactAction: null }),
    {
      location: {
        hash: "",
        href: "https://local.withmurph.ai/environment",
        origin: "https://local.withmurph.ai",
        pathname: "/environment",
        search: "",
      },
    },
  );

  try {
    const trigger = Array.from(
      rendered.window.document.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Start the 2-minute"));
    assert.ok(trigger instanceof rendered.window.HTMLButtonElement);
    await act(async () => {
      trigger.click();
    });
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Murph is processing your recording/,
    );
    const processingTrigger = Array.from(
      rendered.window.document.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Processing recording"));
    assert.ok(processingTrigger instanceof rendered.window.HTMLButtonElement);
    assert.equal(processingTrigger.disabled, true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    assert.equal(mocks.refresh.mock.calls.length, 1);
    assert.deepEqual(mocks.refresh.mock.calls[0], [{ background: true }]);

    mocks.vault.workspaceVersion = "workspace-v2";
    await rendered.rerender(
      createElement(EnvironmentPageClient, { contactAction: null }),
    );
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Murph is processing your recording/,
    );
    assert.doesNotMatch(
      rendered.window.document.body.textContent ?? "",
      /The report was not updated/,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /The report was not updated/,
    );
    const nextRecordingTrigger = Array.from(
      rendered.window.document.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Start the 2-minute"));
    assert.ok(nextRecordingTrigger instanceof rendered.window.HTMLButtonElement);
    assert.equal(nextRecordingTrigger.disabled, false);
  } finally {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    await rendered.cleanup();
  }
});

test("restores server-side processing state after the page is reopened", async () => {
  vi.useFakeTimers();
  mocks.refresh.mockClear();
  const originalFetch = globalThis.fetch;
  const processingResponses = [true, true, false];
  globalThis.fetch = vi.fn(async () =>
    Response.json({ processing: processingResponses.shift() ?? false })
  );
  const rendered = await renderClientComponent(
    createElement(
      StrictMode,
      null,
      createElement(EnvironmentPageClient, { contactAction: null }),
    ),
    {
      location: {
        hash: "",
        href: "https://local.withmurph.ai/environment",
        origin: "https://local.withmurph.ai",
        pathname: "/environment",
        search: "",
      },
    },
  );

  try {
    await act(async () => {
      await Promise.resolve();
    });
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Murph is processing your recording/,
    );
    const processingTrigger = Array.from(
      rendered.window.document.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Processing recording"));
    assert.ok(processingTrigger instanceof rendered.window.HTMLButtonElement);
    assert.equal(processingTrigger.disabled, true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /The report was not updated/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    await rendered.cleanup();
  }
});

test("keeps checking after processing takes longer than two minutes", async () => {
  vi.useFakeTimers();
  mocks.refresh.mockClear();
  const originalFetch = globalThis.fetch;
  let processing = true;
  const fetchMock = vi.fn(async () => Response.json({ processing }));
  globalThis.fetch = fetchMock;
  const rendered = await renderClientComponent(
    createElement(EnvironmentPageClient, { contactAction: null }),
    {
      location: {
        hash: "",
        href: "https://local.withmurph.ai/environment",
        origin: "https://local.withmurph.ai",
        pathname: "/environment",
        search: "",
      },
    },
  );

  try {
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(2 * 60 * 1_000);
    });
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Murph is taking longer than usual/,
    );
    const callsAtDelay = fetchMock.mock.calls.length;

    processing = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    assert.ok(fetchMock.mock.calls.length > callsAtDelay);
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /The report was not updated/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    await rendered.cleanup();
  }
});
