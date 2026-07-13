import assert from "node:assert/strict";

import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  type BrowserVaultReplica,
} from "@murphai/query/browser";
import { act, useState } from "react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => {
  const sessionInvalidation = {
    ending: false,
    listeners: new Set<(
      source?:
        | "same-document"
        | "same-document-clear"
        | "cross-document"
        | "cross-document-clear"
    ) => void>(),
  };
  const publishSessionInvalidation = () => {
    sessionInvalidation.ending = false;
    for (const listener of [...sessionInvalidation.listeners]) {
      listener("same-document");
    }
  };
  const publishSessionEnding = () => {
    sessionInvalidation.ending = true;
    for (const listener of [...sessionInvalidation.listeners]) {
      listener("same-document-clear");
    }
  };

  return {
    decryptHostedStoragePayload: vi.fn(),
    generateHostedUserRecipientKeyPair: vi.fn(),
    navigateHostedAuthRedirect: vi.fn(),
    reloadCurrentHostedAuthDocument: vi.fn(),
    publishBrowserVaultSessionEnding: vi.fn(publishSessionEnding),
    publishBrowserVaultSessionInvalidation: vi.fn(publishSessionInvalidation),
    sessionInvalidation,
    subscribeBrowserVaultSessionInvalidation: vi.fn((listener: () => void) => {
      sessionInvalidation.listeners.add(listener);
      return () => {
        sessionInvalidation.listeners.delete(listener);
      };
    }),
    unwrapHostedBrowserSessionKey: vi.fn(),
    usePathname: vi.fn(() => "/home"),
  };
});

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
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

vi.mock("@/src/lib/browser-vault/session-invalidation", () => ({
  isBrowserVaultSessionEnding: () => mocks.sessionInvalidation.ending,
  publishBrowserVaultSessionEnding:
    mocks.publishBrowserVaultSessionEnding,
  publishBrowserVaultSessionInvalidation:
    mocks.publishBrowserVaultSessionInvalidation,
  subscribeBrowserVaultSessionInvalidation:
    mocks.subscribeBrowserVaultSessionInvalidation,
}));

import {
  BrowserVaultProvider,
  useBrowserVault,
  useBrowserVaultSelector,
} from "@/src/lib/browser-vault/context";
import {
  abortBrowserVaultInFlightLoad,
  clearBrowserVaultWarmState,
  getBrowserVaultReadySnapshot,
  peekBrowserVaultInFlightLoad,
  startBrowserVaultWarmLoad,
} from "@/src/lib/browser-vault/warm-store";
import { AuthProvider } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { requestHostedPrivyCompletionWithRetry } from "@/src/components/hosted-onboarding/hosted-privy-auth-support";
import { logoutHostedAppSession } from "@/src/components/hosted-onboarding/hosted-app-session-client";

beforeEach(() => {
  // The warm path lives in module memory; reset it so ready snapshots and
  // in-flight loads never leak between tests.
  clearBrowserVaultWarmState();
  mocks.sessionInvalidation.ending = false;
  mocks.sessionInvalidation.listeners.clear();
  mocks.navigateHostedAuthRedirect.mockClear();
  mocks.reloadCurrentHostedAuthDocument.mockClear();
  mocks.publishBrowserVaultSessionEnding.mockClear();
  mocks.publishBrowserVaultSessionInvalidation.mockClear();
  mocks.usePathname.mockReset();
  mocks.usePathname.mockReturnValue("/home");
});

afterEach(() => {
  clearBrowserVaultWarmState();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mocks.decryptHostedStoragePayload.mockReset();
  mocks.generateHostedUserRecipientKeyPair.mockReset();
  mocks.unwrapHostedBrowserSessionKey.mockReset();
});

test("browser-vault provider rejects not_modified refs that do not match the known replica", async () => {
  const ref = createReplicaRef();
  const mismatchedRef = {
    ...ref,
    sourceBundleHash: "b".repeat(64),
  };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }))
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: null,
      memberId: "member_123",
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: mismatchedRef,
      state: "not_modified",
    }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, "ready");
  await act(async () => {
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
  });
  await waitForText(rendered.container, "error");

  const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
  assert.deepEqual(secondRequest.knownReplicaRef, ref);
  assert.equal(rendered.container.textContent?.includes("Your dashboard data is not available right now."), true);

  await rendered.cleanup();
});

test("fresh endpoint authority recovers cached-denied UI without exposing warm data", async () => {
  const ref = createReplicaRef();
  const authorityResponse = createDeferred<Response>();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }))
    .mockImplementationOnce(() => authorityResponse.promise);

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  await startBrowserVaultWarmLoad();
  const warmedClient = getBrowserVaultReadySnapshot()?.client;
  assert.ok(warmedClient);

  const rendered = await renderClientComponent(
    <BrowserVaultProvider initialMemberId="member_123">
      <BrowserVaultStatusProbe />
    </BrowserVaultProvider>,
    { requireButton: false },
  );

  await waitForCondition(() => fetchMock.mock.calls.length === 2, "fresh authority request");
  assert.equal(rendered.container.textContent, "loading:none");

  authorityResponse.resolve(jsonResponse({
    encryptedReplica: null,
    memberId: "member_123",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: ref,
    state: "not_modified",
  }));

  await waitForText(rendered.container, `ready:${ref.dataVersion}`);
  assert.equal(getBrowserVaultReadySnapshot()?.client, warmedClient);
  assert.equal(mocks.unwrapHostedBrowserSessionKey.mock.calls.length, 1);

  await rendered.cleanup();
});

test("a 401 clears private vault state without ejecting a public dashboard route", async () => {
  const ref = createReplicaRef();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      error: { message: "Unauthorized" },
    }), { status: 401 }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  await startBrowserVaultWarmLoad();
  assert.ok(getBrowserVaultReadySnapshot());

  const rendered = await renderClientComponent(
    <BrowserVaultProvider initialMemberId={null}>
      <PublicDashboardRouteProbe />
    </BrowserVaultProvider>,
    { requireButton: false },
  );

  await waitForText(rendered.container, "public:empty:none");
  assert.equal(getBrowserVaultReadySnapshot(), null);
  assert.equal(mocks.navigateHostedAuthRedirect.mock.calls.length, 0);
  assert.equal(mocks.reloadCurrentHostedAuthDocument.mock.calls.length, 0);
  assert.equal(fetchMock.mock.calls.length, 2);

  await rendered.cleanup();
});

test("an authenticated dashboard reloads when current browser-vault authority returns 401", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
    error: { message: "Unauthorized" },
  }), { status: 401 }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, "empty:none");
  assert.equal(getBrowserVaultReadySnapshot(), null);
  assert.equal(mocks.reloadCurrentHostedAuthDocument.mock.calls.length, 1);
  assert.equal(fetchMock.mock.calls.length, 1);

  await rendered.cleanup();
});

test("browser-vault provider does not poll stale empty sessions without pending refresh", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
    encryptedReplica: null,
    freshness: "stale",
    memberId: "member_123",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: null,
    refreshPending: false,
    state: "empty",
    workspaceVersion: null,
  }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, "empty:none");
  assert.equal(rendered.container.textContent?.includes("Preparing dashboard..."), false);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(25_000);
  });

  assert.equal(fetchMock.mock.calls.length, 1);

  await rendered.cleanup();
});

test("browser-vault provider exposes pending device imports without showing a global sync warning", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
    deviceSyncImportPending: true,
    encryptedReplica: null,
    freshness: "stale",
    memberId: "member_123",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: null,
    refreshPending: false,
    state: "empty",
    workspaceVersion: null,
  }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultImportProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, "empty:importing");
  assert.equal(rendered.container.textContent?.includes("Importing wearable data..."), false);
  assert.equal(rendered.container.textContent?.includes("Preparing dashboard..."), false);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(25_000);
  });

  assert.equal(fetchMock.mock.calls.length, 1);

  await rendered.cleanup();
});

test("browser-vault provider polls pending refreshes without a global sync indicator", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
    encryptedReplica: null,
    freshness: "stale",
    memberId: "member_123",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: null,
    refreshPending: true,
    state: "empty",
    workspaceVersion: "1",
  }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, "empty:none");
  assert.equal(rendered.container.textContent?.includes("Preparing dashboard..."), false);
  assert.equal(rendered.container.textContent?.includes("Syncing latest changes..."), false);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });

  assert.equal(fetchMock.mock.calls.length > 1, true);
  assert.equal(rendered.container.textContent?.includes("Preparing dashboard..."), false);
  assert.equal(rendered.container.textContent?.includes("Syncing latest changes..."), false);

  await rendered.cleanup();
});

test("current endpoint denial never adopts a matching warm snapshot", async () => {
  const ref = createReplicaRef();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      error: { message: "Restore account access to continue." },
    }), { status: 403 }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  await startBrowserVaultWarmLoad();
  assert.ok(getBrowserVaultReadySnapshot());

  const rendered = await renderClientComponent(
    <BrowserVaultProvider initialMemberId="member_123">
      <BrowserVaultStatusProbe />
    </BrowserVaultProvider>,
    { requireButton: false },
  );

  await waitForText(
    rendered.container,
    "error:Your dashboard session expired. Refresh and try again.",
  );
  assert.equal(rendered.container.textContent?.includes(ref.dataVersion), false);
  assert.equal(getBrowserVaultReadySnapshot(), null);
  assert.equal(fetchMock.mock.calls.length, 2);

  await rendered.cleanup();
});

test("fresh member B authority cannot enter a server-rendered member A document", async () => {
  const ref = createReplicaRef();
  const memberBProof = createDeferred<Response>();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }))
    .mockImplementationOnce(() => memberBProof.promise);

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  await startBrowserVaultWarmLoad();
  assert.equal(getBrowserVaultReadySnapshot()?.memberId, "member_123");

  const rendered = await renderClientComponent(
    <BrowserVaultProvider initialMemberId="member_123">
      <BrowserVaultStatusProbe />
    </BrowserVaultProvider>,
    { requireButton: false },
  );

  await waitForCondition(() => fetchMock.mock.calls.length === 2, "member B authority request");
  assert.equal(rendered.container.textContent, "loading:none");

  memberBProof.resolve(jsonResponse({
    encryptedReplica: null,
    memberId: "member_456",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: ref,
    state: "not_modified",
  }));

  await waitForText(rendered.container, "empty:none");
  assert.equal(getBrowserVaultReadySnapshot(), null);
  assert.equal(fetchMock.mock.calls.length, 2);
  assert.equal(mocks.reloadCurrentHostedAuthDocument.mock.calls.length, 1);

  await rendered.cleanup();
});

test("a cross-member not_modified proof clears instead of refetching under the replacement member", async () => {
  const ref = createReplicaRef();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }))
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: null,
      memberId: "member_456",
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: ref,
      state: "not_modified",
    }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  await startBrowserVaultWarmLoad();
  const outcome = await startBrowserVaultWarmLoad();

  assert.equal(outcome.status, "identity_changed");
  assert.equal(getBrowserVaultReadySnapshot(), null);
  assert.equal(fetchMock.mock.calls.length, 2);
});

test.each(["ready", "empty"] as const)(
  "fresh member B %s authority cannot enter a server-rendered member A document",
  async (state) => {
    const ref = createReplicaRef();
    const memberBResponse = state === "ready"
      ? {
          encryptedReplica: createReplicaEnvelope(),
          replicaAad: createReplicaAad("member_456"),
          replicaKeyEnvelope: createReplicaKeyEnvelope("member_456"),
          replicaRef: ref,
          state,
        }
      : {
          encryptedReplica: null,
          freshness: "stale",
          memberId: "member_456",
          replicaAad: null,
          replicaKeyEnvelope: null,
          replicaRef: null,
          refreshPending: false,
          state,
          workspaceVersion: null,
        };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        encryptedReplica: createReplicaEnvelope(),
        replicaAad: createReplicaAad(),
        replicaKeyEnvelope: createReplicaKeyEnvelope(),
        replicaRef: ref,
        state: "ready",
      }))
      .mockResolvedValueOnce(jsonResponse(memberBResponse));

    installBrowserVaultCryptoMocks();
    vi.stubGlobal("fetch", fetchMock);

    await startBrowserVaultWarmLoad();
    const rendered = await renderClientComponent(
      createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
      { requireButton: false },
    );

    await waitForText(rendered.container, "empty:none");
    assert.equal(getBrowserVaultReadySnapshot(), null);
    assert.equal(mocks.reloadCurrentHostedAuthDocument.mock.calls.length, 1);
    assert.equal(fetchMock.mock.calls.length, 2);
    assert.equal(mocks.unwrapHostedBrowserSessionKey.mock.calls.length, 1);

    await rendered.cleanup();
  },
);

test("browser-vault provider drops member A's client after a cross-tab session invalidation", async () => {
  const ref = createReplicaRef();
  const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
    encryptedReplica: createReplicaEnvelope(),
    replicaAad: createReplicaAad(),
    replicaKeyEnvelope: createReplicaKeyEnvelope(),
    replicaRef: ref,
    state: "ready",
  }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, `ready:${ref.dataVersion}`);
  assert.ok(getBrowserVaultReadySnapshot());
  assert.equal(mocks.sessionInvalidation.listeners.size > 0, true);

  await act(async () => {
    for (const listener of [...mocks.sessionInvalidation.listeners]) {
      listener();
    }
  });

  assert.equal(rendered.container.textContent, "empty:none");
  assert.equal(getBrowserVaultReadySnapshot(), null);
  assert.equal(fetchMock.mock.calls.length, 1);

  await rendered.cleanup();
});

test("browser-vault provider clears a ready client when internal navigation finds a revoked session", async () => {
  const ref = createReplicaRef();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }))
    .mockResolvedValueOnce({
      json: async () => ({ error: "Unauthorized" }),
      ok: false,
      status: 401,
    } as Response);

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  function PathTransitionHarness() {
    const [, rerender] = useState(0);

    return createAuthenticatedBrowserVaultElement(
      createElement(BrowserVaultStatusProbe, {
        onClick: () => {
          mocks.usePathname.mockReturnValue("/history");
          rerender((version) => version + 1);
        },
      }),
    );
  }

  const rendered = await renderClientComponent(
    createElement(PathTransitionHarness),
    { requireButton: false },
  );

  await waitForText(rendered.container, `ready:${ref.dataVersion}`);
  await act(async () => {
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
  });
  await waitForText(rendered.container, "empty:none");

  assert.equal(fetchMock.mock.calls.length, 2);
  assert.equal(getBrowserVaultReadySnapshot(), null);
  assert.equal(mocks.navigateHostedAuthRedirect.mock.calls.length, 0);

  await rendered.cleanup();
});

test("persistent provider keeps the same ready client across failed route revalidation", async () => {
  const ref = createReplicaRef();
  const revalidationResponse = createDeferred<Response>();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }))
    .mockImplementationOnce(() => revalidationResponse.promise);

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  function PathTransitionHarness() {
    const [, rerender] = useState(0);

    return createAuthenticatedBrowserVaultElement(
      createElement(BrowserVaultStatusProbe, {
        onClick: () => {
          mocks.usePathname.mockReturnValue("/history");
          rerender((version) => version + 1);
        },
      }),
    );
  }

  const rendered = await renderClientComponent(
    createElement(PathTransitionHarness),
    { requireButton: false },
  );

  await waitForText(rendered.container, `ready:${ref.dataVersion}`);
  const admittedClient = getBrowserVaultReadySnapshot()?.client;
  assert.ok(admittedClient);

  await act(async () => {
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
  });
  await waitForCondition(() => fetchMock.mock.calls.length === 2, "route revalidation");
  assert.equal(rendered.container.textContent, `ready:${ref.dataVersion}`);

  revalidationResponse.resolve(new Response(JSON.stringify({
    error: { message: "Temporary failure" },
  }), { status: 500 }));
  for (let flush = 0; flush < 6; flush += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }

  assert.equal(rendered.container.textContent, `ready:${ref.dataVersion}`);
  assert.equal(getBrowserVaultReadySnapshot()?.client, admittedClient);

  await rendered.cleanup();
});

test("browser-vault provider clears a fresh ready client when window focus finds a revoked session", async () => {
  const ref = createReplicaRef();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }))
    .mockResolvedValueOnce({
      json: async () => ({ error: "Unauthorized" }),
      ok: false,
      status: 401,
    } as Response);

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, `ready:${ref.dataVersion}`);
  await act(async () => {
    rendered.window.dispatchEvent(new rendered.window.Event("focus"));
  });
  await waitForText(rendered.container, "empty:none");

  assert.equal(fetchMock.mock.calls.length, 2);
  assert.equal(getBrowserVaultReadySnapshot(), null);
  assert.equal(mocks.navigateHostedAuthRedirect.mock.calls.length, 0);

  await rendered.cleanup();
});

test("browser-vault provider keeps access-denied recovery pages mounted without redirecting", async () => {
  const ref = createReplicaRef();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        message: "Restore account access to continue.",
      },
    }), { status: 403 }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, `ready:${ref.dataVersion}`);
  await act(async () => {
    rendered.window.dispatchEvent(new rendered.window.Event("focus"));
  });
  await waitForText(
    rendered.container,
    "error:Your dashboard session expired. Refresh and try again.",
  );

  assert.equal(getBrowserVaultReadySnapshot(), null);
  assert.equal(mocks.navigateHostedAuthRedirect.mock.calls.length, 0);

  await rendered.cleanup();
});

test("a warmed member A snapshot cannot outlive its page owner after session invalidation", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
    encryptedReplica: createReplicaEnvelope(),
    replicaAad: createReplicaAad(),
    replicaKeyEnvelope: createReplicaKeyEnvelope(),
    replicaRef: createReplicaRef(),
    state: "ready",
  }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  await startBrowserVaultWarmLoad();
  assert.ok(getBrowserVaultReadySnapshot());
  assert.equal(mocks.sessionInvalidation.listeners.size, 1);

  for (const listener of [...mocks.sessionInvalidation.listeners]) {
    listener();
  }

  assert.equal(getBrowserVaultReadySnapshot(), null);
  assert.equal(mocks.sessionInvalidation.listeners.size, 0);
});

test("render-to-subscription invalidation cannot preserve member A after revalidation fails", async () => {
  const ref = createReplicaRef();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }))
    .mockResolvedValueOnce({
      json: async () => ({ error: "Temporary failure" }),
      ok: false,
      status: 500,
    } as Response);

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  await startBrowserVaultWarmLoad();
  assert.ok(getBrowserVaultReadySnapshot());
  assert.equal(mocks.sessionInvalidation.listeners.size, 1);

  let invalidatedDuringRender = false;
  function RenderInvalidationProbe() {
    if (!invalidatedDuringRender) {
      invalidatedDuringRender = true;
      mocks.publishBrowserVaultSessionInvalidation();
    }

    return createElement(BrowserVaultStatusProbe);
  }

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(RenderInvalidationProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, "error:");
  assert.equal(invalidatedDuringRender, true);
  assert.equal(mocks.publishBrowserVaultSessionInvalidation.mock.calls.length, 1);
  assert.equal(rendered.container.textContent?.includes(ref.dataVersion), false);
  assert.equal(getBrowserVaultReadySnapshot(), null);
  assert.equal(fetchMock.mock.calls.length, 2);

  await rendered.cleanup();
});

test("an invalidation before provider adoption makes an already-resolved ready outcome uncommittable", async () => {
  const response = createDeferred<Response>();
  const fetchMock = vi.fn(() => response.promise);

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const landingLoad = startBrowserVaultWarmLoad();
  void landingLoad.then(() => {
    mocks.publishBrowserVaultSessionInvalidation();
  });

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  response.resolve(jsonResponse({
    encryptedReplica: createReplicaEnvelope(),
    replicaAad: createReplicaAad(),
    replicaKeyEnvelope: createReplicaKeyEnvelope(),
    replicaRef: createReplicaRef(),
    state: "ready",
  }));

  await landingLoad;
  await waitForText(rendered.container, "empty:none");

  assert.equal(mocks.publishBrowserVaultSessionInvalidation.mock.calls.length, 1);
  assert.equal(getBrowserVaultReadySnapshot(), null);
  assert.equal(rendered.container.textContent?.startsWith("ready:"), false);

  await rendered.cleanup();
});

test("a dispatched logout clears cached and live data before an ambiguous request failure settles", async () => {
  const ref = createReplicaRef();
  const logoutResponse = createDeferred<Response>();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }))
    .mockImplementationOnce(() => logoutResponse.promise);

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, `ready:${ref.dataVersion}`);
  assert.ok(getBrowserVaultReadySnapshot());

  let logoutPromise!: Promise<void>;
  act(() => {
    logoutPromise = logoutHostedAppSession();
  });

  await waitForText(rendered.container, "empty:none");
  assert.equal(getBrowserVaultReadySnapshot(), null);
  assert.equal(mocks.publishBrowserVaultSessionEnding.mock.calls.length, 1);
  assert.equal(mocks.publishBrowserVaultSessionInvalidation.mock.calls.length, 0);

  await act(async () => {
    rendered.window.dispatchEvent(new rendered.window.Event("focus"));
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
  });
  mocks.usePathname.mockReturnValue("/history");
  await rendered.rerender(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
  );
  for (let flush = 0; flush < 4; flush += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }

  assert.equal(fetchMock.mock.calls.length, 2);
  assert.equal(rendered.container.textContent, "empty:none");
  assert.equal(getBrowserVaultReadySnapshot(), null);

  logoutResponse.reject(new TypeError("network unavailable"));
  await act(async () => {
    await assert.rejects(logoutPromise, /network unavailable/u);
  });

  assert.equal(fetchMock.mock.calls.length, 2);
  assert.equal(mocks.publishBrowserVaultSessionInvalidation.mock.calls.length, 0);
  assert.equal(mocks.sessionInvalidation.ending, true);
  assert.equal(mocks.reloadCurrentHostedAuthDocument.mock.calls.length, 1);
  assert.equal(rendered.container.textContent, "empty:none");

  await act(async () => {
    rendered.window.dispatchEvent(new rendered.window.Event("focus"));
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
  });
  mocks.usePathname.mockReturnValue("/overview");
  await rendered.rerender(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
  );
  assert.equal(fetchMock.mock.calls.length, 2);
  assert.equal(getBrowserVaultReadySnapshot(), null);

  await rendered.cleanup();
});

test("malformed completion JSON after replacement headers clears the cached and live member A client", async () => {
  const ref = createReplicaRef();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }))
    .mockResolvedValueOnce(new Response("{", { status: 200 }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, `ready:${ref.dataVersion}`);
  assert.ok(getBrowserVaultReadySnapshot());

  await act(async () => {
    await assert.rejects(
      requestHostedPrivyCompletionWithRetry({ authMethod: "email" }),
      /unexpected response/u,
    );
  });

  assert.equal(mocks.publishBrowserVaultSessionInvalidation.mock.calls.length, 1);
  assert.equal(mocks.reloadCurrentHostedAuthDocument.mock.calls.length, 1);
  assert.equal(rendered.container.textContent, "empty:none");
  assert.equal(getBrowserVaultReadySnapshot(), null);

  await rendered.cleanup();
});

test("a completion body-read failure after replacement headers clears the cached and live member A client", async () => {
  const ref = createReplicaRef();
  const completionResponse = new Response(JSON.stringify({ ok: true }), {
    status: 200,
  });
  vi.spyOn(completionResponse, "text").mockRejectedValueOnce(
    new Error("response body unavailable"),
  );
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }))
    .mockResolvedValueOnce(completionResponse);

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, `ready:${ref.dataVersion}`);
  assert.ok(getBrowserVaultReadySnapshot());

  await act(async () => {
    await assert.rejects(
      requestHostedPrivyCompletionWithRetry({ authMethod: "email" }),
      /response body unavailable/u,
    );
  });

  assert.equal(mocks.publishBrowserVaultSessionInvalidation.mock.calls.length, 1);
  assert.equal(mocks.reloadCurrentHostedAuthDocument.mock.calls.length, 1);
  assert.equal(rendered.container.textContent, "empty:none");
  assert.equal(getBrowserVaultReadySnapshot(), null);

  await rendered.cleanup();
});

test("a nonreplacement completion failure preserves the cached and live member A client", async () => {
  const ref = createReplicaRef();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }))
    .mockResolvedValueOnce(new Response("{", { status: 503 }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, `ready:${ref.dataVersion}`);
  const cachedSnapshot = getBrowserVaultReadySnapshot();
  assert.ok(cachedSnapshot);

  await act(async () => {
    await assert.rejects(
      requestHostedPrivyCompletionWithRetry({ authMethod: "email" }),
      /Something went wrong/u,
    );
  });

  assert.equal(mocks.publishBrowserVaultSessionInvalidation.mock.calls.length, 0);
  assert.equal(mocks.reloadCurrentHostedAuthDocument.mock.calls.length, 0);
  assert.equal(rendered.container.textContent, `ready:${ref.dataVersion}`);
  assert.equal(getBrowserVaultReadySnapshot(), cachedSnapshot);

  await rendered.cleanup();
});

test("browser-vault provider reuses an in-flight load for repeated refreshes", async () => {
  const response = createDeferred<Response>();
  const fetchMock = vi.fn(() => response.promise);

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForCondition(() => fetchMock.mock.calls.length === 1, "initial browser-vault fetch");

  await act(async () => {
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
  });

  assert.equal(fetchMock.mock.calls.length, 1);

  response.resolve(jsonResponse({
    encryptedReplica: createReplicaEnvelope(),
    replicaAad: createReplicaAad(),
    replicaKeyEnvelope: createReplicaKeyEnvelope(),
    replicaRef: createReplicaRef(),
    state: "ready",
  }));

  await waitForText(rendered.container, "ready");
  assert.equal(fetchMock.mock.calls.length, 1);

  await rendered.cleanup();
});

test("browser-vault selector returns projected data only after the client is ready", async () => {
  const response = createDeferred<Response>();
  const fetchMock = vi.fn(() => response.promise);
  const dataVersion = createReplicaRef().dataVersion;

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultSelectorProbe)),
    { requireButton: false },
  );

  assert.equal(rendered.container.textContent, "loading:none");

  response.resolve(jsonResponse({
    encryptedReplica: createReplicaEnvelope(),
    replicaAad: createReplicaAad(),
    replicaKeyEnvelope: createReplicaKeyEnvelope(),
    replicaRef: createReplicaRef(),
    state: "ready",
  }));

  await waitForText(rendered.container, `ready:${dataVersion}`);

  await rendered.cleanup();
});

test("browser-vault provider aborts in-flight loads on unmount", async () => {
  const response = createDeferred<Response>();
  const requestSignals: AbortSignal[] = [];
  const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal) {
      requestSignals.push(init.signal);
    }
    return response.promise;
  });

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForCondition(() => fetchMock.mock.calls.length === 1, "initial browser-vault fetch");

  await rendered.cleanup();

  const requestSignal = requestSignals.at(0);
  assert.ok(requestSignal);
  assert.equal(requestSignal.aborted, true);

  response.resolve(jsonResponse({
    encryptedReplica: createReplicaEnvelope(),
    replicaAad: createReplicaAad(),
    replicaKeyEnvelope: createReplicaKeyEnvelope(),
    replicaRef: createReplicaRef(),
    state: "ready",
  }));

  await act(async () => {
    await response.promise;
  });
});

test("browser-vault provider hides a warmed snapshot until fresh authority revalidates its known ref", async () => {
  const ref = createReplicaRef();
  const authorityResponse = createDeferred<Response>();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }))
    .mockImplementationOnce(() => authorityResponse.promise);

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  await startBrowserVaultWarmLoad();
  assert.ok(getBrowserVaultReadySnapshot());

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  assert.equal(rendered.container.textContent, "loading:none");
  assert.equal(rendered.container.textContent?.includes(ref.dataVersion), false);

  await waitForCondition(() => fetchMock.mock.calls.length === 2, "background revalidation");
  const revalidateRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
  assert.deepEqual(revalidateRequest.knownReplicaRef, ref);
  authorityResponse.resolve(jsonResponse({
    encryptedReplica: null,
    memberId: "member_123",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: ref,
    state: "not_modified",
  }));
  await waitForText(rendered.container, `ready:${ref.dataVersion}`);

  await rendered.cleanup();
});

test("cached UI authority cannot unlock a warm snapshot before current denial", async () => {
  const ref = createReplicaRef();
  const authorityResponse = createDeferred<Response>();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }))
    .mockImplementationOnce(() => authorityResponse.promise);

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  await startBrowserVaultWarmLoad();
  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  assert.equal(rendered.container.textContent, "loading:none");
  assert.equal(rendered.container.textContent?.includes(ref.dataVersion), false);

  authorityResponse.resolve(new Response(JSON.stringify({
    error: {
      message: "Restore account access to continue.",
    },
  }), { status: 403 }));

  await waitForText(
    rendered.container,
    "error:Your dashboard session expired. Refresh and try again.",
  );
  assert.equal(rendered.container.textContent?.includes(ref.dataVersion), false);
  assert.equal(getBrowserVaultReadySnapshot(), null);
  assert.equal(mocks.navigateHostedAuthRedirect.mock.calls.length, 0);

  await rendered.cleanup();
});

test("browser-vault provider replaces an in-flight landing request with post-mount authority", async () => {
  const landingResponse = createDeferred<Response>();
  const providerResponse = createDeferred<Response>();
  const fetchMock = vi.fn()
    .mockImplementationOnce(() => landingResponse.promise)
    .mockImplementationOnce(() => providerResponse.promise);

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  void startBrowserVaultWarmLoad();
  await waitForCondition(() => fetchMock.mock.calls.length === 1, "landing warm fetch");
  assert.ok(peekBrowserVaultInFlightLoad());

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForCondition(() => fetchMock.mock.calls.length === 2, "post-mount authority fetch");
  assert.equal(rendered.container.textContent, "loading:none");

  providerResponse.resolve(jsonResponse({
    encryptedReplica: createReplicaEnvelope(),
    replicaAad: createReplicaAad(),
    replicaKeyEnvelope: createReplicaKeyEnvelope(),
    replicaRef: createReplicaRef(),
    state: "ready",
  }));

  await waitForText(rendered.container, "ready");
  assert.equal(fetchMock.mock.calls.length, 2);

  landingResponse.resolve(jsonResponse({
    encryptedReplica: createReplicaEnvelope(),
    replicaAad: createReplicaAad(),
    replicaKeyEnvelope: createReplicaKeyEnvelope(),
    replicaRef: createReplicaRef(),
    state: "ready",
  }));

  await rendered.cleanup();
});

test("browser-vault provider keeps ready stale data when a background revalidation fails", async () => {
  const ref = createReplicaRef();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }))
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: null,
      memberId: "member_123",
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: ref,
      state: "not_modified",
    }))
    .mockResolvedValueOnce({
      json: async () => ({ error: "Temporary failure" }),
      ok: false,
      status: 500,
    } as Response);

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  await startBrowserVaultWarmLoad();

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, `ready:${ref.dataVersion}`);
  await act(async () => {
    rendered.window.dispatchEvent(new rendered.window.Event("focus"));
  });
  await waitForCondition(() => fetchMock.mock.calls.length === 3, "background revalidation");
  // Let the failed revalidation settle so a mistaken error flip would surface.
  for (let flush = 0; flush < 6; flush += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  // Stale ready data is retained after its post-mount authority check passed.
  assert.equal(rendered.container.textContent, `ready:${ref.dataVersion}`);

  await rendered.cleanup();
});

test("browser-vault provider clears the client when a background revalidation returns empty", async () => {
  const ref = createReplicaRef();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }))
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: null,
      memberId: "member_123",
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: ref,
      state: "not_modified",
    }))
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: null,
      freshness: "stale",
      memberId: "member_123",
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: null,
      refreshPending: false,
      state: "empty",
      workspaceVersion: null,
    }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  await startBrowserVaultWarmLoad();

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, `ready:${ref.dataVersion}`);
  await act(async () => {
    rendered.window.dispatchEvent(new rendered.window.Event("focus"));
  });
  await waitForText(rendered.container, "empty:none");
  assert.equal(getBrowserVaultReadySnapshot(), null);

  await rendered.cleanup();
});

test("clearing warm state blocks an older in-flight request from repopulating the snapshot", async () => {
  const response = createDeferred<Response>();
  const fetchMock = vi.fn(() => response.promise);

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const loadPromise = startBrowserVaultWarmLoad();
  await waitForCondition(() => fetchMock.mock.calls.length === 1, "warm fetch");

  clearBrowserVaultWarmState();

  response.resolve(jsonResponse({
    encryptedReplica: createReplicaEnvelope(),
    replicaAad: createReplicaAad(),
    replicaKeyEnvelope: createReplicaKeyEnvelope(),
    replicaRef: createReplicaRef(),
    state: "ready",
  }));

  const outcome = await loadPromise;
  assert.equal(outcome.status, "superseded");
  assert.equal(getBrowserVaultReadySnapshot(), null);
});

test("aborting an older load cannot clobber a newer in-flight load", async () => {
  const firstResponse = createDeferred<Response>();
  const secondResponse = createDeferred<Response>();
  const fetchMock = vi.fn()
    .mockImplementationOnce(() => firstResponse.promise)
    .mockImplementationOnce(() => secondResponse.promise);

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const firstLoad = startBrowserVaultWarmLoad();
  await waitForCondition(() => fetchMock.mock.calls.length === 1, "first warm fetch");

  abortBrowserVaultInFlightLoad();

  const secondLoad = startBrowserVaultWarmLoad();
  await waitForCondition(() => fetchMock.mock.calls.length === 2, "second warm fetch");

  firstResponse.resolve(jsonResponse({
    encryptedReplica: createReplicaEnvelope(),
    replicaAad: createReplicaAad(),
    replicaKeyEnvelope: createReplicaKeyEnvelope(),
    replicaRef: createReplicaRef(),
    state: "ready",
  }));

  await firstLoad;
  assert.equal(peekBrowserVaultInFlightLoad(), secondLoad);

  secondResponse.resolve(jsonResponse({
    encryptedReplica: createReplicaEnvelope(),
    replicaAad: createReplicaAad(),
    replicaKeyEnvelope: createReplicaKeyEnvelope(),
    replicaRef: createReplicaRef(),
    state: "ready",
  }));

  const secondOutcome = await secondLoad;
  assert.equal(secondOutcome.status, "ready");
});

function createAuthenticatedBrowserVaultElement(child: ReactNode) {
  return (
    <AuthProvider authenticated>
      <BrowserVaultProvider initialMemberId="member_123">
        {child}
      </BrowserVaultProvider>
    </AuthProvider>
  );
}

function BrowserVaultStatusProbe({ onClick }: { onClick?: () => void }) {
  const vault = useBrowserVault();

  return createElement(
    "button",
    { onClick: onClick ?? (() => void vault.refresh()) },
    `${vault.status}:${vault.error ?? vault.dataVersion ?? "none"}`,
  );
}

function BrowserVaultSelectorProbe() {
  const vault = useBrowserVault();
  const dataVersion = useBrowserVaultSelector((client) => client.replica.source.dataVersion);

  return createElement(
    "button",
    { onClick: () => void vault.refresh() },
    `${vault.status}:${dataVersion ?? "none"}`,
  );
}

function BrowserVaultImportProbe() {
  const vault = useBrowserVault();

  return createElement(
    "button",
    { onClick: () => void vault.refresh() },
    `${vault.status}:${vault.deviceSyncImportPending ? "importing" : "idle"}`,
  );
}

function PublicDashboardRouteProbe() {
  const vault = useBrowserVault();

  return createElement(
    "div",
    null,
    `public:${vault.status}:${vault.dataVersion ?? "none"}`,
  );
}

function installBrowserVaultCryptoMocks(): void {
  mocks.generateHostedUserRecipientKeyPair.mockResolvedValue({
    privateKeyJwk: { kty: "EC" },
    publicKeyJwk: { kty: "EC" },
  });
  mocks.unwrapHostedBrowserSessionKey.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mocks.decryptHostedStoragePayload.mockResolvedValue(
    new TextEncoder().encode(JSON.stringify(createReplica())),
  );
}

async function waitForText(container: HTMLElement, text: string): Promise<void> {
  await waitForCondition(
    () => Boolean(container.textContent?.includes(text)),
    `text: ${text}`,
  );
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

function jsonResponse(value: unknown): Response {
  return {
    json: async () => value,
    ok: true,
    status: 200,
  } as Response;
}

function createDeferred<T>() {
  let reject: (reason?: unknown) => void = () => {};
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });

  return { promise, reject, resolve };
}

function createReplicaRef() {
  return {
    byteLength: 128,
    dataVersion: "d".repeat(64),
    generatedAt: "2026-04-20T08:00:00.000Z",
    keyId: "browser-vault-replica:d",
    objectKey: "users/browser-vault-replicas/opaque/replica.json",
    replicaSchema: "murph.browser-vault-replica" as const,
    runtimeRootKeyId: "udrk:runtime:test-root",
    schema: "murph.hosted-browser-vault-replica-ref.v1" as const,
    sourceBundleHash: "a".repeat(64),
  };
}

function createReplicaAad(memberId = "member_123") {
  return {
    dataVersion: "d".repeat(64),
    objectKey: "users/browser-vault-replicas/opaque/replica.json",
    purpose: "browser-vault-replica" as const,
    runtimeRootKeyId: "udrk:runtime:test-root",
    schema: "murph.browser-vault-replica" as const,
    sourceBundleHash: "a".repeat(64),
    userId: memberId,
  };
}

function createReplicaEnvelope() {
  return {
    algorithm: "AES-GCM" as const,
    ciphertext: "ciphertext",
    iv: "iv",
    keyId: "browser-vault-replica:d",
    schema: "murph.hosted-cipher.v1",
    scope: "browser-vault-replica" as const,
  };
}

function createReplicaKeyEnvelope(memberId = "member_123") {
  return {
    createdAt: "2026-04-20T08:00:00.000Z",
    keyId: "browser-vault-replica:d",
    purpose: "browser-vault-replica" as const,
    recipients: [
      {
        ciphertext: "ciphertext",
        ephemeralPublicKeyJwk: {
          crv: "P-256",
          kty: "EC",
          x: "ephemeral-x",
          y: "ephemeral-y",
        },
        iv: "iv",
        keyId: "browser-vault-replica:d",
        kind: "browser-session" as const,
      },
    ],
    schema: "murph.hosted-browser-session-key-envelope.v1" as const,
    userId: memberId,
  };
}

function createReplica(overrides: Partial<BrowserVaultReplica> = {}): BrowserVaultReplica {
  return {
    assistantSummary: {
      highlights: [],
      latestDate: null,
    },
    entities: [],
    generatedAt: "2026-04-30T12:00:00.000Z",
    metricGoalProgressRows: [],
    metricRows: [],
    metricSelectionRows: [],
    policy: {
      bodyPreviewChars: 280,
      excludedFamilies: [],
      id: BROWSER_VAULT_REPLICA_POLICY_ID,
      includedFamilies: [],
      metricLookbackDays: 365,
    },
    schema: BROWSER_VAULT_REPLICA_SCHEMA,
    searchRows: [],
    source: {
      dataVersion: "d".repeat(64),
      sourceBundleHash: "a".repeat(64),
    },
    sourceHealthRows: [],
    timelineRows: [],
    weeklySampleSummaries: [],
    ...overrides,
  };
}
