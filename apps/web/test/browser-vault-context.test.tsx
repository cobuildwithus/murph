import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";

import {
  BROWSER_VAULT_METRIC_BUCKET_IDS,
  BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  getBrowserVaultMetricBucketId,
  selectBrowserVaultExperimentResults,
  splitBrowserVaultReplica,
  type BrowserVaultExperimentRunCardLookup,
  type BrowserVaultMetricBucketId,
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
  isBrowserVaultMetricsCapable,
  useBrowserVault,
  useBrowserVaultExperimentMetricBucketDemand,
  useBrowserVaultMetricKeyDemand,
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
import EnvironmentPageClient from "../app/(dashboard)/environment/environment-page-client";
import { LabBiomarkerDetailClient } from "../app/(dashboard)/biomarkers/results/[metricKey]/lab-biomarker-detail-client";

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

test("browser-vault warm store navigates accumulated capabilities and resets on a new ref", async () => {
  const replica = createReplica();
  const ref = await createShardedReplicaRef(replica);
  const shardSet = await splitBrowserVaultReplica(replica);
  const replacementReplica = createReplica({
    generatedAt: "2026-05-01T12:00:00.000Z",
  });
  const replacementRef = await createShardedReplicaRef(replacementReplica);
  const replacementShardSet = await splitBrowserVaultReplica(replacementReplica);
  const coreBytes = new TextEncoder().encode(JSON.stringify(shardSet.core));
  const labsBytes = new TextEncoder().encode(JSON.stringify(shardSet.labs));
  const metricsBytes = new TextEncoder().encode(JSON.stringify(shardSet.metrics));
  const replacementCoreBytes = new TextEncoder().encode(
    JSON.stringify(replacementShardSet.core),
  );
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      shards: {
        core: createEncryptedShardResponse(ref, "core"),
      },
      state: "ready",
    }))
    .mockResolvedValueOnce(jsonResponse({
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      shards: {
        metricsIndex: createEncryptedShardResponse(ref, "metricsIndex"),
      },
      state: "ready",
    }))
    .mockResolvedValueOnce(jsonResponse({
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      shards: {
        labs: createEncryptedShardResponse(ref, "labs"),
      },
      state: "ready",
    }))
    .mockResolvedValueOnce(jsonResponse({
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      shards: {
        metricsIndex: createEncryptedShardResponse(ref, "metricsIndex"),
      },
      state: "ready",
    }))
    .mockResolvedValueOnce(jsonResponse({
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: replacementRef,
      shards: {
        core: createEncryptedShardResponse(replacementRef, "core"),
      },
      state: "ready",
    }));

  installBrowserVaultCryptoMocks();
  mocks.decryptHostedStoragePayload
    .mockResolvedValueOnce(gzipSync(coreBytes))
    .mockResolvedValueOnce(gzipSync(metricsBytes))
    .mockResolvedValueOnce(gzipSync(labsBytes))
    .mockResolvedValueOnce(gzipSync(metricsBytes))
    .mockResolvedValueOnce(gzipSync(replacementCoreBytes));
  vi.stubGlobal("fetch", fetchMock);

  const first = await startBrowserVaultWarmLoad({ requestedShards: ["core"] });
  assert.equal(first.status, "ready");
  assert.equal(getBrowserVaultReadySnapshot()?.client.capability, "core");
  assert.deepEqual(getBrowserVaultReadySnapshot()?.loadedShards, ["core"]);

  const second = await startBrowserVaultWarmLoad({
    requestedShards: ["core", "metricsIndex"],
  });
  assert.equal(second.status, "ready");
  assert.equal(getBrowserVaultReadySnapshot()?.client.capability, "core+metrics-partial");
  assert.deepEqual(getBrowserVaultReadySnapshot()?.loadedShards, ["core", "metricsIndex"]);

  const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
  assert.deepEqual(secondRequest.knownShards, ["core"]);
  assert.deepEqual(secondRequest.requestedShards, ["core", "metricsIndex"]);

  const third = await startBrowserVaultWarmLoad({
    requestedShards: ["core", "labs"],
  });
  assert.equal(third.status, "ready");
  assert.equal(getBrowserVaultReadySnapshot()?.client.capability, "core+labs");
  assert.deepEqual(
    getBrowserVaultReadySnapshot()?.loadedShards,
    ["core", "labs"],
  );
  const thirdRequest = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
  assert.deepEqual(thirdRequest.knownShards, ["core", "metricsIndex"]);
  assert.deepEqual(thirdRequest.requestedShards, ["core", "labs"]);

  const fourth = await startBrowserVaultWarmLoad({
    requestedShards: ["core", "labs", "metricsIndex"],
  });
  assert.equal(fourth.status, "ready");
  assert.equal(
    getBrowserVaultReadySnapshot()?.client.capability,
    "core+metrics-partial+labs",
  );
  assert.deepEqual(
    getBrowserVaultReadySnapshot()?.loadedShards,
    ["core", "labs", "metricsIndex"],
  );
  const fourthRequest = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body));
  assert.deepEqual(fourthRequest.knownShards, ["core", "labs"]);
  assert.deepEqual(fourthRequest.requestedShards, ["core", "labs", "metricsIndex"]);

  const fifth = await startBrowserVaultWarmLoad({ requestedShards: ["core"] });
  assert.equal(fifth.status, "ready");
  assert.equal(getBrowserVaultReadySnapshot()?.client.capability, "core");
  assert.deepEqual(getBrowserVaultReadySnapshot()?.loadedShards, ["core"]);
  assert.equal(
    getBrowserVaultReadySnapshot()?.ref.generatedAt,
    replacementRef.generatedAt,
  );
  assert.equal(getBrowserVaultReadySnapshot()?.shards.metrics, undefined);
  assert.equal(getBrowserVaultReadySnapshot()?.shards.labs, undefined);
});

test("browser-vault warm store preserves an admitted snapshot when a selected child is temporarily unavailable", async () => {
  const replica = createReplica();
  const ref = await createShardedReplicaRef(replica);
  const shardSet = await splitBrowserVaultReplica(replica);
  const coreBytes = new TextEncoder().encode(JSON.stringify(shardSet.core));
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      shards: {
        core: createEncryptedShardResponse(ref, "core"),
      },
      state: "ready",
    }))
    .mockResolvedValueOnce(jsonErrorResponse({
      error: {
        code: "BROWSER_VAULT_PARTIAL_LOAD_UNAVAILABLE",
        message: "Requested browser vault data is temporarily unavailable.",
        retryable: true,
      },
    }, 503));

  installBrowserVaultCryptoMocks();
  mocks.decryptHostedStoragePayload.mockResolvedValueOnce(gzipSync(coreBytes));
  vi.stubGlobal("fetch", fetchMock);

  const first = await startBrowserVaultWarmLoad({ requestedShards: ["core"] });
  assert.equal(first.status, "ready");
  const admittedSnapshot = getBrowserVaultReadySnapshot();
  assert.ok(admittedSnapshot);

  const partialLoad = await startBrowserVaultWarmLoad({
    requestedShards: ["core", "labs"],
  });

  assert.equal(partialLoad.status, "error");
  assert.equal(getBrowserVaultReadySnapshot(), admittedSnapshot);
  assert.deepEqual(getBrowserVaultReadySnapshot()?.loadedShards, ["core"]);
  const request = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
  assert.deepEqual(request.knownReplicaRef, ref);
  assert.deepEqual(request.knownShards, ["core"]);
  assert.deepEqual(request.requestedShards, ["core", "labs"]);
});

test("browser-vault warm store reuses same-ref bucket intersections and retains only active demand", async () => {
  const replica = createReplica();
  const ref = await createShardedReplicaRef(replica);
  const shardSet = await splitBrowserVaultReplica(replica);
  const encoded = {
    core: gzipSync(new TextEncoder().encode(JSON.stringify(shardSet.core))),
    metricsIndex: gzipSync(new TextEncoder().encode(JSON.stringify(shardSet.metrics))),
    metric00: gzipSync(
      new TextEncoder().encode(JSON.stringify(shardSet.metricBuckets["00"])),
    ),
    metric01: gzipSync(
      new TextEncoder().encode(JSON.stringify(shardSet.metricBuckets["01"])),
    ),
  };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      metricBuckets: {
        "00": createEncryptedMetricBucketResponse(ref, "00"),
      },
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      shards: {
        core: createEncryptedShardResponse(ref, "core"),
        metricsIndex: createEncryptedShardResponse(ref, "metricsIndex"),
      },
      state: "ready",
    }))
    .mockResolvedValueOnce(jsonResponse({
      metricBuckets: {
        "01": createEncryptedMetricBucketResponse(ref, "01"),
      },
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
    }));

  installBrowserVaultCryptoMocks();
  mocks.decryptHostedStoragePayload.mockImplementation(({ aad }: {
    aad: { metricBucketId?: string; shard?: string };
  }) => {
    if (aad.shard === "core") return Promise.resolve(encoded.core);
    if (aad.shard === "metricsIndex") return Promise.resolve(encoded.metricsIndex);
    if (aad.metricBucketId === "00") return Promise.resolve(encoded.metric00);
    if (aad.metricBucketId === "01") return Promise.resolve(encoded.metric01);
    throw new Error("Unexpected encrypted browser-vault test child.");
  });
  vi.stubGlobal("fetch", fetchMock);

  const first = await startBrowserVaultWarmLoad({
    requestedMetricBuckets: ["00"],
    requestedShards: ["core", "metricsIndex"],
  });
  assert.equal(first.status, "ready");
  if (first.status !== "ready") return;
  const firstBucket = first.snapshot.shards.metricBuckets?.["00"];
  assert.ok(firstBucket);
  assert.deepEqual(first.snapshot.loadedMetricBuckets, ["00"]);

  const accumulated = await startBrowserVaultWarmLoad({
    requestedMetricBuckets: ["00", "01"],
    requestedShards: ["core", "metricsIndex"],
  });
  assert.equal(accumulated.status, "ready");
  if (accumulated.status !== "ready") return;
  assert.equal(accumulated.snapshot.shards.metricBuckets?.["00"], firstBucket);
  assert.deepEqual(accumulated.snapshot.loadedMetricBuckets, ["00", "01"]);
  const followUpBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
  assert.deepEqual(followUpBody.knownMetricBuckets, ["00"]);
  assert.deepEqual(followUpBody.requestedMetricBuckets, ["00", "01"]);

  const activeOnly = await startBrowserVaultWarmLoad({
    requestedMetricBuckets: ["01"],
    requestedShards: ["core", "metricsIndex"],
  });
  assert.equal(activeOnly.status, "ready");
  if (activeOnly.status !== "ready") return;
  assert.deepEqual(activeOnly.snapshot.loadedMetricBuckets, ["01"]);
  assert.equal(activeOnly.snapshot.shards.metricBuckets?.["00"], undefined);
  assert.ok(activeOnly.snapshot.shards.metricBuckets?.["01"]);

  clearBrowserVaultWarmState();
  assert.equal(getBrowserVaultReadySnapshot(), null);
});

test("required bucket transport failure preserves partial data and Retry requests only missing demand once", async () => {
  mocks.usePathname.mockReturnValue("/biomarkers");
  const metricBucketId = await getBrowserVaultMetricBucketId("resting-heart-rate");
  const replica = createReplica();
  const ref = await createShardedReplicaRef(replica);
  const shardSet = await splitBrowserVaultReplica(replica);
  const encoded = {
    core: gzipSync(new TextEncoder().encode(JSON.stringify(shardSet.core))),
    labs: gzipSync(new TextEncoder().encode(JSON.stringify(shardSet.labs))),
    metricsIndex: gzipSync(new TextEncoder().encode(JSON.stringify(shardSet.metrics))),
    metricBucket: gzipSync(
      new TextEncoder().encode(JSON.stringify(shardSet.metricBuckets[metricBucketId])),
    ),
  };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      shards: {
        core: createEncryptedShardResponse(ref, "core"),
        labs: createEncryptedShardResponse(ref, "labs"),
        metricsIndex: createEncryptedShardResponse(ref, "metricsIndex"),
      },
      state: "ready",
    }))
    .mockResolvedValueOnce({
      json: async () => ({ error: "Temporary failure" }),
      ok: false,
      status: 500,
    } as Response)
    .mockResolvedValueOnce(jsonResponse({
      metricBuckets: {
        [metricBucketId]: createEncryptedMetricBucketResponse(ref, metricBucketId),
      },
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }));
  installBrowserVaultCryptoMocks();
  mocks.decryptHostedStoragePayload.mockImplementation(({ aad }: {
    aad: { metricBucketId?: string; shard?: string };
  }) => {
    if (aad.shard === "core") return Promise.resolve(encoded.core);
    if (aad.shard === "labs") return Promise.resolve(encoded.labs);
    if (aad.shard === "metricsIndex") return Promise.resolve(encoded.metricsIndex);
    if (aad.metricBucketId === metricBucketId) {
      return Promise.resolve(encoded.metricBucket);
    }
    throw new Error("Unexpected encrypted browser-vault required-demand child.");
  });
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(
      createElement(BrowserVaultRequiredMetricDemandProbe),
    ),
    { requireButton: false },
  );

  await waitForText(
    rendered.container,
    "error:pending:core+metrics-partial+labs",
  );
  assert.deepEqual(getBrowserVaultReadySnapshot()?.loadedMetricBuckets, []);
  assert.equal(
    getBrowserVaultReadySnapshot()?.client.capability,
    "core+metrics-partial+labs",
  );
  assert.equal(fetchMock.mock.calls.length, 2);

  await act(async () => {
    rendered.button?.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    rendered.button?.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });
  await waitForText(
    rendered.container,
    "ready:loaded:core+metrics-partial+labs",
  );

  const failedDemandBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
  const retryBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
  assert.deepEqual(failedDemandBody.requestedMetricBuckets, [metricBucketId]);
  assert.deepEqual(retryBody.requestedMetricBuckets, [metricBucketId]);
  assert.deepEqual(retryBody.knownMetricBuckets, []);
  assert.deepEqual(retryBody.knownShards, ["core", "labs", "metricsIndex"]);
  assert.equal(fetchMock.mock.calls.length, 3);

  await rendered.cleanup();
});

test("required bucket integrity failure surfaces through the provider without dropping partial data", async () => {
  mocks.usePathname.mockReturnValue("/biomarkers");
  const metricBucketId = await getBrowserVaultMetricBucketId("resting-heart-rate");
  const mismatchedBucketId: BrowserVaultMetricBucketId = metricBucketId === "00"
    ? "01"
    : "00";
  const replica = createReplica();
  const shardSet = await splitBrowserVaultReplica(replica);
  const invalidBucket = {
    ...shardSet.metricBuckets[metricBucketId],
    bucketId: mismatchedBucketId,
  };
  const invalidBucketBytes = new TextEncoder().encode(JSON.stringify(invalidBucket));
  const encodedInvalidBucket = gzipSync(invalidBucketBytes);
  const baseRef = await createShardedReplicaRef(replica);
  assert.ok(baseRef.metricBuckets);
  const ref: HostedBrowserVaultReplicaRef = {
    ...baseRef,
    metricBuckets: {
      ...baseRef.metricBuckets,
      buckets: {
        ...baseRef.metricBuckets.buckets,
        [metricBucketId]: {
          ...baseRef.metricBuckets.buckets[metricBucketId],
          byteLength: invalidBucketBytes.byteLength,
          encodedByteLength: encodedInvalidBucket.byteLength,
        },
      },
    },
  };
  const encoded = {
    core: gzipSync(new TextEncoder().encode(JSON.stringify(shardSet.core))),
    labs: gzipSync(new TextEncoder().encode(JSON.stringify(shardSet.labs))),
    metricsIndex: gzipSync(new TextEncoder().encode(JSON.stringify(shardSet.metrics))),
  };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      shards: {
        core: createEncryptedShardResponse(ref, "core"),
        labs: createEncryptedShardResponse(ref, "labs"),
        metricsIndex: createEncryptedShardResponse(ref, "metricsIndex"),
      },
      state: "ready",
    }))
    .mockResolvedValueOnce(jsonResponse({
      metricBuckets: {
        [metricBucketId]: createEncryptedMetricBucketResponse(ref, metricBucketId),
      },
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }));
  installBrowserVaultCryptoMocks();
  mocks.decryptHostedStoragePayload.mockImplementation(({ aad }: {
    aad: { metricBucketId?: string; shard?: string };
  }) => {
    if (aad.shard === "core") return Promise.resolve(encoded.core);
    if (aad.shard === "labs") return Promise.resolve(encoded.labs);
    if (aad.shard === "metricsIndex") return Promise.resolve(encoded.metricsIndex);
    if (aad.metricBucketId === metricBucketId) {
      return Promise.resolve(encodedInvalidBucket);
    }
    throw new Error("Unexpected encrypted browser-vault integrity child.");
  });
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(
      createElement(BrowserVaultRequiredMetricDemandProbe),
    ),
    { requireButton: false },
  );

  await waitForText(
    rendered.container,
    "error:pending:core+metrics-partial+labs",
  );
  assert.equal(fetchMock.mock.calls.length, 2);
  assert.deepEqual(getBrowserVaultReadySnapshot()?.loadedMetricBuckets, []);
  assert.equal(
    getBrowserVaultReadySnapshot()?.client.capability,
    "core+metrics-partial+labs",
  );
  assert.equal(
    mocks.decryptHostedStoragePayload.mock.calls.some(([input]) =>
      input.aad.metricBucketId === metricBucketId
    ),
    true,
  );

  await rendered.cleanup();
});

test("a route transition aborts provider-owned bucket work and admits the new route before it settles", async () => {
  mocks.usePathname.mockReturnValue("/biomarkers");
  const metricBucketId = await getBrowserVaultMetricBucketId("resting-heart-rate");
  const replica = createReplica();
  const ref = await createShardedReplicaRef(replica);
  const shardSet = await splitBrowserVaultReplica(replica);
  const encoded = {
    core: gzipSync(new TextEncoder().encode(JSON.stringify(shardSet.core))),
    labs: gzipSync(new TextEncoder().encode(JSON.stringify(shardSet.labs))),
    metricsIndex: gzipSync(new TextEncoder().encode(JSON.stringify(shardSet.metrics))),
  };
  const routeABucketResponse = createDeferred<Response>();
  const routeABucketSignals: AbortSignal[] = [];
  let requestIndex = 0;
  const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    const currentRequestIndex = requestIndex;
    requestIndex += 1;
    if (currentRequestIndex === 0) {
      return Promise.resolve(jsonResponse({
        replicaKeyEnvelope: createReplicaKeyEnvelope(),
        replicaRef: ref,
        shards: {
          core: createEncryptedShardResponse(ref, "core"),
          labs: createEncryptedShardResponse(ref, "labs"),
          metricsIndex: createEncryptedShardResponse(ref, "metricsIndex"),
        },
        state: "ready",
      }));
    }
    if (currentRequestIndex === 1) {
      if (init?.signal) {
        routeABucketSignals.push(init.signal);
      }
      // Deliberately ignore abort so the late response exercises the warm
      // store generation fence as well as the provider authority fence.
      return routeABucketResponse.promise;
    }
    if (currentRequestIndex === 2) {
      return Promise.resolve(jsonResponse({
        encryptedReplica: null,
        memberId: "member_123",
        replicaAad: null,
        replicaKeyEnvelope: null,
        replicaRef: ref,
        state: "not_modified",
      }));
    }
    throw new Error("Unexpected browser-vault route transition request.");
  });
  installBrowserVaultCryptoMocks();
  mocks.decryptHostedStoragePayload.mockImplementation(({ aad }: {
    aad: { shard?: string };
  }) => {
    if (aad.shard === "core") return Promise.resolve(encoded.core);
    if (aad.shard === "labs") return Promise.resolve(encoded.labs);
    if (aad.shard === "metricsIndex") return Promise.resolve(encoded.metricsIndex);
    throw new Error("Unexpected encrypted browser-vault route transition child.");
  });
  vi.stubGlobal("fetch", fetchMock);

  function RouteTransitionHarness() {
    const [onRouteB, setOnRouteB] = useState(false);
    return createAuthenticatedBrowserVaultElement(
      onRouteB
        ? createElement(BrowserVaultStatusProbe)
        : createElement(BrowserVaultRouteMetricDemandProbe, {
            onNavigate: () => {
              mocks.usePathname.mockReturnValue("/history");
              setOnRouteB(true);
            },
          }),
    );
  }

  const rendered = await renderClientComponent(
    createElement(RouteTransitionHarness),
    { requireButton: false },
  );

  await waitForCondition(
    () => fetchMock.mock.calls.length === 2,
    "route A bucket request",
  );
  assert.equal(routeABucketSignals[0]?.aborted, false);
  const routeARequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
  assert.deepEqual(routeARequest.requestedMetricBuckets, [metricBucketId]);

  await act(async () => {
    rendered.button?.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });
  await waitForCondition(
    () => fetchMock.mock.calls.length === 3,
    "route B authority request",
  );
  assert.equal(routeABucketSignals[0]?.aborted, true);
  await waitForText(rendered.container, `ready:${ref.dataVersion}`);
  const routeBRequest = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
  assert.deepEqual(routeBRequest.requestedShards, ["core"]);
  assert.deepEqual(routeBRequest.knownShards, ["core", "labs", "metricsIndex"]);
  const routeBSnapshot = getBrowserVaultReadySnapshot();
  assert.ok(routeBSnapshot);
  assert.deepEqual(routeBSnapshot.loadedShards, ["core"]);
  assert.deepEqual(routeBSnapshot.loadedMetricBuckets, []);

  routeABucketResponse.resolve(jsonResponse({
    metricBuckets: {
      [metricBucketId]: createEncryptedMetricBucketResponse(ref, metricBucketId),
    },
    replicaKeyEnvelope: createReplicaKeyEnvelope(),
    replicaRef: ref,
    state: "ready",
  }));
  await act(async () => {
    await routeABucketResponse.promise;
    for (let flush = 0; flush < 6; flush += 1) {
      await Promise.resolve();
    }
  });

  assert.equal(getBrowserVaultReadySnapshot(), routeBSnapshot);
  assert.deepEqual(getBrowserVaultReadySnapshot()?.loadedMetricBuckets, []);
  assert.equal(rendered.container.textContent, `ready:${ref.dataVersion}`);

  await rendered.cleanup();
});

test("experiment deep links load core and metrics index before exact run-card bucket follow-up", async () => {
  mocks.usePathname.mockReturnValue("/experiments/custom-protocol");
  const replica = createReplica({
    experimentRunCards: [{
      id: "run_custom",
      lookupKeys: {
        experimentIds: ["run_custom"],
        protocolKeys: ["custom-protocol"],
        slugs: ["custom-protocol"],
      },
      requiredMetricBuckets: ["00"],
      runSummary: { metrics: [] },
      schema: "murph.browser-vault.experiment-run-card.v1",
      slug: "custom-protocol",
      startedOn: "2026-04-01",
      status: "active",
      statusLabel: "Active",
      summary: null,
      summaryDetail: null,
      tags: [],
      title: "Custom protocol",
    }],
  });
  const ref = await createShardedReplicaRef(replica);
  const shardSet = await splitBrowserVaultReplica(replica);
  const encoded = {
    core: gzipSync(new TextEncoder().encode(JSON.stringify(shardSet.core))),
    metricsIndex: gzipSync(new TextEncoder().encode(JSON.stringify(shardSet.metrics))),
    metric00: gzipSync(
      new TextEncoder().encode(JSON.stringify(shardSet.metricBuckets["00"])),
    ),
  };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      shards: {
        core: createEncryptedShardResponse(ref, "core"),
        metricsIndex: createEncryptedShardResponse(ref, "metricsIndex"),
      },
      state: "ready",
    }))
    .mockResolvedValueOnce(jsonResponse({
      metricBuckets: {
        "00": createEncryptedMetricBucketResponse(ref, "00"),
      },
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }));
  installBrowserVaultCryptoMocks();
  mocks.decryptHostedStoragePayload.mockImplementation(({ aad }: {
    aad: { metricBucketId?: string; shard?: string };
  }) => {
    if (aad.shard === "core") return Promise.resolve(encoded.core);
    if (aad.shard === "metricsIndex") return Promise.resolve(encoded.metricsIndex);
    if (aad.metricBucketId === "00") return Promise.resolve(encoded.metric00);
    throw new Error("Unexpected encrypted browser-vault test child.");
  });
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(
      createElement(BrowserVaultExperimentDemandProbe),
    ),
    { requireButton: false },
  );

  await waitForCondition(
    () => fetchMock.mock.calls.length === 2,
    "experiment metric bucket follow-up",
  );
  const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
  assert.deepEqual(firstBody.requestedShards, ["core", "metricsIndex"]);
  assert.equal(firstBody.requestedMetricBuckets, undefined);
  const followUpBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
  assert.deepEqual(followUpBody.requestedMetricBuckets, ["00"]);
  for (let flush = 0; flush < 4; flush += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  assert.equal(
    rendered.container.textContent,
    "ready:loaded:core+metrics-partial",
  );
  assert.equal(fetchMock.mock.calls.length, 2);

  await rendered.cleanup();
});

test("current saved outcomes render from the metrics index without a bucket follow-up", async () => {
  mocks.usePathname.mockReturnValue("/experiments/runs/run_current");
  const savedExperimentId = "exp_01ARZ3NDEKTSV4RRFFQ69G5FA5";
  const outcome = createExperimentDemandOutcome({
    experimentId: savedExperimentId,
    outcomeId: "outcome-current-demand",
    schemaVersion: "murph.experiment-outcome.v2",
    slug: "current-demand",
  });
  const replica = createReplica({
    entities: [{
      attributes: {
        analysisPlan: {
          desiredDirection: "decrease",
          primaryBiomarkerKey: "biomarker:resting-heart-rate",
        },
        experimentId: savedExperimentId,
        outcomeRef: {
          generatedAt: outcome.generatedAt,
          outcomeId: outcome.outcomeId!,
        },
        runPlan: {
          baselineEnd: "2026-03-07",
          baselineStart: "2026-03-01",
          interventionEnd: "2026-03-14",
          interventionStart: "2026-03-08",
        },
        slug: "current-demand",
        startedOn: "2026-03-01",
        status: "completed",
      },
      bodyPreview: null,
      date: "2026-03-14",
      experimentSlug: "current-demand",
      family: "experiment",
      id: "run_current",
      kind: "experiment",
      links: [],
      lookupIds: ["run_current", "current-demand"],
      occurredAt: "2026-03-14T12:00:00.000Z",
      recordClass: "bank",
      status: "completed",
      stream: null,
      tags: [],
      title: "Current saved outcome",
    }],
    experimentOutcomes: [outcome],
    experimentRunCards: [],
  });
  const ref = await createShardedReplicaRef(replica);
  const shardSet = await splitBrowserVaultReplica(replica);
  const encoded = {
    core: gzipSync(new TextEncoder().encode(JSON.stringify(shardSet.core))),
    metricsIndex: gzipSync(new TextEncoder().encode(JSON.stringify(shardSet.metrics))),
  };
  const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
    replicaKeyEnvelope: createReplicaKeyEnvelope(),
    replicaRef: ref,
    shards: {
      core: createEncryptedShardResponse(ref, "core"),
      metricsIndex: createEncryptedShardResponse(ref, "metricsIndex"),
    },
    state: "ready",
  }));
  installBrowserVaultCryptoMocks();
  mocks.decryptHostedStoragePayload.mockImplementation(({ aad }: {
    aad: { shard?: string };
  }) => {
    if (aad.shard === "core") return Promise.resolve(encoded.core);
    if (aad.shard === "metricsIndex") return Promise.resolve(encoded.metricsIndex);
    throw new Error("Unexpected encrypted browser-vault current-outcome child.");
  });
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(
      createElement(BrowserVaultExperimentResultDemandProbe, {
        experimentId: "run_current",
        label: "current",
      }),
    ),
    { requireButton: false },
  );

  await waitForText(rendered.container, `current:ready:loaded:${savedExperimentId}`);
  assert.equal(fetchMock.mock.calls.length, 1);
  const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
  assert.deepEqual(request.requestedShards, ["core", "metricsIndex"]);
  assert.equal(request.requestedMetricBuckets, undefined);

  await rendered.cleanup();
});

test("overflow experiment routes derive demand from the immutable legacy outcome", async () => {
  mocks.usePathname.mockReturnValue("/experiments/runs/run_overflow");
  const targetBucketId = await getBrowserVaultMetricBucketId("deep-sleep-minutes");
  const mutableEntityBucketId = await getBrowserVaultMetricBucketId("resting-heart-rate");
  assert.notEqual(targetBucketId, mutableEntityBucketId);
  const savedExperimentId = "exp_01ARZ3NDEKTSV4RRFFQ69G5FA4";
  const legacyOutcome = createExperimentDemandOutcome({
    experimentId: savedExperimentId,
    outcomeId: "outcome-overflow-legacy",
    schemaVersion: "murph.experiment-outcome.v1",
    slug: "overflow-protocol-slug",
  });
  const entities = Array.from({ length: 25 }, (_, index) => {
    const id = index === 24 ? "run_overflow" : `run_${index}`;
    const slug = index === 24 ? "overflow-protocol-slug" : `protocol-${index}`;
    return {
      attributes: {
        analysisPlan: {
          desiredDirection: "decrease",
          primaryBiomarkerKey: "biomarker:resting-heart-rate",
        },
        commonsProtocolRef: {
          key: index === 24 ? "overflow-public-protocol" : `public-${index}`,
        },
        ...(index === 24
          ? {
              experimentId: savedExperimentId,
              outcomeRef: {
                generatedAt: legacyOutcome.generatedAt,
                outcomeId: legacyOutcome.outcomeId!,
              },
            }
          : {}),
        runPlan: {
          baselineEnd: "2026-03-07",
          baselineStart: "2026-03-01",
          interventionEnd: "2026-03-14",
          interventionStart: "2026-03-08",
        },
        startedOn: "2026-03-01",
        status: index === 24 ? "completed" : "active",
      },
      bodyPreview: null,
      date: `2026-04-${String(25 - index).padStart(2, "0")}`,
      experimentSlug: slug,
      family: "experiment",
      id,
      kind: "experiment",
      links: [],
      lookupIds: [id, slug],
      occurredAt: `2026-04-${String(25 - index).padStart(2, "0")}T12:00:00.000Z`,
      recordClass: "bank" as const,
      status: index === 24 ? "completed" : "active",
      stream: null,
      tags: [],
      title: `Experiment ${index}`,
    };
  });
  const experimentRunCards = entities.slice(0, 24).map((entity) => ({
    id: entity.id,
    lookupKeys: {
      experimentIds: [entity.id],
      protocolKeys: [],
      slugs: entity.experimentSlug ? [entity.experimentSlug] : [],
    },
    requiredMetricBuckets: [targetBucketId],
    runSummary: { metrics: [] },
    schema: "murph.browser-vault.experiment-run-card.v1" as const,
    slug: entity.experimentSlug,
    startedOn: "2026-03-01",
    status: "active" as const,
    statusLabel: "Active",
    summary: null,
    summaryDetail: null,
    tags: [],
    title: entity.title,
  }));
  const replica = createReplica({
    entities,
    experimentOutcomes: [legacyOutcome],
    experimentRunCards,
    metricRows: [{
      biomarkerKey: "biomarker:deep-sleep-minutes",
      comparator: null,
      confidence: "high",
      context: {},
      date: "2026-03-10",
      grain: "day",
      id: "metric-row:overflow-deep-sleep",
      metricKey: "deep-sleep-minutes",
      observedAt: "2026-03-10T12:00:00.000Z",
      pointIds: ["point-overflow-deep-sleep"],
      recordIds: ["record-overflow-deep-sleep"],
      rowSchema: "murph.browser-vault.metric-row.v1",
      sourceFamily: "sample",
      sourceKind: "wearable-summary",
      sourceLabel: "Device",
      statistic: "value",
      unit: "min",
      value: 60,
      valueLabel: null,
    }],
  });
  assert.equal(replica.entities.length, 25);
  assert.equal(replica.experimentRunCards?.length, 24);
  assert.equal(replica.experimentRunCards?.some((card) => card.id === "run_overflow"), false);

  const ref = await createShardedReplicaRef(replica);
  const shardSet = await splitBrowserVaultReplica(replica);
  const encoded = {
    core: gzipSync(new TextEncoder().encode(JSON.stringify(shardSet.core))),
    metricsIndex: gzipSync(new TextEncoder().encode(JSON.stringify(shardSet.metrics))),
    targetBucket: gzipSync(
      new TextEncoder().encode(JSON.stringify(shardSet.metricBuckets[targetBucketId])),
    ),
  };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      shards: {
        core: createEncryptedShardResponse(ref, "core"),
        metricsIndex: createEncryptedShardResponse(ref, "metricsIndex"),
      },
      state: "ready",
    }))
    .mockResolvedValueOnce(jsonResponse({
      metricBuckets: {
        [targetBucketId]: createEncryptedMetricBucketResponse(ref, targetBucketId),
      },
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: ref,
      state: "ready",
    }));
  installBrowserVaultCryptoMocks();
  mocks.decryptHostedStoragePayload.mockImplementation(({ aad }: {
    aad: { metricBucketId?: string; shard?: string };
  }) => {
    if (aad.shard === "core") return Promise.resolve(encoded.core);
    if (aad.shard === "metricsIndex") return Promise.resolve(encoded.metricsIndex);
    if (aad.metricBucketId === targetBucketId) return Promise.resolve(encoded.targetBucket);
    throw new Error("Unexpected encrypted browser-vault experiment overflow child.");
  });
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(
      createElement("div", null,
        createElement(BrowserVaultExperimentResultDemandProbe, {
          experimentId: "run_overflow",
          label: "exact",
        }),
        createElement(BrowserVaultExperimentResultDemandProbe, {
          label: "slug",
          lookups: [{ slug: "overflow-protocol-slug" }],
        }),
        createElement(BrowserVaultExperimentResultDemandProbe, {
          label: "protocol",
          lookups: [{ protocolKeys: ["overflow-public-protocol"] }],
        }),
        createElement(BrowserVaultExperimentResultDemandProbe, {
          experimentId: "absent-run",
          label: "absent",
        }),
      ),
    ),
    { requireButton: false },
  );

  await waitForText(rendered.container, `exact:ready:loaded:${savedExperimentId}`);
  await waitForText(rendered.container, `slug:ready:loaded:${savedExperimentId}`);
  await waitForText(rendered.container, `protocol:ready:loaded:${savedExperimentId}`);
  await waitForText(rendered.container, "absent:ready:loaded:not-found");
  assert.equal(fetchMock.mock.calls.length, 2);
  const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
  assert.deepEqual(firstBody.requestedShards, ["core", "metricsIndex"]);
  assert.equal(firstBody.requestedMetricBuckets, undefined);
  const followUpBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
  assert.deepEqual(followUpBody.requestedMetricBuckets, [targetBucketId]);
  assert.equal(followUpBody.requestedMetricBuckets.length, 1);

  await rendered.cleanup();
});

test("browser-vault provider keeps matching legacy replicas readable while refresh is pending", async () => {
  const legacyReplica: Record<string, unknown> = { ...createReplica() };
  delete legacyReplica.generation;
  const legacyRef: Record<string, unknown> = {
    ...createReplicaRef(),
    byteLength: new TextEncoder().encode(JSON.stringify(legacyReplica)).byteLength,
  };
  delete legacyRef.generation;
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

  const sharedLoad = startBrowserVaultWarmLoad();
  await waitForCondition(() => fetchMock.mock.calls.length === 1, "shared dashboard fetch");

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

  assert.equal((await sharedLoad).status, "superseded");
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
  assert.notEqual(getBrowserVaultReadySnapshot()?.client, warmedClient);
  assert.equal(getBrowserVaultReadySnapshot()?.client.capability, "core");
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

test("a stale empty biomarker detail exposes provider-owned refresh without background polling", async () => {
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
    createAuthenticatedBrowserVaultElement(
      createElement(LabBiomarkerDetailClient, {
        authenticated: true,
        metricKey: "hba1c",
      }),
    ),
    { requireButton: false },
  );

  await waitForText(rendered.container, "No results found");
  assert.equal(rendered.container.textContent?.includes("This history may be out of date"), true);
  assert.equal(rendered.container.textContent?.includes("Preparing dashboard..."), false);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(25_000);
  });

  assert.equal(fetchMock.mock.calls.length, 1);

  const refreshButton = [...rendered.container.querySelectorAll("button")].find(
    (button) => button.textContent === "Refresh",
  );
  assert.ok(refreshButton);
  await act(async () => {
    refreshButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });
  await waitForCondition(() => fetchMock.mock.calls.length === 2, "manual stale refresh");

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
  const legacyReplica = createReplica({
    generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION - 1,
  });
  delete legacyReplica.personalPatterns;
  const currentReplica = createReplica({
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
      dataVersion: "e".repeat(64),
      sourceBundleHash: "a".repeat(64),
    },
  });
  const legacyRef = createReplicaRef({
    byteLength: new TextEncoder().encode(JSON.stringify(legacyReplica)).byteLength,
    generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION - 1,
  });
  const currentRef = createReplicaRef({
    byteLength: new TextEncoder().encode(JSON.stringify(currentReplica)).byteLength,
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
  mocks.decryptHostedStoragePayload
    .mockResolvedValueOnce(new TextEncoder().encode(JSON.stringify(legacyReplica)))
    .mockResolvedValueOnce(new TextEncoder().encode(JSON.stringify(currentReplica)));
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

test("a runtime refresh request passes replica refs to its predicate and waits through a nonmatching replica", async () => {
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

test("a matching ordinary read retires its queued stronger refresh", async () => {
  const currentRef = createReplicaRef();
  const matchingRef = createReplicaRef({
    dataVersion: "f".repeat(64),
    keyId: "browser-vault-replica:f",
    objectKey: "users/browser-vault-replicas/opaque/matching.json",
    sourceBundleHash: "c".repeat(64),
  });
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
    .mockResolvedValue(jsonResponse({
      encryptedReplica: null,
      memberId: "member_123",
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: matchingRef,
      state: "not_modified",
    }));

  installBrowserVaultCryptoMocks();
  mocks.decryptHostedStoragePayload
    .mockReset()
    .mockResolvedValueOnce(
      new TextEncoder().encode(JSON.stringify(createReplica())),
    )
    .mockResolvedValueOnce(new TextEncoder().encode(JSON.stringify(createReplica({
      source: {
        dataVersion: matchingRef.dataVersion,
        sourceBundleHash: matchingRef.sourceBundleHash,
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
    encryptedReplica: createReplicaEnvelope("f"),
    replicaAad: createReplicaAad("member_123", "f", {
      objectKey: matchingRef.objectKey,
      sourceBundleHash: matchingRef.sourceBundleHash,
    }),
    replicaKeyEnvelope: createReplicaKeyEnvelope("member_123", "f"),
    replicaRef: matchingRef,
    state: "ready",
  }));
  await waitForText(
    rendered.container,
    `${matchingRef.sourceBundleHash}:${matchingRef.dataVersion}:ready`,
  );
  for (let flush = 0; flush < 6; flush += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  assert.equal(fetchMock.mock.calls.length, 2);
  assert.equal(peekBrowserVaultInFlightLoad(), null);

  mocks.usePathname.mockReturnValue("/history");
  await rendered.rerender(
    createAuthenticatedBrowserVaultElement(
      createElement(BrowserVaultRuntimeRefreshProbe),
    ),
  );
  await waitForCondition(
    () => fetchMock.mock.calls.length === 3,
    "replacement route authority request",
  );
  const routeBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
  assert.equal(routeBody.requestRefresh, undefined);
  await waitForText(
    rendered.container,
    `${matchingRef.sourceBundleHash}:${matchingRef.dataVersion}:ready`,
  );

  await rendered.cleanup();
});

test("a post-request runtime refresh survives the production checkpoint floor", async () => {
  vi.useFakeTimers();
  const currentRef = createReplicaRef();
  const admittedRef = createReplicaRef({
    dataVersion: "e".repeat(64),
    keyId: "browser-vault-replica:e",
    objectKey: "users/browser-vault-replicas/opaque/admitted.json",
    sourceBundleHash: "b".repeat(64),
  });
  const replacementRef = createReplicaRef({
    dataVersion: "f".repeat(64),
    keyId: "browser-vault-replica:f",
    objectKey: "users/browser-vault-replicas/opaque/post-request.json",
    sourceBundleHash: "c".repeat(64),
  });
  const focusResponse = createDeferred<Response>();
  let replacementPublished = false;
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
      replicaRef: admittedRef,
      refreshPending: true,
      state: "not_modified",
    }))
    .mockImplementation(() => Promise.resolve(replacementPublished
      ? jsonResponse({
          encryptedReplica: createReplicaEnvelope("f"),
          replicaAad: createReplicaAad("member_123", "f", {
            objectKey: replacementRef.objectKey,
            sourceBundleHash: replacementRef.sourceBundleHash,
          }),
          replicaKeyEnvelope: createReplicaKeyEnvelope("member_123", "f"),
          replicaRef: replacementRef,
          state: "ready",
        })
      : jsonResponse({
          encryptedReplica: null,
          memberId: "member_123",
          replicaAad: null,
          replicaKeyEnvelope: null,
          replicaRef: admittedRef,
          refreshPending: true,
          state: "not_modified",
        })));

  installBrowserVaultCryptoMocks();
  mocks.decryptHostedStoragePayload
    .mockReset()
    .mockResolvedValueOnce(
      new TextEncoder().encode(JSON.stringify(createReplica())),
    )
    .mockResolvedValueOnce(new TextEncoder().encode(JSON.stringify(createReplica({
      source: {
        dataVersion: admittedRef.dataVersion,
        sourceBundleHash: admittedRef.sourceBundleHash,
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
      createElement(BrowserVaultPostRequestRefreshProbe),
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
    encryptedReplica: createReplicaEnvelope("e"),
    replicaAad: createReplicaAad("member_123", "e", {
      objectKey: admittedRef.objectKey,
      sourceBundleHash: admittedRef.sourceBundleHash,
    }),
    replicaKeyEnvelope: createReplicaKeyEnvelope("member_123", "e"),
    replicaRef: admittedRef,
    state: "ready",
  }));

  await waitForCondition(
    () => fetchMock.mock.calls.length === 3,
    "queued post-request refresh",
  );
  await waitForText(
    rendered.container,
    `${admittedRef.sourceBundleHash}:${admittedRef.dataVersion}:pending`,
  );
  const refreshBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
  assert.equal(refreshBody.requestRefresh, true);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(180_000);
  });
  await waitForText(
    rendered.container,
    `${admittedRef.sourceBundleHash}:${admittedRef.dataVersion}:pending`,
  );
  for (const [, init] of fetchMock.mock.calls.slice(3)) {
    const pollBody = JSON.parse(String(init?.body));
    assert.equal(pollBody.requestRefresh, undefined);
  }
  assert.equal(fetchMock.mock.calls.filter(([, init]) => {
    const body = JSON.parse(String(init?.body));
    return body.requestRefresh === true;
  }).length, 1);

  replacementPublished = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  await waitForText(
    rendered.container,
    `${replacementRef.sourceBundleHash}:${replacementRef.dataVersion}:ready`,
  );
  assert.equal(fetchMock.mock.calls.filter(([, init]) => {
    const body = JSON.parse(String(init?.body));
    return body.requestRefresh === true;
  }).length, 1);

  await rendered.cleanup();
});

test("Environment keeps one refresh boundary through delayed checkpoint recovery", async () => {
  vi.useFakeTimers();
  mocks.usePathname.mockReturnValue("/environment");
  const currentRef = createReplicaRef();
  const replacementRef = createReplicaRef({
    dataVersion: "f".repeat(64),
    keyId: "browser-vault-replica:f",
    objectKey: "users/browser-vault-replicas/opaque/environment-replacement.json",
    sourceBundleHash: "c".repeat(64),
  });
  let processing = true;
  let replacementPublished = false;
  const fetchMock = vi.fn(async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/environment/realtime/topics") {
      return jsonResponse({ processing });
    }
    assert.equal(url, "/api/browser-vault/session");
    const body = JSON.parse(String(init?.body));
    if (!body.knownReplicaRef) {
      return jsonResponse({
        encryptedReplica: createReplicaEnvelope(),
        replicaAad: createReplicaAad(),
        replicaKeyEnvelope: createReplicaKeyEnvelope(),
        replicaRef: currentRef,
        state: "ready",
      });
    }
    if (replacementPublished) {
      return jsonResponse({
        encryptedReplica: createReplicaEnvelope("f"),
        replicaAad: createReplicaAad("member_123", "f", {
          objectKey: replacementRef.objectKey,
          sourceBundleHash: replacementRef.sourceBundleHash,
        }),
        replicaKeyEnvelope: createReplicaKeyEnvelope("member_123", "f"),
        replicaRef: replacementRef,
        state: "ready",
      });
    }
    return jsonResponse({
      encryptedReplica: null,
      memberId: "member_123",
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: currentRef,
      refreshPending: false,
      state: "not_modified",
    });
  });

  installBrowserVaultCryptoMocks();
  mocks.decryptHostedStoragePayload
    .mockReset()
    .mockResolvedValueOnce(
      new TextEncoder().encode(JSON.stringify(createReplica())),
    )
    .mockResolvedValueOnce(new TextEncoder().encode(JSON.stringify(createReplica({
      source: {
        dataVersion: replacementRef.dataVersion,
        sourceBundleHash: replacementRef.sourceBundleHash,
      },
    }))));
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(
      createElement(EnvironmentPageClient, { contactOptions: [] }),
    ),
    {
      location: {
        hash: "",
        href: "https://local.withmurph.ai/environment",
        origin: "https://local.withmurph.ai",
        pathname: "/environment",
        search: "",
      },
      requireButton: false,
    },
  );
  await waitForText(rendered.container, "Murph is saving your answers");

  processing = false;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  await waitForText(rendered.container, "Murph is saving your answers");
  const countForcedRefreshes = () => fetchMock.mock.calls.filter(([, init]) => {
    if (!init?.body) {
      return false;
    }
    const body = JSON.parse(String(init.body));
    return body.requestRefresh === true;
  }).length;
  assert.equal(countForcedRefreshes(), 1);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(118_000);
  });
  await waitForText(rendered.container, "Murph is taking longer than usual");
  const firstCheckAgain = Array.from(
    rendered.window.document.querySelectorAll("button"),
  ).find((button) => button.textContent?.includes("Check again"));
  assert.ok(firstCheckAgain instanceof rendered.window.HTMLButtonElement);
  await act(async () => {
    firstCheckAgain.click();
    await Promise.resolve();
  });
  assert.equal(countForcedRefreshes(), 1);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(240_000);
  });
  await waitForText(rendered.container, "Murph is taking longer than usual");
  assert.equal(countForcedRefreshes(), 2);
  const callsAtPollingBoundary = fetchMock.mock.calls.length;

  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  assert.ok(fetchMock.mock.calls.length > callsAtPollingBoundary);
  assert.equal(countForcedRefreshes(), 2);

  const recoveryCheckAgain = Array.from(
    rendered.window.document.querySelectorAll("button"),
  ).find((button) => button.textContent?.includes("Check again"));
  assert.ok(recoveryCheckAgain instanceof rendered.window.HTMLButtonElement);
  replacementPublished = true;
  await act(async () => {
    recoveryCheckAgain.click();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(15_000);
  });
  assert.equal(countForcedRefreshes(), 3);
  await waitForText(rendered.container, "The report was not updated");
  assert.equal(countForcedRefreshes(), 3);

  await rendered.cleanup();
});

test("a matching explicit refresh leaves no generic poll behind", async () => {
  vi.useFakeTimers();
  const currentRef = createReplicaRef();
  const matchingRef = createReplicaRef({
    dataVersion: "f".repeat(64),
    keyId: "browser-vault-replica:f",
    objectKey: "users/browser-vault-replicas/opaque/matching-explicit.json",
    sourceBundleHash: "c".repeat(64),
  });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: currentRef,
      state: "ready",
    }))
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: createReplicaEnvelope("f"),
      replicaAad: createReplicaAad("member_123", "f", {
        objectKey: matchingRef.objectKey,
        sourceBundleHash: matchingRef.sourceBundleHash,
      }),
      replicaKeyEnvelope: createReplicaKeyEnvelope("member_123", "f"),
      replicaRef: matchingRef,
      refreshPending: false,
      state: "ready",
    }))
    .mockResolvedValue(jsonResponse({
      encryptedReplica: null,
      memberId: "member_123",
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: matchingRef,
      refreshPending: false,
      state: "not_modified",
    }));

  installBrowserVaultCryptoMocks();
  mocks.decryptHostedStoragePayload
    .mockReset()
    .mockResolvedValueOnce(
      new TextEncoder().encode(JSON.stringify(createReplica())),
    )
    .mockResolvedValueOnce(new TextEncoder().encode(JSON.stringify(createReplica({
      source: {
        dataVersion: matchingRef.dataVersion,
        sourceBundleHash: matchingRef.sourceBundleHash,
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
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
  });
  await waitForText(
    rendered.container,
    `${matchingRef.sourceBundleHash}:${matchingRef.dataVersion}:ready`,
  );
  assert.equal(fetchMock.mock.calls.length, 2);
  assert.equal(peekBrowserVaultInFlightLoad(), null);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  assert.equal(fetchMock.mock.calls.length, 2);

  mocks.usePathname.mockReturnValue("/history");
  await rendered.rerender(
    createAuthenticatedBrowserVaultElement(
      createElement(BrowserVaultRuntimeRefreshProbe),
    ),
  );
  await waitForCondition(
    () => fetchMock.mock.calls.length === 3,
    "replacement route authority request",
  );
  const routeBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
  assert.equal(routeBody.requestRefresh, undefined);
  await waitForText(
    rendered.container,
    `${matchingRef.sourceBundleHash}:${matchingRef.dataVersion}:ready`,
  );

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

test("a handoff deadline retires its stalled session poll before route and retry", async () => {
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
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: null,
      memberId: "member_123",
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: currentRef,
      refreshPending: true,
      state: "not_modified",
    }))
    .mockImplementationOnce((_input: unknown, init?: RequestInit) => {
      if (init?.signal) {
        stalledSignals.push(init.signal);
      }
      return stalledResponse.promise;
    })
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
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_500);
  });
  await waitForCondition(
    () => fetchMock.mock.calls.length === 3,
    "stalled session poll",
  );
  await waitForText(
    rendered.container,
    `${currentRef.sourceBundleHash}:${currentRef.dataVersion}:pending`,
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(58_501);
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

  mocks.usePathname.mockReturnValue("/history");
  await rendered.rerender(
    createAuthenticatedBrowserVaultElement(
      createElement(BrowserVaultRuntimeRefreshProbe),
    ),
  );
  await waitForCondition(
    () => fetchMock.mock.calls.length === fetchCountAtDeadline + 1,
    "replacement route authority request",
  );
  const routeBody = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
  assert.equal(routeBody.requestRefresh, undefined);
  await waitForText(
    rendered.container,
    `${currentRef.sourceBundleHash}:${currentRef.dataVersion}:ready`,
  );

  await act(async () => {
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
  });
  await waitForCondition(
    () => fetchMock.mock.calls.length === fetchCountAtDeadline + 2,
    "replacement runtime refresh",
  );
  const replacementBody = JSON.parse(
    String(fetchMock.mock.calls.at(-1)?.[1]?.body),
  );
  assert.equal(replacementBody.requestRefresh, true);

  await rendered.cleanup();
});

test("an old Training deadline cannot abort the next route authority request", async () => {
  vi.useFakeTimers();
  const currentRef = createReplicaRef();
  const routeResponse = createDeferred<Response>();
  const routeSignals: AbortSignal[] = [];
  let requestCount = 0;
  let routeChanged = false;
  const fetchMock = vi.fn((_input: unknown, init?: RequestInit) => {
    requestCount += 1;
    if (requestCount === 1) {
      return Promise.resolve(jsonResponse({
        encryptedReplica: createReplicaEnvelope(),
        replicaAad: createReplicaAad(),
        replicaKeyEnvelope: createReplicaKeyEnvelope(),
        replicaRef: currentRef,
        state: "ready",
      }));
    }
    if (routeChanged) {
      if (init?.signal) {
        routeSignals.push(init.signal);
      }
      return routeResponse.promise;
    }
    return Promise.resolve(jsonResponse({
      encryptedReplica: null,
      memberId: "member_123",
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: currentRef,
      state: "not_modified",
    }));
  });

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
    await vi.advanceTimersByTimeAsync(59_000);
  });

  routeChanged = true;
  mocks.usePathname.mockReturnValue("/history");
  await rendered.rerender(
    createAuthenticatedBrowserVaultElement(
      createElement(BrowserVaultRuntimeRefreshProbe),
    ),
  );
  await waitForCondition(
    () => routeSignals.length === 1,
    "replacement route authority request",
  );
  assert.equal(routeSignals[0]?.aborted, false);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  assert.equal(routeSignals[0]?.aborted, false);

  routeResponse.resolve(jsonResponse({
    encryptedReplica: null,
    memberId: "member_123",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: currentRef,
    state: "not_modified",
  }));
  await waitForText(
    rendered.container,
    `${currentRef.sourceBundleHash}:${currentRef.dataVersion}:ready`,
  );
  assert.equal(routeSignals[0]?.aborted, false);

  await rendered.cleanup();
});

test("provider unmount invalidates a runtime refresh queued behind an ordinary read", async () => {
  const currentRef = createReplicaRef();
  const focusResponse = createDeferred<Response>();
  const focusSignals: AbortSignal[] = [];
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
        focusSignals.push(init.signal);
      }
      return focusResponse.promise;
    })
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
  const readyClient = getBrowserVaultReadySnapshot()?.client;
  assert.ok(readyClient);

  await act(async () => {
    rendered.window.dispatchEvent(new rendered.window.Event("focus"));
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
  });
  await waitForCondition(
    () => fetchMock.mock.calls.length === 2,
    "ordinary read with queued runtime refresh",
  );

  await rendered.cleanup();
  assert.equal(focusSignals[0]?.aborted, true);
  focusResponse.resolve(jsonResponse({
    encryptedReplica: null,
    memberId: "member_123",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: currentRef,
    state: "not_modified",
  }));
  for (let flush = 0; flush < 6; flush += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }

  assert.equal(fetchMock.mock.calls.length, 2);
  assert.equal(getBrowserVaultReadySnapshot()?.client, readyClient);
});

test("provider unmount aborts a deferred runtime refresh after it starts", async () => {
  const currentRef = createReplicaRef();
  const focusResponse = createDeferred<Response>();
  const runtimeResponse = createDeferred<Response>();
  const focusSignals: AbortSignal[] = [];
  const runtimeSignals: AbortSignal[] = [];
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
        focusSignals.push(init.signal);
      }
      return focusResponse.promise;
    })
    .mockImplementationOnce((_input: unknown, init?: RequestInit) => {
      if (init?.signal) {
        runtimeSignals.push(init.signal);
      }
      return runtimeResponse.promise;
    })
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
  const readyClient = getBrowserVaultReadySnapshot()?.client;
  assert.ok(readyClient);

  await act(async () => {
    rendered.window.dispatchEvent(new rendered.window.Event("focus"));
    rendered.button?.dispatchEvent(new Event("click", { bubbles: true }));
  });
  await waitForCondition(
    () => fetchMock.mock.calls.length === 2,
    "ordinary read with queued runtime refresh",
  );

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
    "deferred runtime refresh",
  );
  assert.equal(focusSignals[0]?.aborted, false);
  assert.equal(runtimeSignals[0]?.aborted, false);

  await rendered.cleanup();
  assert.equal(runtimeSignals[0]?.aborted, true);
  assert.equal(peekBrowserVaultInFlightLoad(), null);

  runtimeResponse.resolve(jsonResponse({
    encryptedReplica: null,
    memberId: "member_123",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: currentRef,
    state: "not_modified",
  }));
  for (let flush = 0; flush < 6; flush += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  assert.equal(getBrowserVaultReadySnapshot()?.client, readyClient);

  const remounted = await renderClientComponent(
    createAuthenticatedBrowserVaultElement(
      createElement(BrowserVaultRuntimeRefreshProbe),
    ),
    { requireButton: false },
  );
  await waitForText(
    remounted.container,
    `${currentRef.sourceBundleHash}:${currentRef.dataVersion}:ready`,
  );
  assert.equal(fetchMock.mock.calls.length, 4);
  await remounted.cleanup();
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

  const sharedLoad = startBrowserVaultWarmLoad();
  void sharedLoad.then(() => {
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

  await sharedLoad;
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

test("browser-vault provider reuses an in-flight dashboard request before post-mount authority", async () => {
  const ref = createReplicaRef();
  const sharedResponse = createDeferred<Response>();
  const providerResponse = createDeferred<Response>();
  const fetchMock = vi.fn()
    .mockImplementationOnce(() => sharedResponse.promise)
    .mockImplementationOnce(() => providerResponse.promise);

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  void startBrowserVaultWarmLoad();
  await waitForCondition(() => fetchMock.mock.calls.length === 1, "shared dashboard fetch");
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

  sharedResponse.resolve(jsonResponse({
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

test("aborting an ordinary load invalidates its queued stronger refresh", async () => {
  const ordinaryResponse = createDeferred<Response>();
  const fetchMock = vi.fn()
    .mockImplementationOnce(() => ordinaryResponse.promise)
    .mockResolvedValueOnce(jsonResponse({
      encryptedReplica: null,
      memberId: "member_123",
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: null,
      state: "empty",
    }));

  installBrowserVaultCryptoMocks();
  vi.stubGlobal("fetch", fetchMock);

  const ordinaryLoad = startBrowserVaultWarmLoad();
  await waitForCondition(() => fetchMock.mock.calls.length === 1, "ordinary load");
  const queuedRefresh = startBrowserVaultWarmLoad({ requestRefresh: true });

  abortBrowserVaultInFlightLoad();
  ordinaryResponse.resolve(jsonResponse({
    encryptedReplica: null,
    memberId: "member_123",
    replicaAad: null,
    replicaKeyEnvelope: null,
    replicaRef: null,
    state: "empty",
  }));

  assert.equal((await ordinaryLoad).status, "superseded");
  assert.equal((await queuedRefresh).status, "superseded");
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(peekBrowserVaultInFlightLoad(), null);

  const retry = startBrowserVaultWarmLoad({ requestRefresh: true });
  await waitForCondition(
    () => fetchMock.mock.calls.length === 2,
    "new stronger refresh",
  );
  const retryBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
  assert.equal(retryBody.requestRefresh, true);
  assert.equal((await retry).status, "empty");
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

function BrowserVaultExperimentDemandProbe() {
  const vault = useBrowserVault();
  const loaded = useBrowserVaultExperimentMetricBucketDemand({
    experimentId: "run_custom",
  });

  return createElement(
    "div",
    null,
    `${vault.status}:${loaded ? "loaded" : "pending"}:${vault.client?.capability ?? "none"}`,
  );
}

function BrowserVaultExperimentResultDemandProbe({
  experimentId,
  label,
  lookups = [],
}: {
  experimentId?: string;
  label: string;
  lookups?: readonly BrowserVaultExperimentRunCardLookup[];
}) {
  const vault = useBrowserVault();
  const loaded = useBrowserVaultExperimentMetricBucketDemand({ experimentId, lookups });
  const metricsClient = loaded && isBrowserVaultMetricsCapable(vault.client)
    ? vault.client
    : null;
  const lookup = experimentId ? { experimentId } : lookups[0];
  const result = metricsClient && lookup
    ? selectBrowserVaultExperimentResults(metricsClient, lookup)
    : null;

  return createElement(
    "div",
    null,
    `${label}:${vault.status}:${loaded ? "loaded" : "pending"}:${result?.experiment.id ?? "not-found"}`,
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

function BrowserVaultRequiredMetricDemandProbe() {
  const vault = useBrowserVault();
  const loaded = useBrowserVaultMetricKeyDemand(["resting-heart-rate"]);

  return createElement(
    "button",
    { onClick: () => void vault.refresh({ background: true }) },
    `${vault.status}:${loaded ? "loaded" : "pending"}:${vault.client?.capability ?? "none"}:${vault.error ?? "none"}`,
  );
}

function BrowserVaultRouteMetricDemandProbe({
  onNavigate,
}: {
  onNavigate: () => void;
}) {
  const vault = useBrowserVault();
  const loaded = useBrowserVaultMetricKeyDemand(["resting-heart-rate"]);

  return createElement(
    "button",
    { onClick: onNavigate },
    `${vault.status}:${loaded ? "loaded" : "pending"}:${vault.client?.capability ?? "none"}`,
  );
}

function BrowserVaultRuntimeRefreshProbe() {
  const vault = useBrowserVault();

  return createElement(
    "button",
    {
      onClick: () => void vault.refresh({
        background: true,
        requestRuntimeRefreshUntil: (_client, replicaRef) =>
          replicaRef.dataVersion === "f".repeat(64),
      }),
    },
    `${vault.ref?.sourceBundleHash ?? "none"}:${vault.dataVersion ?? "none"}:${vault.runtimeRefreshPending ? "pending" : "ready"}`,
  );
}

function BrowserVaultPostRequestRefreshProbe() {
  const vault = useBrowserVault();

  return createElement(
    "button",
    {
      onClick: () => void vault.refresh({
        background: true,
        requestRuntimeRefreshUntilAfterRequest: () => true,
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

function jsonErrorResponse(value: unknown, status: number): Response {
  return {
    json: async () => value,
    ok: false,
    status,
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
  const replica = createReplica();
  return {
    byteLength: new TextEncoder().encode(JSON.stringify(replica)).byteLength,
    dataVersion: "d".repeat(64),
    generatedAt: replica.generatedAt,
    generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
    keyId: "browser-vault-replica:d",
    objectKey: "users/browser-vault-replicas/opaque/replica.json",
    replicaSchema: "murph.browser-vault-replica" as const,
    runtimeRootKeyId: "udrk:runtime:test-root",
    schema: "murph.hosted-browser-vault-replica-ref.v1" as const,
    sourceBundleHash: "a".repeat(64),
  };
}

async function createShardedReplicaRef(
  replica: BrowserVaultReplica = createReplica(),
): Promise<HostedBrowserVaultReplicaRef> {
  const shardSet = await splitBrowserVaultReplica(replica);
  const shardRef = (shard: "core" | "labs" | "metricsIndex") => {
    const selectionKey = shard === "metricsIndex" ? "metrics" : shard;
    const bytes = new TextEncoder().encode(JSON.stringify(shardSet[selectionKey]));
    return {
      byteLength: bytes.byteLength,
      contentEncoding: "gzip" as const,
      encodedByteLength: gzipSync(bytes).byteLength,
      objectKey: `users/browser-vault-replicas/opaque/replica.${shard}.json`,
    };
  };
  return createReplicaRef({
    dataVersion: replica.source.dataVersion,
    generatedAt: replica.generatedAt,
    generation: replica.generation,
    shards: {
      schema: "murph.hosted-browser-vault-replica-shards.v1",
      core: shardRef("core"),
      labs: shardRef("labs"),
      metricsIndex: shardRef("metricsIndex"),
    },
    metricBuckets: {
      bucketCount: 32,
      buckets: Object.fromEntries(BROWSER_VAULT_METRIC_BUCKET_IDS.map((bucketId) => {
        const bytes = new TextEncoder().encode(JSON.stringify(shardSet.metricBuckets[bucketId]));
        return [bucketId, {
          byteLength: bytes.byteLength,
          contentEncoding: "gzip" as const,
          encodedByteLength: gzipSync(bytes).byteLength,
          objectKey: `users/browser-vault-replicas/opaque/replica.metric-${bucketId}.json`,
        }];
      })) as NonNullable<HostedBrowserVaultReplicaRef["metricBuckets"]>["buckets"],
      schema: "murph.hosted-browser-vault-replica-metric-buckets.v1",
    },
    sourceBundleHash: replica.source.sourceBundleHash,
  });
}

function createEncryptedShardResponse(
  ref: HostedBrowserVaultReplicaRef,
  shard: "core" | "labs" | "metricsIndex",
) {
  const shardRef = ref.shards?.[shard];
  if (!shardRef) {
    throw new TypeError(`Missing ${shard} test shard ref.`);
  }
  const shardSchema = shard === "core"
    ? "murph.browser-vault-replica.core.v1"
    : shard === "metricsIndex"
      ? "murph.browser-vault-replica.metrics-index.v1"
      : "murph.browser-vault-replica.labs.v1";
  return {
    encryptedShard: createReplicaEnvelope(),
    shardAad: {
      byteLength: shardRef.byteLength,
      contentEncoding: shardRef.contentEncoding,
      dataVersion: ref.dataVersion,
      encodedByteLength: shardRef.encodedByteLength,
      generatedAt: ref.generatedAt,
      generation: ref.generation,
      objectKey: shardRef.objectKey,
      purpose: "browser-vault-replica",
      runtimeRootKeyId: ref.runtimeRootKeyId,
      schema: "murph.browser-vault-replica",
      shard,
      shardSchema,
      shardSetRefSchema: ref.shards?.schema,
      sourceBundleHash: ref.sourceBundleHash,
      userId: "member_123",
    },
  };
}

function createEncryptedMetricBucketResponse(
  ref: HostedBrowserVaultReplicaRef,
  metricBucketId: BrowserVaultMetricBucketId,
) {
  const metricBucketRef = ref.metricBuckets?.buckets[metricBucketId];
  if (!metricBucketRef || !ref.metricBuckets) {
    throw new TypeError(`Missing ${metricBucketId} test metric-bucket ref.`);
  }
  return {
    encryptedMetricBucket: createReplicaEnvelope(),
    metricBucketAad: {
      byteLength: metricBucketRef.byteLength,
      contentEncoding: metricBucketRef.contentEncoding,
      dataVersion: ref.dataVersion,
      encodedByteLength: metricBucketRef.encodedByteLength,
      generatedAt: ref.generatedAt,
      generation: ref.generation,
      metricBucketCount: ref.metricBuckets.bucketCount,
      metricBucketId,
      metricBucketSchema: "murph.browser-vault-replica.metric-bucket.v1",
      metricBucketSetRefSchema: ref.metricBuckets.schema,
      objectKey: metricBucketRef.objectKey,
      purpose: "browser-vault-replica",
      runtimeRootKeyId: ref.runtimeRootKeyId,
      schema: "murph.browser-vault-replica",
      sourceBundleHash: ref.sourceBundleHash,
      userId: "member_123",
    },
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

function createExperimentDemandOutcome(input: {
  experimentId: string;
  outcomeId: string;
  schemaVersion: "murph.experiment-outcome.v1" | "murph.experiment-outcome.v2";
  slug: string;
}): NonNullable<BrowserVaultReplica["experimentOutcomes"]>[number] {
  return {
    adherenceSummary: {
      completedSessions: 1,
      minimumUsefulSessions: 1,
      status: "met_target",
      targetSessions: 1,
    },
    asOf: "2026-03-14",
    commonsProtocolRef: null,
    conclusion: {
      caveats: [],
      headline: "Saved deep-sleep result",
      plainLanguage: "The saved outcome keeps its original biomarker identity.",
    },
    confidence: { level: "medium", reasons: ["Two measured windows."] },
    confounders: [],
    effectiveProtocolSnapshot: null,
    experiment: {
      id: input.experimentId,
      slug: input.slug,
      status: "completed",
      title: "Saved experiment",
    },
    generatedAt: "2026-03-15T12:00:00.000Z",
    metricResults: [{
      baseline: { daysWithData: 1, mean: 62, totalDays: 7, unit: "min" },
      baselineDayCount: 1,
      baselineMean: 62,
      biomarkerKey: "biomarker:deep-sleep-minutes",
      completeness: "partial",
      deltaAbs: -2,
      deltaPct: -3.23,
      expectedDirection: "decrease",
      intervention: { daysWithData: 1, mean: 60, totalDays: 7, unit: "min" },
      interventionDayCount: 1,
      interventionMean: 60,
      label: "Deep Sleep Minutes",
      movedAsExpected: true,
      ...(input.schemaVersion === "murph.experiment-outcome.v2"
        ? {
            points: [
              { date: "2026-03-01", phase: "baseline" as const, unit: "min", value: 62 },
              { date: "2026-03-08", phase: "intervention" as const, unit: "min", value: 60 },
            ],
          }
        : {}),
      unit: "min",
    }],
    outcomeId: input.outcomeId,
    protocolRef: null,
    schemaVersion: input.schemaVersion,
    windows: {
      baselineEnd: "2026-03-07",
      baselineStart: "2026-03-01",
      interventionEnd: "2026-03-14",
      interventionStart: "2026-03-08",
    },
  };
}
