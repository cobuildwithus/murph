import { afterEach, describe, expect, it, vi } from "vitest";

const expectedUserId = "member_retry_barrier_test";
const orchestrationAttemptId =
  "web-ingress-11111111-2222-4333-8444-555555555555";
const ensureUrl = `http://127.0.0.1:8787/internal/users/${expectedUserId}`
  + "/runtime/ensure-processing";
const barrierUrl = "http://127.0.0.1:8788/direct-wake-retry/test-token";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("hosted-local direct-wake retry barrier preload", () => {
  it("keeps the second correlated ensure inside Web until explicit release", async () => {
    vi.stubEnv("MURPH_HOSTED_LOCAL_PROFILE", "e2e:stub");
    vi.stubEnv("MURPH_HOSTED_LOCAL_TEST_ROUTES", "1");
    vi.stubEnv(
      "MURPH_HOSTED_LOCAL_DIRECT_WAKE_RETRY_BARRIER_USER_ID",
      expectedUserId,
    );
    vi.stubEnv("MURPH_HOSTED_LOCAL_DIRECT_WAKE_RETRY_BARRIER_URL", barrierUrl);

    let resolveBarrier!: (response: Response) => void;
    const barrierResponse = new Promise<Response>((resolve) => {
      resolveBarrier = resolve;
    });
    const originalFetch = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === barrierUrl) {
        return await barrierResponse;
      }
      return new Response(null, { status: 202 });
    });
    vi.stubGlobal("fetch", originalFetch);
    await import("./support/hosted-local-direct-wake-retry-barrier-preload");

    const request = {
      body: JSON.stringify({ orchestrationAttemptId }),
      method: "POST",
    } satisfies RequestInit;
    await expect(fetch(ensureUrl, request)).resolves.toMatchObject({ status: 202 });

    let secondSettled = false;
    const secondRequest = fetch(ensureUrl, request).finally(() => {
      secondSettled = true;
    });
    await vi.waitFor(() => expect(originalFetch).toHaveBeenCalledTimes(2));
    expect(originalFetch.mock.calls.map(([input]) => String(input))).toEqual([
      ensureUrl,
      barrierUrl,
    ]);
    expect(secondSettled).toBe(false);

    resolveBarrier(new Response(null, { status: 204 }));
    await expect(secondRequest).resolves.toMatchObject({ status: 202 });
    expect(originalFetch.mock.calls.map(([input]) => String(input))).toEqual([
      ensureUrl,
      barrierUrl,
      ensureUrl,
    ]);
  });

  it("fails closed when imported outside the hosted-local test profile", async () => {
    vi.stubEnv("MURPH_HOSTED_LOCAL_PROFILE", "production");
    vi.stubEnv("MURPH_HOSTED_LOCAL_TEST_ROUTES", "0");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>());

    await expect(import(
      "./support/hosted-local-direct-wake-retry-barrier-preload"
    )).rejects.toThrow(
      "requires the hosted-local E2E test-control profile",
    );
  });
});
