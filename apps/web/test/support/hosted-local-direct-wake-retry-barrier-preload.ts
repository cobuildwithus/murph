const EXPECTED_PROFILE_PREFIX = "e2e:";
const TEST_ROUTES_ENABLED = "1";
const CONTROL_REQUEST_TIMEOUT_MS = 120_000;

interface HostedLocalDirectWakeRetryBarrierConfig {
  barrierUrl: URL;
  expectedUserId: string;
}

const config = readHostedLocalDirectWakeRetryBarrierConfig(process.env);
const originalFetch = globalThis.fetch;
const directRequestCounts = new Map<string, number>();

export {};

globalThis.fetch = async (input, init): Promise<Response> => {
  const orchestrationAttemptId = readMatchingDirectWakeAttemptId({
    config,
    init,
    input,
  });
  if (orchestrationAttemptId) {
    const attemptNumber = (directRequestCounts.get(orchestrationAttemptId) ?? 0) + 1;
    directRequestCounts.set(orchestrationAttemptId, attemptNumber);
    if (attemptNumber === 2) {
      await waitForHostedLocalDirectWakeRetryRelease({
        barrierUrl: config.barrierUrl,
        signal: init?.signal,
      });
    }
  }

  return await originalFetch(input, init);
};

function readHostedLocalDirectWakeRetryBarrierConfig(
  source: Readonly<NodeJS.ProcessEnv>,
): HostedLocalDirectWakeRetryBarrierConfig {
  if (
    source.MURPH_HOSTED_LOCAL_PROFILE?.startsWith(EXPECTED_PROFILE_PREFIX) !== true
    || source.MURPH_HOSTED_LOCAL_TEST_ROUTES !== TEST_ROUTES_ENABLED
  ) {
    throw new Error(
      "The direct-wake retry barrier preload requires the hosted-local E2E test-control profile.",
    );
  }

  const expectedUserId = source
    .MURPH_HOSTED_LOCAL_DIRECT_WAKE_RETRY_BARRIER_USER_ID
    ?.trim();
  if (!expectedUserId) {
    throw new Error(
      "MURPH_HOSTED_LOCAL_DIRECT_WAKE_RETRY_BARRIER_USER_ID is required.",
    );
  }

  const barrierUrlValue = source
    .MURPH_HOSTED_LOCAL_DIRECT_WAKE_RETRY_BARRIER_URL
    ?.trim();
  if (!barrierUrlValue) {
    throw new Error(
      "MURPH_HOSTED_LOCAL_DIRECT_WAKE_RETRY_BARRIER_URL is required.",
    );
  }
  const barrierUrl = new URL(barrierUrlValue);
  if (
    barrierUrl.protocol !== "http:"
    || barrierUrl.hostname !== "127.0.0.1"
  ) {
    throw new Error("The direct-wake retry barrier must use loopback HTTP.");
  }

  return { barrierUrl, expectedUserId };
}

function readMatchingDirectWakeAttemptId(input: {
  config: HostedLocalDirectWakeRetryBarrierConfig;
  init?: RequestInit;
  input: Parameters<typeof fetch>[0];
}): string | null {
  const url = readRequestUrl(input.input);
  if (
    !url
    || url.pathname !== `/internal/users/${encodeURIComponent(input.config.expectedUserId)}`
      + "/runtime/ensure-processing"
    || typeof input.init?.body !== "string"
  ) {
    return null;
  }

  try {
    const body: unknown = JSON.parse(input.init.body);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }
    const orchestrationAttemptId = Reflect.get(body, "orchestrationAttemptId");
    return typeof orchestrationAttemptId === "string"
      && /^web-ingress-[0-9a-f-]{36}$/u.test(orchestrationAttemptId)
      ? orchestrationAttemptId
      : null;
  } catch {
    return null;
  }
}

function readRequestUrl(input: Parameters<typeof fetch>[0]): URL | null {
  try {
    if (typeof input === "string" || input instanceof URL) {
      return new URL(input);
    }
    return new URL(input.url);
  } catch {
    return null;
  }
}

async function waitForHostedLocalDirectWakeRetryRelease(input: {
  barrierUrl: URL;
  signal: AbortSignal | null | undefined;
}): Promise<void> {
  const signals = [AbortSignal.timeout(CONTROL_REQUEST_TIMEOUT_MS)];
  if (input.signal) {
    signals.push(input.signal);
  }
  const response = await originalFetch(input.barrierUrl, {
    method: "POST",
    signal: AbortSignal.any(signals),
  });
  if (!response.ok) {
    throw new Error(
      `Hosted-local direct-wake retry barrier returned HTTP ${response.status}.`,
    );
  }
}
