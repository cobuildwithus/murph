import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_CALLBACK_USER_ID,
  HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_PATH,
} from "@murphai/hosted-execution/routes";

import {
  runHostedDeviceSyncRecoverySweep,
} from "../src/activities/run-device-sync-recovery-sweep.js";

describe("runHostedDeviceSyncRecoverySweep", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts a signed pointer-only recovery command to hosted web", async () => {
    await stubHostedWebEnvironment();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const observedRequests: ObservedRequest[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      observedRequests.push({ init, url: String(url) });
      return jsonResponse(buildRecoverySweepResponse());
    }));

    await expect(runHostedDeviceSyncRecoverySweep()).resolves.toEqual(
      buildRecoverySweepResponse(),
    );

    expect(observedRequests).toHaveLength(1);
    const request = observedRequests[0];
    const url = new URL(request.url);
    const headers = new Headers(request.init?.headers);

    expect(url.origin).toBe("https://web.example.test");
    expect(url.pathname).toBe(HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_PATH);
    expect(request.init?.method).toBe("POST");
    expect(headers.has("authorization")).toBe(false);
    expect(headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe(
      HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_CALLBACK_USER_ID,
    );
    expect(headers.get(HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER)).toBe("test-key");
    expect(headers.has(HOSTED_EXECUTION_SIGNATURE_HEADER)).toBe(true);
    expect(String(request.init?.body)).toBe("{}");
    expect(String(request.init?.body)).not.toContain("connectionId");
    expect(String(request.init?.body)).not.toContain("provider");
    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
  });

  it("uses the bounded device-sync recovery timeout override", async () => {
    await stubHostedWebEnvironment();
    vi.stubEnv("HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_TIMEOUT_MS", "45000");
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse(buildRecoverySweepResponse())
    ));

    await runHostedDeviceSyncRecoverySweep();

    expect(timeoutSpy).toHaveBeenCalledWith(45_000);
  });

  it("rejects invalid recovery sweep responses as non-retryable protocol errors", async () => {
    await stubHostedWebEnvironment();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      dueReconcileSweeper: {},
    })));

    await expect(runHostedDeviceSyncRecoverySweep()).rejects.toMatchObject({
      message: expect.stringContaining("response was invalid"),
      nonRetryable: true,
      type: "hosted_orchestrator_invalid_protocol_response",
    });
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

function buildRecoverySweepResponse() {
  return {
    dueReconcileSweeper: {
      dueConnections: 2,
      recoveryAttempted: 2,
      recoveryFailed: 0,
      recoveryLimit: 25,
      recoveryNotRequested: 0,
      recoveryRequested: 2,
      skippedDueConnections: 0,
    },
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    status,
  });
}
