import assert from "node:assert/strict";

import { act, createElement } from "react";
import { afterEach, beforeEach, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  decryptHostedStoragePayload: vi.fn(),
  generateHostedUserRecipientKeyPair: vi.fn(),
  navigateHostedAuthRedirect: vi.fn(),
  reloadCurrentHostedAuthDocument: vi.fn(),
  unwrapHostedBrowserSessionKey: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-navigation", () => ({
  navigateHostedAuthRedirect: mocks.navigateHostedAuthRedirect,
  reloadCurrentHostedAuthDocument: mocks.reloadCurrentHostedAuthDocument,
}));

vi.mock("@murphai/runtime-state", async () => {
  const actual = await vi.importActual<typeof import("@murphai/runtime-state")>("@murphai/runtime-state");

  return {
    ...actual,
    buildHostedStorageAad: vi.fn((value: unknown) => value),
    decryptHostedStoragePayload: mocks.decryptHostedStoragePayload,
    generateHostedUserRecipientKeyPair: mocks.generateHostedUserRecipientKeyPair,
    unwrapHostedBrowserSessionKey: mocks.unwrapHostedBrowserSessionKey,
  };
});

import { LandingBrowserVaultWarm } from "@/src/components/homepage/landing-browser-vault-warm";
import { AuthProvider } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import {
  getBrowserVaultReadySnapshot,
  peekBrowserVaultInFlightLoad,
  resetBrowserVaultWarmStateForTests,
} from "@/src/lib/browser-vault/warm-store";

beforeEach(() => {
  resetBrowserVaultWarmStateForTests();
  mocks.navigateHostedAuthRedirect.mockClear();
  mocks.reloadCurrentHostedAuthDocument.mockClear();
  mocks.generateHostedUserRecipientKeyPair.mockResolvedValue({
    privateKeyJwk: { kty: "EC" },
    publicKeyJwk: { kty: "EC" },
  });
});

afterEach(() => {
  resetBrowserVaultWarmStateForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mocks.decryptHostedStoragePayload.mockReset();
  mocks.generateHostedUserRecipientKeyPair.mockReset();
  mocks.unwrapHostedBrowserSessionKey.mockReset();
});

test("anonymous landing visitors never fetch the browser-vault session", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createElement(AuthProvider, { authenticated: false }, createElement(LandingBrowserVaultWarm)),
    { requireButton: false },
  );

  await flush();

  assert.equal(fetchMock.mock.calls.length, 0);
  assert.equal(mocks.generateHostedUserRecipientKeyPair.mock.calls.length, 0);
  assert.equal(peekBrowserVaultInFlightLoad(), null);

  await rendered.cleanup();
});

test("an authenticated landing visitor warms a request that survives unmount", async () => {
  const response = createDeferred<Response>();
  const fetchMock = vi.fn(() => response.promise);
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createElement(AuthProvider, { authenticated: true }, createElement(LandingBrowserVaultWarm)),
    { requireButton: false },
  );

  await waitForCondition(() => fetchMock.mock.calls.length === 1, "landing warm fetch");
  assert.ok(peekBrowserVaultInFlightLoad());

  // Navigating away unmounts the warm component, but the module-memory request
  // keeps running so the dashboard provider can adopt it.
  await rendered.cleanup();
  assert.ok(peekBrowserVaultInFlightLoad());

  response.resolve({
    json: async () => ({ error: "done" }),
    ok: false,
    status: 500,
  } as Response);
  await flush();
});

test("an authenticated landing visitor reloads auth when the warm session is unauthorized", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    error: { message: "Sign in to continue." },
  }), { status: 401 }));
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createElement(AuthProvider, { authenticated: true }, createElement(LandingBrowserVaultWarm)),
    { requireButton: false },
  );

  await waitForCondition(
    () => mocks.navigateHostedAuthRedirect.mock.calls.length === 1,
    "landing auth reload",
  );

  assert.deepEqual(mocks.navigateHostedAuthRedirect.mock.calls, [["/"]]);

  await rendered.cleanup();
});

test("an authenticated landing visitor does not reload for consent or access denial", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    error: { message: "Restore account access to continue." },
  }), { status: 403 }));
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createElement(AuthProvider, { authenticated: true }, createElement(LandingBrowserVaultWarm)),
    { requireButton: false },
  );

  await waitForCondition(() => fetchMock.mock.calls.length === 1, "landing denied fetch");
  await flush();

  assert.equal(mocks.navigateHostedAuthRedirect.mock.calls.length, 0);
  assert.equal(mocks.reloadCurrentHostedAuthDocument.mock.calls.length, 0);
  assert.equal(getBrowserVaultReadySnapshot(), null);

  await rendered.cleanup();
});

async function flush(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function waitForCondition(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await act(async () => {
      await Promise.resolve();
    });

    if (condition()) {
      return;
    }
  }

  throw new Error(`Timed out waiting for ${label}`);
}

function createDeferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}
