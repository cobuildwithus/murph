import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedRuntimeReconciliationFacts,
} from "@murphai/hosted-execution/orchestration-control";

import {
  readRuntimeReconciliationFacts,
} from "../src/activities/read-runtime-reconciliation-facts.js";

describe("readRuntimeReconciliationFacts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("calls the hosted web reconciliation endpoint with signed user scope", async () => {
    await stubHostedWebEnvironment();

    const facts: HostedRuntimeReconciliationFacts = {
      blocked: null,
      mailboxLag: [],
      workspace: {
        inboxMediaRetentionWakeAt: null,
        nextWakeAt: "2026-05-20T12:05:00.000Z",
        nextWakeReason: "assistant",
        version: "7",
      },
    };
    const observedRequests: ObservedRequest[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      observedRequests.push({ init, url: String(url) });
      return jsonResponse(facts);
    }));

    await expect(readRuntimeReconciliationFacts({
      userId: "member_test",
    })).resolves.toEqual(facts);

    expect(observedRequests).toHaveLength(1);
    const request = observedRequests[0];
    const url = new URL(request.url);
    const headers = new Headers(request.init?.headers);

    expect(url.origin).toBe("https://web.example.test");
    expect(url.pathname).toBe(
      "/api/internal/hosted-orchestration/users/member_test/reconciliation-facts",
    );
    expect(url.search).toBe("");
    expect(request.init?.method).toBe("GET");
    expect(headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("member_test");
    expect(headers.get(HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER)).toBe("test-key");
    expect(headers.has(HOSTED_EXECUTION_SIGNATURE_HEADER)).toBe(true);
    expect(request.init?.body).toBeUndefined();
  });

  it("rejects invalid hosted web reconciliation responses", async () => {
    await stubHostedWebEnvironment();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      blocked: null,
      mailboxLag: [],
      workspace: {
        inboxMediaRetentionWakeAt: null,
        nextWakeAt: null,
        nextWakeReason: null,
        redactedStatus: {},
        version: "7",
      },
    })));

    await expect(readRuntimeReconciliationFacts({
      userId: "member_test",
    })).rejects.toThrow(
      "Hosted runtime reconciliation facts workspace must not include redactedStatus.",
    );
  });

  it("rejects malformed reconciliation timeout values with numeric suffixes", async () => {
    await stubHostedWebEnvironment();
    vi.stubEnv("HOSTED_RUNTIME_RECONCILIATION_FACTS_TIMEOUT_MS", "10000ms");

    await expect(readRuntimeReconciliationFacts({
      userId: "member_test",
    })).rejects.toThrow(
      "HOSTED_RUNTIME_RECONCILIATION_FACTS_TIMEOUT_MS must be a positive integer.",
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
