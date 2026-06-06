import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import type { HostedRuntimeDemand } from "@murphai/hosted-execution/orchestration-control";

import { readRuntimeDemand } from "../src/activities/read-runtime-demand.js";

describe("readRuntimeDemand", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("calls the hosted web demand endpoint with signed pointer-only query flags", async () => {
    await stubHostedWebEnvironment();

    const demand: HostedRuntimeDemand = {
      kind: "run",
      mailboxLag: [],
      reason: "nudge",
      source: "mailbox_backlog",
      workspace: {
        nextWakeAt: "2026-05-20T12:05:00.000Z",
        nextWakeReason: "assistant",
        version: "7",
      },
    };
    const observedRequests: ObservedRequest[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      observedRequests.push({ init, url: String(url) });
      return jsonResponse(demand);
    }));

    await expect(readRuntimeDemand({
      browserVaultRefreshRequested: true,
      lagRecoveryObserved: true,
      manualRunRequested: true,
      userId: "member_test",
    })).resolves.toEqual(demand);

    expect(observedRequests).toHaveLength(1);
    const request = observedRequests[0];
    const url = new URL(request.url);
    const headers = new Headers(request.init?.headers);

    expect(url.origin).toBe("https://web.example.test");
    expect(url.pathname).toBe(
      "/api/internal/hosted-orchestration/users/member_test/demand",
    );
    expect(url.searchParams.get("manualRunRequested")).toBe("1");
    expect(url.searchParams.get("browserVaultRefreshRequested")).toBe("1");
    expect(url.searchParams.get("lagRecoveryObserved")).toBe("1");
    expect(url.searchParams.has("deviceSyncRecoveryRequested")).toBe(false);
    expect(request.init?.method).toBe("GET");
    expect(headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("member_test");
    expect(headers.get(HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER)).toBe("test-key");
    expect(headers.has(HOSTED_EXECUTION_SIGNATURE_HEADER)).toBe(true);
    expect(request.init?.body).toBeUndefined();
  });

  it("omits false demand flags from the query string", async () => {
    await stubHostedWebEnvironment();

    const demand: HostedRuntimeDemand = {
      kind: "idle",
      mailboxLag: [],
      nextWakeAt: null,
      workspace: null,
    };
    const observedRequests: ObservedRequest[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      observedRequests.push({ init, url: String(url) });
      return jsonResponse(demand);
    }));

    await expect(readRuntimeDemand({
      browserVaultRefreshRequested: false,
      manualRunRequested: false,
      userId: "member_test",
    })).resolves.toEqual(demand);

    const url = new URL(observedRequests[0].url);
    expect(url.search).toBe("");
  });

  it("rejects invalid hosted web demand responses", async () => {
    await stubHostedWebEnvironment();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      kind: "run",
      mailboxLag: [],
      reason: "nudge",
      source: "mailbox_backlog",
      workspace: {
        nextWakeAt: null,
        nextWakeReason: null,
        redactedStatus: {},
        version: "7",
      },
    })));

    await expect(readRuntimeDemand({
      userId: "member_test",
    })).rejects.toThrow(
      "Hosted runtime demand workspace projection must not include redactedStatus.",
    );
  });

  it("rejects malformed demand timeout values with numeric suffixes", async () => {
    await stubHostedWebEnvironment();
    vi.stubEnv("HOSTED_RUNTIME_DEMAND_TIMEOUT_MS", "10000ms");

    await expect(readRuntimeDemand({
      userId: "member_test",
    })).rejects.toThrow(
      "HOSTED_RUNTIME_DEMAND_TIMEOUT_MS must be a positive integer.",
    );
  });
});

interface ObservedRequest {
  init: RequestInit | undefined;
  url: string;
}

async function stubHostedWebEnvironment(): Promise<void> {
  vi.stubEnv("HOSTED_WEB_BASE_URL", "https://web.example.test");
  vi.stubEnv("HOSTED_WEB_CALLBACK_SIGNING_KEY_ID", "test-key");
  vi.stubEnv(
    "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
    await createEphemeralPrivateJwkJson(),
  );
}

async function createEphemeralPrivateJwkJson(): Promise<string> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    true,
    ["sign", "verify"],
  );
  return JSON.stringify(await crypto.subtle.exportKey("jwk", keyPair.privateKey));
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    status,
  });
}
