import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  readHostedExecutionEnvironment,
} from "../src/env.ts";
import {
  buildHostedExecutionRuntimePlatform,
} from "../src/runtime-platform.ts";
import {
  TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
  TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM,
} from "./hosted-execution-fixtures.js";
import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  startHostedLocalJunctionStub,
  type HostedLocalJunctionStub,
} from "./helpers/hosted-local-junction-support.js";

const userId = `member_local_junction_link_${Date.now()}`;
const privyUserId = "privy_user_local_junction_link_connect";
const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;
const junctionApiKey = "sk_us_synthetic_junction_api_key";
const junctionClientUserIdSecret = "synthetic-junction-client-user-id-secret";

let junctionStub: HostedLocalJunctionStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

describe("hosted local junction link connect e2e", () => {
  beforeAll(async () => {
    junctionStub = await startHostedLocalJunctionStub();
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        DEVICE_SYNC_SECRET: "synthetic-device-sync-runtime-secret",
        HOSTED_CRYPTO_ENV: "test",
        HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION:
          TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
        HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
          TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM,
        HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME:
          "projects/test/locations/global/keyRings/ring/cryptoKeys/web-wrap",
        JUNCTION_API_BASE_URL: junctionStub.baseUrl,
        JUNCTION_API_KEY: junctionApiKey,
        JUNCTION_CLIENT_USER_ID_SECRET: junctionClientUserIdSecret,
        JUNCTION_ENV: "sandbox",
        JUNCTION_PROVIDER_FILTER: "oura",
        JUNCTION_REGION: "us",
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        // The Next server self-reports request URLs with the `localhost`
        // hostname, and the browser-callback guard requires the app-session
        // request hostname to equal the DEVICE_SYNC_PUBLIC_BASE_URL hostname.
        // Bind the web host to `localhost` so the harness-derived public URLs,
        // the CSRF origin, and the self-reported request hostname all agree.
        MURPH_DEV_WEB_HOST: "localhost",
      },
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-junction-link-",
      requiredRunnerEnvProfile: "assistant",
      scenarioLabel: "Local hosted Junction Link connect e2e",
      streamLogs: streamDevLogs,
    });
  }, 600_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await junctionStub?.stop();
    junctionStub = null;
  }, 120_000);

  it("completes the full web Junction Link connect flow into an active source_confirmed connection", async () => {
    const activeScenario = requireScenario();
    const stub = requireJunctionStub();
    const webBaseUrl = activeScenario.harness.webBaseUrl;
    await activeScenario.seedActiveHostedMember({ memberId: userId });
    const session = await activeScenario.issueHostedAppSession({
      memberId: userId,
      privyUserId,
    });
    const sessionCookie = `${session.cookieName}=${session.cookieValue}`;

    await acceptHostedLaunchConsents({
      sessionCookie,
      webBaseUrl,
    });

    // Mint the assistant-shaped device connect intent through the hosted
    // runtime platform port, exactly like a hosted assistant turn would.
    const hostedExecutionEnvironment = readHostedExecutionEnvironment(
      requireHostedWorkerRuntimeEnv(),
    );
    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: userId,
      webCallbackSigning: hostedExecutionEnvironment.webCallbackSigning,
      webControlBaseUrl: webBaseUrl,
    });
    const connectLink = await platform.deviceSyncPort?.createConnectLink({
      messagingReturnTarget: "telegram",
      connectTarget: "oura",
    });
    // The connect link surfaces the user-facing source, not the internal
    // junction provider key.
    expect(connectLink).toMatchObject({ provider: "oura", providerLabel: "Oura" });
    const connectLinkUrl = new URL(connectLink?.authorizationUrl ?? "");
    expect(connectLinkUrl.origin).toBe(webBaseUrl);
    const connectFragment = new URLSearchParams(connectLinkUrl.hash.slice(1));
    const claim = connectFragment.get("deviceConnectIntent");
    expect(claim).toMatch(/^dc_[A-Za-z0-9_-]{32}$/u);
    expect(connectFragment.get("connectSource")).toBe("oura");

    // Start the connection: this is the browser POST behind the Connect
    // button. Junction HTTP (user resolve + link token) hits the local stub.
    const startResponse = await fetch(
      `${webBaseUrl}/device/connect/${encodeURIComponent(claim ?? "")}`,
      {
        headers: {
          accept: "application/json",
          cookie: sessionCookie,
          origin: webBaseUrl,
        },
        method: "POST",
      },
    );
    const startBody = await startResponse.json() as { authorizationUrl?: string };
    expect(startResponse.status, JSON.stringify(startBody)).toBe(200);
    expect(startBody.authorizationUrl).toBe("https://link.tryvital.io/?token=hosted-local-junction-stub");
    expect(stub.linkTokenRequests).toHaveLength(1);
    expect(stub.linkTokenRequests[0]).toMatchObject({
      provider: "oura",
      userId: stub.junctionUserId,
    });

    const callbackProofCookie = readSetCookiePair(
      startResponse,
      "murph-device-sync-junction",
    );

    // The redirect_url Murph handed Junction carries the murph_state the
    // callback route requires; extract it the way the provider redirect would
    // replay it.
    const redirectUrl = new URL(stub.linkTokenRequests[0]?.redirectUrl ?? "");
    expect(`${redirectUrl.protocol}//${redirectUrl.host}`).toBe(webBaseUrl);
    const murphState = redirectUrl.searchParams.get("murph_state");
    expect(murphState).toMatch(/^[A-Za-z0-9_-]{16,128}$/u);

    // Simulate the provider redirect back through the exact callback URL
    // Murph handed Junction. The callback GET owns completion directly; there
    // is no browser confirmation page or secondary POST route.
    redirectUrl.searchParams.set("user_id", stub.junctionUserId);
    redirectUrl.searchParams.set("success", "true");
    const completeResponse = await fetch(redirectUrl, {
      headers: {
        cookie: `${sessionCookie}; ${callbackProofCookie}`,
      },
      redirect: "manual",
    });
    const completeLocation = completeResponse.headers.get("location") ?? "";
    expect(
      completeResponse.status,
      `complete response was not a redirect: ${await completeResponse.text()}`,
    ).toBe(302);
    expect(completeLocation).toContain("deviceSyncStatus=connected");
    expect(completeLocation).not.toContain("deviceSyncError");

    // The regression this scenario guards: the callback used to throw
    // DEVICE_SYNC_JOB_PAYLOAD_INVALID while enqueueing initial jobs and left
    // the connection setup_phase=failed with a lastErrorCode.
    const connection = await activeScenario.readHostedDeviceSyncConnection({
      memberId: userId,
      provider: "junction",
    });
    expect(connection).toMatchObject({
      lastErrorCode: null,
      lastErrorMessage: null,
      provider: "junction",
      setupPhase: "source_confirmed",
      status: "active",
    });
    expect(connection.sources).toEqual([
      expect.objectContaining({
        sourceProviderSlug: "oura",
        status: "connected",
      }),
    ]);
    expect(activeScenario.harness.stderrTail()).not.toContain(
      "No device sync providers are configured",
    );
  }, 300_000);
});

async function acceptHostedLaunchConsents(input: {
  sessionCookie: string;
  webBaseUrl: string;
}): Promise<void> {
  const statusResponse = await fetch(`${input.webBaseUrl}/api/legal/consent/status`, {
    headers: {
      cookie: input.sessionCookie,
    },
  });
  const status = await statusResponse.json() as {
    scopes?: Array<{
      documents: Array<{ id: string; version: string }>;
      scope: string;
    }>;
  };
  if (statusResponse.status !== 200) {
    throw new Error(`Hosted consent status failed: ${JSON.stringify(status)}`);
  }

  for (const scope of ["launch.legal", "launch.health-data"]) {
    const scopeStatus = status.scopes?.find((candidate) => candidate.scope === scope);
    if (!scopeStatus) {
      throw new Error(`Hosted consent status did not include scope ${scope}.`);
    }

    const acceptedDocumentVersions = Object.fromEntries(
      scopeStatus.documents.map((document) => [document.id, document.version]),
    );
    const acceptResponse = await fetch(`${input.webBaseUrl}/api/legal/consent/accept`, {
      body: JSON.stringify({
        acceptedDocumentVersions,
        scope,
        source: "hosted-local-e2e",
      }),
      headers: {
        "content-type": "application/json",
        cookie: input.sessionCookie,
        origin: input.webBaseUrl,
      },
      method: "POST",
    });
    if (acceptResponse.status !== 200) {
      throw new Error(
        `Hosted consent accept for ${scope} failed: ${await acceptResponse.text()}`,
      );
    }
  }
}

function readSetCookiePair(response: Response, cookieName: string): string {
  const setCookies = response.headers.getSetCookie();
  const match = setCookies
    .map((cookie) => cookie.split(";")[0]?.trim() ?? "")
    .find((pair) => pair.startsWith(`${cookieName}=`));
  if (!match) {
    throw new Error(
      `Expected a ${cookieName} Set-Cookie on the connect start response; saw: ${
        setCookies.map((cookie) => cookie.split("=")[0]).join(", ")
      }`,
    );
  }

  return match;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local full-stack scenario was not initialized.");
  }

  return scenario;
}

function requireJunctionStub(): HostedLocalJunctionStub {
  if (!junctionStub) {
    throw new Error("Hosted local Junction stub was not initialized.");
  }

  return junctionStub;
}

function requireHostedWorkerRuntimeEnv(): NodeJS.ProcessEnv {
  const workerRuntimeEnv = requireScenario().harness.workerRuntimeEnv;

  if (!workerRuntimeEnv) {
    throw new Error("Hosted local worker runtime environment was not initialized.");
  }

  return workerRuntimeEnv;
}
