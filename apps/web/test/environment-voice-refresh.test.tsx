import assert from "node:assert/strict";

import {
  BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
} from "@murphai/query/browser";
import type {
  HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/browser-vault";
import type {
  BrowserVaultContextValue,
} from "@/src/lib/browser-vault/context";
import { act, createElement, StrictMode, type ReactNode } from "react";
import { beforeEach, test, vi } from "vitest";

type BrowserVaultRefreshOptions = Parameters<
  BrowserVaultContextValue["refresh"]
>[0];

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(async (_options?: BrowserVaultRefreshOptions) => undefined),
  vault: {
    client: null,
    dataVersion: "data-v1",
    deviceSyncImportPending: false,
    error: null,
    freshness: "fresh",
    ref: null as HostedBrowserVaultReplicaRef | null,
    refreshPending: false,
    runtimeRefreshPending: false,
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
    EnvironmentChatAction: () => null,
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
        {
          disabled,
          onClick: disabled
            ? undefined
            : () => {
                onAccepted?.();
              },
          type: "button",
        },
        triggerLabel,
      ),
  }),
);

import EnvironmentPageClient from "../app/(dashboard)/environment/environment-page-client";
import { renderClientComponent } from "./render-client-component";

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.refresh.mockResolvedValue(undefined);
  Object.assign(mocks.vault, {
    client: null,
    dataVersion: "data-v1",
    deviceSyncImportPending: false,
    error: null,
    freshness: "fresh",
    ref: createReplicaRef("a"),
    refreshPending: false,
    runtimeRefreshPending: false,
    status: "empty",
    workspaceVersion: "workspace-v1",
  });
});

test("waits for changed Environment values after realtime topic processing", async () => {
  vi.useFakeTimers();
  const originalFetch = globalThis.fetch;
  const baselineRef = createReplicaRef("a");
  const unrelatedRef = createReplicaRef("b");
  mocks.vault.ref = baselineRef;
  const processingResponses = [false, true, false];
  const fetchMock = vi.fn(async () =>
    Response.json({ processing: processingResponses.shift() ?? false })
  );
  globalThis.fetch = fetchMock;
  const rendered = await renderClientComponent(
    createElement(EnvironmentPageClient, { contactOptions: [] }),
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
    const trigger = Array.from(
      rendered.window.document.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Start report"));
    assert.ok(trigger instanceof rendered.window.HTMLButtonElement);
    await act(async () => {
      trigger.click();
    });
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Murph is saving your answers/,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    assert.equal(mocks.refresh.mock.calls.length, 0);

    mocks.vault.ref = unrelatedRef;
    mocks.vault.workspaceVersion = "workspace-v2";
    await rendered.rerender(
      createElement(EnvironmentPageClient, { contactOptions: [] }),
    );
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Murph is saving your answers/,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    assert.equal(mocks.refresh.mock.calls.length, 1);
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Murph is saving your answers/,
    );
    assert.doesNotMatch(
      rendered.window.document.body.textContent ?? "",
      /The report was not updated/,
    );
    const refreshingTrigger = Array.from(
      rendered.window.document.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Saving report"));
    assert.ok(refreshingTrigger instanceof rendered.window.HTMLButtonElement);
    assert.equal(refreshingTrigger.disabled, true);
    const refreshingNotice = Array.from(
      rendered.window.document.querySelectorAll('[aria-live="polite"]'),
    ).find((element) =>
      element.textContent?.includes("Murph is saving your answers")
    );
    assert.ok(refreshingNotice);

    const refreshOptions = mocks.refresh.mock.calls[0]?.[0];
    assert.equal(refreshOptions?.background, true);
    assert.equal(
      typeof refreshOptions?.requestRuntimeRefreshUntil,
      "function",
    );
    assert.equal(
      refreshOptions?.requestRuntimeRefreshUntilAfterRequest,
      undefined,
    );
  } finally {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    await rendered.cleanup();
  }
});

test("restores server-side realtime processing after reload", async () => {
  vi.useFakeTimers();
  const originalFetch = globalThis.fetch;
  const baselineRef = createReplicaRef("a");
  mocks.vault.ref = baselineRef;
  const processingResponses = [true, true, false];
  globalThis.fetch = vi.fn(async () =>
    Response.json({ processing: processingResponses.shift() ?? false })
  );
  const renderEnvironment = () => createElement(
    StrictMode,
    null,
    createElement(EnvironmentPageClient, { contactOptions: [] }),
  );
  const rendered = await renderClientComponent(
    renderEnvironment(),
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
      /Murph is saving your answers/,
    );
    const processingTrigger = Array.from(
      rendered.window.document.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Saving report"));
    assert.ok(processingTrigger instanceof rendered.window.HTMLButtonElement);
    assert.equal(processingTrigger.disabled, true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    assert.equal(mocks.refresh.mock.calls.length, 1);
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Murph is saving your answers/,
    );

    assert.equal(
      typeof mocks.refresh.mock.calls[0]?.[0]?.requestRuntimeRefreshUntil,
      "function",
    );
  } finally {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    await rendered.cleanup();
  }
});

test("preserves delayed recovery for voice processing and replica refresh timeouts", async () => {
  vi.useFakeTimers();
  const originalFetch = globalThis.fetch;
  const baselineRef = createReplicaRef("a");
  mocks.vault.ref = baselineRef;
  let processing = true;
  const fetchMock = vi.fn(async (
    _input: string | URL | Request,
    _init?: RequestInit,
  ) => Response.json({ processing }));
  globalThis.fetch = fetchMock;
  const rendered = await renderClientComponent(
    createElement(EnvironmentPageClient, { contactOptions: [] }),
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
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Your saved topics are safe/,
    );
    const delayedRecordingTrigger = Array.from(
      rendered.window.document.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Saving report"));
    assert.ok(
      delayedRecordingTrigger instanceof rendered.window.HTMLButtonElement,
    );
    assert.equal(delayedRecordingTrigger.disabled, true);

    const firstCheckAgain = Array.from(
      rendered.window.document.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Check again"));
    assert.ok(firstCheckAgain instanceof rendered.window.HTMLButtonElement);
    await act(async () => {
      firstCheckAgain.click();
      await Promise.resolve();
    });
    assert.ok(fetchMock.mock.calls.some(([input, init]) =>
      input === "/api/environment/realtime/topics" && init?.method === "PATCH"
    ));

    processing = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    assert.equal(mocks.refresh.mock.calls.length, 2);
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Murph is saving your answers/,
    );

    mocks.vault.runtimeRefreshPending = true;
    await rendered.rerender(
      createElement(EnvironmentPageClient, { contactOptions: [] }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60_000);
    });
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Murph is taking longer than usual/,
    );
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Your saved topics are safe/,
    );

    const patchCallsBeforeReplicaRetry = fetchMock.mock.calls.filter(
      ([input, init]) =>
        input === "/api/environment/realtime/topics" && init?.method === "PATCH",
    ).length;
    const secondCheckAgain = Array.from(
      rendered.window.document.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Check again"));
    assert.ok(secondCheckAgain instanceof rendered.window.HTMLButtonElement);
    await act(async () => {
      secondCheckAgain.click();
      await Promise.resolve();
    });
    assert.equal(mocks.refresh.mock.calls.length, 3);
    assert.deepEqual(mocks.refresh.mock.calls[2]?.[0], {
      retryRuntimeRefreshAfterRequest: true,
    });
    assert.equal(fetchMock.mock.calls.filter(
      ([input, init]) =>
        input === "/api/environment/realtime/topics" && init?.method === "PATCH",
    ).length, patchCallsBeforeReplicaRetry + 1);

    assert.equal(
      typeof mocks.refresh.mock.calls[1]?.[0]?.requestRuntimeRefreshUntil,
      "function",
    );
  } finally {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    await rendered.cleanup();
  }
});

function createReplicaRef(version: string): HostedBrowserVaultReplicaRef {
  return {
    byteLength: 128,
    dataVersion: version.repeat(64),
    generatedAt: "2026-08-11T12:00:00.000Z",
    generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
    keyId: `browser-vault-replica:${version}`,
    objectKey: `users/browser-vault-replicas/test/${version}.json`,
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:test-root",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash: version.repeat(64),
  };
}
