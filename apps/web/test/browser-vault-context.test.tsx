import assert from "node:assert/strict";

import {
  BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  type BrowserVaultReplica,
} from "@murphai/query/browser";
import type { HostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/browser-vault";
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
        | "same-document-expired"
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
  BROWSER_VAULT_SESSION_ENDING_LEASE_MS: 30_000,
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

test("browser-vault provider rejects decrypted replica generations that do not match the ref", async () => {
  const ref = createReplicaRef();
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
    encryptedReplica: createReplicaEnvelope(),
    replicaAad: createReplicaAad(),
    replicaKeyEnvelope: createReplicaKeyEnvelope(),
    replicaRef: ref,
    state: "ready",
  }));

  installBrowserVaultCryptoMocks();
  mocks.decryptHostedStoragePayload.mockResolvedValue(
    new TextEncoder().encode(JSON.stringify(createReplica({
      generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION + 1,
    }))),
  );
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, "error");
  assert.equal(
    rendered.container.textContent?.includes("Your dashboard data is not available right now."),
    true,
  );

  await rendered.cleanup();
});

test("browser-vault loader restores a current payload generation omitted by an old Worker", async () => {
  const ref = createReplicaRef();
  const legacyEchoRef: Record<string, unknown> = { ...ref };
  delete legacyEchoRef.generation;
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
    encryptedReplica: createReplicaEnvelope(),
    freshness: "stale",
    replicaAad: createReplicaAad(),
    replicaKeyEnvelope: createReplicaKeyEnvelope(),
    replicaRef: legacyEchoRef,
    refreshPending: true,
    state: "ready",
  }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const outcome = await startBrowserVaultWarmLoad();

  assert.equal(outcome.status, "ready");
  assert.equal(getBrowserVaultReadySnapshot()?.ref.generation, ref.generation);
  assert.equal(getBrowserVaultReadySnapshot()?.metadata.freshness, "stale");
  assert.equal(getBrowserVaultReadySnapshot()?.metadata.refreshPending, true);
});

test("browser-vault loader retains a known generation omitted by an old Web echo", async () => {
  const ref = createReplicaRef();
  const legacyEchoRef: Record<string, unknown> = { ...ref };
  delete legacyEchoRef.generation;
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
      replicaRef: legacyEchoRef,
      state: "not_modified",
    }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const firstOutcome = await startBrowserVaultWarmLoad();
  const firstClient = getBrowserVaultReadySnapshot()?.client;
  const secondOutcome = await startBrowserVaultWarmLoad();

  assert.equal(firstOutcome.status, "ready");
  assert.equal(secondOutcome.status, "ready");
  assert.equal(getBrowserVaultReadySnapshot()?.client, firstClient);
  assert.deepEqual(getBrowserVaultReadySnapshot()?.ref, ref);
});

test("browser-vault provider keeps matching legacy replicas readable while refresh is pending", async () => {
  const legacyRef: Record<string, unknown> = { ...createReplicaRef() };
  delete legacyRef.generation;
  const legacyReplica: Record<string, unknown> = { ...createReplica() };
  delete legacyReplica.generation;
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
    encryptedReplica: createReplicaEnvelope(),
    freshness: "stale",
    replicaAad: createReplicaAad(),
    replicaKeyEnvelope: createReplicaKeyEnvelope(),
    replicaRef: legacyRef,
    refreshPending: true,
    state: "ready",
  }));

  installBrowserVaultCryptoMocks();
  mocks.decryptHostedStoragePayload.mockResolvedValue(
    new TextEncoder().encode(JSON.stringify(legacyReplica)),
  );
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, `ready:${"d".repeat(64)}`);
  const snapshot = getBrowserVaultReadySnapshot();
  assert.equal(snapshot?.metadata.freshness, "stale");
  assert.equal(snapshot?.metadata.refreshPending, true);
  assert.equal(snapshot?.ref.generation, undefined);

  await rendered.cleanup();
});

test("consent-blocked browser-vault provider clears warm data without requesting a session", async () => {
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

  await startBrowserVaultWarmLoad();
  assert.ok(getBrowserVaultReadySnapshot());

  const rendered = await renderClientComponent(
    <BrowserVaultProvider initialMemberId="member_123" loadEnabled={false}>
      <BrowserVaultStatusProbe />
    </BrowserVaultProvider>,
    { requireButton: false },
  );

  assert.equal(rendered.container.textContent, "empty:none");
  assert.equal(getBrowserVaultReadySnapshot(), null);
  assert.equal(fetchMock.mock.calls.length, 1);

  await act(async () => {
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
  });
  assert.equal(fetchMock.mock.calls.length, 1);

  await rendered.cleanup();
});

test("disabling the browser-vault provider cannot restart an adopted warm request", async () => {
  const requestSignals: AbortSignal[] = [];
  const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        return;
      }

      requestSignals.push(signal);
      signal.addEventListener("abort", () => {
        const abortError = new Error("Browser vault request aborted.");
        abortError.name = "AbortError";
        reject(abortError);
      }, { once: true });
    });
  });

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const landingLoad = startBrowserVaultWarmLoad();
  await waitForCondition(() => fetchMock.mock.calls.length === 1, "landing warm fetch");

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
    { requireButton: false },
  );

  await rendered.rerenderInTransition(
    <AuthProvider authenticated>
      <BrowserVaultProvider initialMemberId="member_123" loadEnabled={false}>
        <BrowserVaultStatusProbe />
      </BrowserVaultProvider>
    </AuthProvider>,
  );

  assert.equal((await landingLoad).status, "superseded");
  for (let flush = 0; flush < 4; flush += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }

  assert.equal(rendered.container.textContent, "empty:none");
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(requestSignals[0]?.aborted, true);
  assert.equal(getBrowserVaultReadySnapshot(), null);

  await rendered.cleanup();
});

test("reenabling the browser-vault provider starts behind fresh authority", async () => {
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
    <AuthProvider authenticated>
      <BrowserVaultProvider initialMemberId="member_123" loadEnabled={false}>
        <BrowserVaultStatusProbe />
      </BrowserVaultProvider>
    </AuthProvider>,
    { requireButton: false },
  );

  assert.equal(rendered.container.textContent, "empty:none");
  assert.equal(fetchMock.mock.calls.length, 0);

  await rendered.rerender(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultStatusProbe)),
  );
  await waitForText(rendered.container, `ready:${ref.dataVersion}`);

  assert.equal(fetchMock.mock.calls.length, 1);
  assert.ok(getBrowserVaultReadySnapshot());

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

test("browser-vault provider adopts a refreshed Patterns replica after the fast polling window", async () => {
  vi.useFakeTimers();
  const legacyRef = createReplicaRef({
    generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION - 1,
  });
  const currentRef = createReplicaRef({
    dataVersion: "e".repeat(64),
    keyId: "browser-vault-replica:e",
  });
  let currentReplicaPublished = false;
  const fetchMock = vi.fn(() => {
    if (fetchMock.mock.calls.length === 1) {
      return Promise.resolve(jsonResponse({
        encryptedReplica: createReplicaEnvelope(),
        freshness: "stale",
        replicaAad: createReplicaAad(),
        replicaKeyEnvelope: createReplicaKeyEnvelope(),
        replicaRef: legacyRef,
        refreshPending: true,
        state: "ready",
      }));
    }

    if (!currentReplicaPublished) {
      return Promise.resolve(jsonResponse({
        encryptedReplica: null,
        freshness: "stale",
        memberId: "member_123",
        replicaAad: null,
        replicaKeyEnvelope: null,
        replicaRef: legacyRef,
        refreshPending: true,
        state: "not_modified",
      }));
    }

    return Promise.resolve(jsonResponse({
      encryptedReplica: createReplicaEnvelope("e"),
      freshness: "fresh",
      replicaAad: createReplicaAad("member_123", "e"),
      replicaKeyEnvelope: createReplicaKeyEnvelope("member_123", "e"),
      replicaRef: currentRef,
      refreshPending: false,
      state: "ready",
    }));
  });

  installBrowserVaultCryptoMocks();
  const legacyReplica = createReplica({
    generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION - 1,
  });
  delete legacyReplica.personalPatterns;
  mocks.decryptHostedStoragePayload
    .mockResolvedValueOnce(new TextEncoder().encode(JSON.stringify(legacyReplica)))
    .mockResolvedValueOnce(new TextEncoder().encode(JSON.stringify(createReplica({
      personalPatterns: {
        asOfDate: "2026-04-30",
        cells: [],
        factors: [],
        lagDays: 1,
        notes: [],
        outcomes: [],
        repeatableCellCount: 0,
        testedCellCount: 0,
        windowDays: 120,
      },
      source: {
        dataVersion: currentRef.dataVersion,
        sourceBundleHash: currentRef.sourceBundleHash,
      },
    }))));
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(createElement(BrowserVaultPatternsProbe)),
    { requireButton: false },
  );

  await waitForText(rendered.container, "legacy:pending");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(25_000);
  });
  assert.equal(rendered.container.textContent, "legacy:pending");

  currentReplicaPublished = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  await waitForText(rendered.container, "patterns:ready");
  assert.equal(fetchMock.mock.calls.length > 2, true);

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

test("persistent provider gates a new route when authority revalidation fails", async () => {
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
  assert.equal(rendered.container.textContent, "loading:none");

  revalidationResponse.resolve(new Response(JSON.stringify({
    error: { message: "Temporary failure" },
  }), { status: 500 }));
  await waitForText(
    rendered.container,
    "error:Your dashboard data is not available right now.",
  );
  assert.equal(getBrowserVaultReadySnapshot()?.client, admittedClient);

  await rendered.cleanup();
});

test("matching route authority republishes the same decrypted client without another unwrap", async () => {
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
  assert.equal(rendered.container.textContent, "loading:none");

  revalidationResponse.resolve(jsonResponse({
    encryptedReplica: null,
    memberId: "member_123",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: ref,
    state: "not_modified",
  }));

  await waitForText(rendered.container, `ready:${ref.dataVersion}`);
  assert.equal(getBrowserVaultReadySnapshot()?.client, admittedClient);
  assert.equal(mocks.unwrapHostedBrowserSessionKey.mock.calls.length, 1);

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

test("browser-vault provider keeps admitted content visible during focus revalidation", async () => {
  const ref = createReplicaRef();
  const focusResponse = createDeferred<Response>();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }))
    .mockImplementationOnce(() => focusResponse.promise);

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
  await waitForCondition(
    () => fetchMock.mock.calls.length === 2,
    "focus browser-vault revalidation",
  );

  assert.equal(rendered.container.textContent, `ready:${ref.dataVersion}`);

  focusResponse.resolve(jsonResponse({
    encryptedReplica: null,
    memberId: "member_123",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: ref,
    state: "not_modified",
  }));

  await waitForText(rendered.container, `ready:${ref.dataVersion}`);
  assert.equal(mocks.unwrapHostedBrowserSessionKey.mock.calls.length, 1);

  await rendered.cleanup();
});

test("a runtime refresh request survives an in-flight focus read and waits through a nonmatching replica", async () => {
  vi.useFakeTimers();
  const currentRef = createReplicaRef();
  const unrelatedRef = createReplicaRef({
    dataVersion: "e".repeat(64),
    keyId: "browser-vault-replica:e",
    objectKey: "users/browser-vault-replicas/opaque/unrelated.json",
    sourceBundleHash: "b".repeat(64),
  });
  const replacementRef = {
    ...currentRef,
    dataVersion: "f".repeat(64),
    keyId: "browser-vault-replica:f",
    objectKey: "users/browser-vault-replicas/opaque/replacement.json",
    sourceBundleHash: "c".repeat(64),
  };
  let pendingPollCount = 0;
  const focusResponse = createDeferred<Response>();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: currentRef,
      state: "ready",
    }))
    .mockImplementationOnce(() => focusResponse.promise)
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: null,
      memberId: "member_123",
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: currentRef,
      refreshPending: true,
      state: "not_modified",
    }))
    .mockImplementation(() => {
      pendingPollCount += 1;
      if (pendingPollCount <= 2) {
        return Promise.resolve(jsonResponse({
          encryptedReplica: null,
          memberId: "member_123",
          replicaAad: null,
          replicaKeyEnvelope: null,
          replicaRef: currentRef,
          state: "not_modified",
        }));
      }
      if (pendingPollCount === 3) {
        return Promise.resolve(jsonResponse({
          encryptedReplica: createReplicaEnvelope("e"),
          replicaAad: createReplicaAad("member_123", "e", {
            objectKey: unrelatedRef.objectKey,
            sourceBundleHash: unrelatedRef.sourceBundleHash,
          }),
          replicaKeyEnvelope: createReplicaKeyEnvelope("member_123", "e"),
          replicaRef: unrelatedRef,
          state: "ready",
        }));
      }
      if (pendingPollCount <= 5) {
        return Promise.resolve(jsonResponse({
          encryptedReplica: null,
          memberId: "member_123",
          replicaAad: null,
          replicaKeyEnvelope: null,
          replicaRef: unrelatedRef,
          state: "not_modified",
        }));
      }
      return Promise.resolve(jsonResponse({
        encryptedReplica: createReplicaEnvelope("f"),
        replicaAad: createReplicaAad("member_123", "f", {
          objectKey: replacementRef.objectKey,
          sourceBundleHash: replacementRef.sourceBundleHash,
        }),
        replicaKeyEnvelope: createReplicaKeyEnvelope("member_123", "f"),
        replicaRef: replacementRef,
        state: "ready",
      }));
    });

  installBrowserVaultCryptoMocks();
  mocks.decryptHostedStoragePayload
    .mockReset()
    .mockResolvedValueOnce(new TextEncoder().encode(JSON.stringify(createReplica())))
    .mockResolvedValueOnce(new TextEncoder().encode(JSON.stringify(createReplica({
      source: {
        dataVersion: unrelatedRef.dataVersion,
        sourceBundleHash: unrelatedRef.sourceBundleHash,
      },
    }))))
    .mockResolvedValueOnce(new TextEncoder().encode(JSON.stringify(createReplica({
      source: {
        dataVersion: replacementRef.dataVersion,
        sourceBundleHash: replacementRef.sourceBundleHash,
      },
    }))));
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(
      createElement(BrowserVaultRuntimeRefreshProbe),
    ),
    { requireButton: false },
  );

  await waitForText(
    rendered.container,
    `${currentRef.sourceBundleHash}:${currentRef.dataVersion}:ready`,
  );
  await act(async () => {
    rendered.window.dispatchEvent(new rendered.window.Event("focus"));
  });
  await waitForCondition(() => fetchMock.mock.calls.length === 2, "focus read");

  await act(async () => {
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
  });
  focusResponse.resolve(jsonResponse({
    encryptedReplica: null,
    memberId: "member_123",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: currentRef,
    state: "not_modified",
  }));
  await waitForCondition(
    () => fetchMock.mock.calls.length === 3,
    "runtime refresh request",
  );

  const focusBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
  const refreshBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
  assert.equal(focusBody.requestRefresh, undefined);
  assert.equal(refreshBody.requestRefresh, true);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  await waitForText(
    rendered.container,
    `${unrelatedRef.sourceBundleHash}:${unrelatedRef.dataVersion}:pending`,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  await waitForText(
    rendered.container,
    `${replacementRef.sourceBundleHash}:${replacementRef.dataVersion}:ready`,
  );
  for (const [, init] of fetchMock.mock.calls.slice(3)) {
    const pollBody = JSON.parse(String(init?.body));
    assert.equal(pollBody.requestRefresh, undefined);
  }
  assert.equal(fetchMock.mock.calls.length, 9);

  await rendered.cleanup();
});

test("a runtime refresh wait ends after its in-memory deadline", async () => {
  vi.useFakeTimers();
  const currentRef = createReplicaRef();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: currentRef,
      state: "ready",
    }))
    .mockResolvedValue(jsonResponse({
      encryptedReplica: null,
      memberId: "member_123",
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: currentRef,
      state: "not_modified",
    }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(
      createElement(BrowserVaultRuntimeRefreshProbe),
    ),
    { requireButton: false },
  );

  await waitForText(
    rendered.container,
    `${currentRef.sourceBundleHash}:${currentRef.dataVersion}:ready`,
  );
  await act(async () => {
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
  });
  await waitForText(
    rendered.container,
    `${currentRef.sourceBundleHash}:${currentRef.dataVersion}:pending`,
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_001);
  });
  await waitForText(
    rendered.container,
    `${currentRef.sourceBundleHash}:${currentRef.dataVersion}:ready`,
  );
  const fetchCountAtDeadline = fetchMock.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  assert.equal(fetchMock.mock.calls.length, fetchCountAtDeadline);

  await rendered.cleanup();
});

test("a stalled runtime refresh is aborted and retired at the shared deadline", async () => {
  vi.useFakeTimers();
  const currentRef = createReplicaRef();
  const stalledResponse = createDeferred<Response>();
  const stalledSignals: AbortSignal[] = [];
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: currentRef,
      state: "ready",
    }))
    .mockImplementationOnce((_input: unknown, init?: RequestInit) => {
      if (init?.signal) {
        stalledSignals.push(init.signal);
      }
      return stalledResponse.promise;
    })
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: null,
      memberId: "member_123",
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: currentRef,
      state: "not_modified",
    }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(
      createElement(BrowserVaultRuntimeRefreshProbe),
    ),
    { requireButton: false },
  );

  await waitForText(
    rendered.container,
    `${currentRef.sourceBundleHash}:${currentRef.dataVersion}:ready`,
  );
  await act(async () => {
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
  });
  await waitForCondition(
    () => fetchMock.mock.calls.length === 2,
    "stalled runtime refresh",
  );
  await waitForText(
    rendered.container,
    `${currentRef.sourceBundleHash}:${currentRef.dataVersion}:pending`,
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_001);
  });
  await waitForCondition(
    () => peekBrowserVaultInFlightLoad() === null,
    "retired runtime refresh slot",
  );
  await waitForText(
    rendered.container,
    `${currentRef.sourceBundleHash}:${currentRef.dataVersion}:ready`,
  );
  assert.equal(stalledSignals[0]?.aborted, true);
  assert.ok(getBrowserVaultReadySnapshot());

  const fetchCountAtDeadline = fetchMock.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  assert.equal(fetchMock.mock.calls.length, fetchCountAtDeadline);

  await act(async () => {
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
  });
  await waitForCondition(
    () => fetchMock.mock.calls.length === fetchCountAtDeadline + 1,
    "replacement runtime refresh",
  );
  const replacementBody = JSON.parse(
    String(fetchMock.mock.calls.at(-1)?.[1]?.body),
  );
  assert.equal(replacementBody.requestRefresh, true);

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
    .mockImplementationOnce(() => logoutResponse.promise)
    .mockResolvedValueOnce(jsonResponse({
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
  assert.equal(mocks.publishBrowserVaultSessionInvalidation.mock.calls.length, 1);
  assert.equal(mocks.sessionInvalidation.ending, false);
  assert.equal(mocks.reloadCurrentHostedAuthDocument.mock.calls.length, 1);
  assert.equal(rendered.container.textContent, "empty:none");

  await act(async () => {
    rendered.window.dispatchEvent(new rendered.window.Event("focus"));
  });
  await waitForText(rendered.container, `ready:${ref.dataVersion}`);
  assert.equal(fetchMock.mock.calls.length, 3);
  assert.ok(getBrowserVaultReadySnapshot());

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
  const ref = createReplicaRef();
  const initialResponse = createDeferred<Response>();
  const authorityResponse = createDeferred<Response>();
  const fetchMock = vi.fn()
    .mockImplementationOnce(() => initialResponse.promise)
    .mockImplementationOnce(() => authorityResponse.promise);

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

  initialResponse.resolve(jsonResponse({
    encryptedReplica: createReplicaEnvelope(),
    replicaAad: createReplicaAad(),
    replicaKeyEnvelope: createReplicaKeyEnvelope(),
    replicaRef: ref,
    state: "ready",
  }));

  await waitForCondition(() => fetchMock.mock.calls.length === 2, "shared authority refresh");
  const authorityRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
  assert.deepEqual(authorityRequest.knownReplicaRef, ref);

  authorityResponse.resolve(jsonResponse({
    encryptedReplica: null,
    memberId: "member_123",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: ref,
    state: "not_modified",
  }));

  await waitForText(rendered.container, `ready:${ref.dataVersion}`);
  assert.equal(fetchMock.mock.calls.length, 2);
  assert.equal(mocks.unwrapHostedBrowserSessionKey.mock.calls.length, 1);

  await rendered.cleanup();
});

test("a background refresh keeps the admitted vault visible while it checks for changes", async () => {
  const ref = createReplicaRef();
  const backgroundResponse = createDeferred<Response>();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }))
    .mockImplementationOnce(() => backgroundResponse.promise);

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(
      createElement(BrowserVaultBackgroundRefreshProbe),
    ),
    { requireButton: false },
  );

  await waitForText(rendered.container, `ready:${ref.dataVersion}`);
  await act(async () => {
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
  });
  await waitForCondition(
    () => fetchMock.mock.calls.length === 2,
    "background browser-vault refresh",
  );

  assert.equal(rendered.container.textContent, `ready:${ref.dataVersion}`);

  backgroundResponse.resolve(jsonResponse({
    encryptedReplica: null,
    memberId: "member_123",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: ref,
    state: "not_modified",
  }));

  await waitForText(rendered.container, `ready:${ref.dataVersion}`);
  assert.equal(mocks.unwrapHostedBrowserSessionKey.mock.calls.length, 1);

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

test("browser-vault provider reuses an in-flight landing request before post-mount authority", async () => {
  const ref = createReplicaRef();
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

  await act(async () => {
    await Promise.resolve();
  });
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(rendered.container.textContent, "loading:none");

  landingResponse.resolve(jsonResponse({
    encryptedReplica: createReplicaEnvelope(),
    replicaAad: createReplicaAad(),
    replicaKeyEnvelope: createReplicaKeyEnvelope(),
    replicaRef: ref,
    state: "ready",
  }));

  await waitForCondition(() => fetchMock.mock.calls.length === 2, "post-mount authority fetch");
  const authorityRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
  assert.deepEqual(authorityRequest.knownReplicaRef, ref);
  assert.equal(rendered.container.textContent, "loading:none");

  providerResponse.resolve(jsonResponse({
    encryptedReplica: null,
    memberId: "member_123",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: ref,
    state: "not_modified",
  }));

  await waitForText(rendered.container, `ready:${ref.dataVersion}`);
  assert.equal(fetchMock.mock.calls.length, 2);
  assert.equal(mocks.unwrapHostedBrowserSessionKey.mock.calls.length, 1);

  await rendered.cleanup();
});

test("browser-vault provider keeps ready stale data when a background revalidation fails", async () => {
  vi.useFakeTimers();
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
      freshness: "stale",
      memberId: "member_123",
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: ref,
      refreshPending: true,
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
    await vi.advanceTimersByTimeAsync(2_000);
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

function BrowserVaultBackgroundRefreshProbe() {
  const vault = useBrowserVault();

  return createElement(
    "button",
    { onClick: () => void vault.refresh({ background: true }) },
    `${vault.status}:${vault.dataVersion ?? "none"}`,
  );
}

function BrowserVaultRuntimeRefreshProbe() {
  const vault = useBrowserVault();

  return createElement(
    "button",
    {
      onClick: () => void vault.refresh({
        background: true,
        requestRuntimeRefreshUntil: (client) =>
          client.replica.source.dataVersion === "f".repeat(64),
      }),
    },
    `${vault.ref?.sourceBundleHash ?? "none"}:${vault.dataVersion ?? "none"}:${vault.runtimeRefreshPending ? "pending" : "ready"}`,
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

function BrowserVaultPatternsProbe() {
  const vault = useBrowserVault();
  const patternsAvailable = vault.client?.replica.personalPatterns !== undefined;

  return createElement(
    "div",
    null,
    `${patternsAvailable ? "patterns" : "legacy"}:${vault.refreshPending ? "pending" : "ready"}`,
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

function createReplicaRef(
  overrides: Partial<HostedBrowserVaultReplicaRef> = {},
): HostedBrowserVaultReplicaRef {
  return {
    ...createReplicaRefBase(),
    ...overrides,
  };
}

function createReplicaRefBase(): HostedBrowserVaultReplicaRef {
  return {
    byteLength: 128,
    dataVersion: "d".repeat(64),
    generatedAt: "2026-04-20T08:00:00.000Z",
    generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
    keyId: "browser-vault-replica:d",
    objectKey: "users/browser-vault-replicas/opaque/replica.json",
    replicaSchema: "murph.browser-vault-replica" as const,
    runtimeRootKeyId: "udrk:runtime:test-root",
    schema: "murph.hosted-browser-vault-replica-ref.v1" as const,
    sourceBundleHash: "a".repeat(64),
  };
}

function createReplicaAad(
  memberId = "member_123",
  version = "d",
  overrides: Partial<Pick<
    ReturnType<typeof createReplicaRef>,
    "objectKey" | "sourceBundleHash"
  >> = {},
) {
  return {
    dataVersion: version.repeat(64),
    objectKey: "users/browser-vault-replicas/opaque/replica.json",
    purpose: "browser-vault-replica" as const,
    runtimeRootKeyId: "udrk:runtime:test-root",
    schema: "murph.browser-vault-replica" as const,
    sourceBundleHash: "a".repeat(64),
    userId: memberId,
    ...overrides,
  };
}

function createReplicaEnvelope(version = "d") {
  return {
    algorithm: "AES-GCM" as const,
    ciphertext: "ciphertext",
    iv: "iv",
    keyId: `browser-vault-replica:${version}`,
    schema: "murph.hosted-cipher.v1",
    scope: "browser-vault-replica" as const,
  };
}

function createReplicaKeyEnvelope(memberId = "member_123", version = "d") {
  return {
    createdAt: "2026-04-20T08:00:00.000Z",
    keyId: `browser-vault-replica:${version}`,
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
        keyId: `browser-vault-replica:${version}`,
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
    generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
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
    labResultRows: overrides.labResultRows ?? [],
  };
}
