import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  buildHostedExecutionMemberActivatedDispatch,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionDispatchResult,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_EXECUTION_DISPATCH_PATH,
} from "@murphai/hosted-execution/routes";

import { runSmokeHostedDeploy } from "../scripts/smoke-hosted-deploy.shared.js";
import {
  startHostedLocalDevHarness,
  type HostedLocalDevHarness,
} from "./helpers/hosted-local-dev-harness.js";

const userId = `member_local_e2e_${Date.now()}`;
const activationDispatch = buildHostedExecutionMemberActivatedDispatch({
  eventId: `member.activated:local:${userId}:evt_local_e2e`,
  memberId: userId,
  memberChannels: {
    email: false,
    linq: false,
    telegram: false,
  },
  occurredAt: new Date().toISOString(),
});
const devEnv: NodeJS.ProcessEnv = {
  ...process.env,
  MURPH_DEV_SKIP_PRISMA_MIGRATE: "1",
  MURPH_DEV_WEB_PORT: "3212",
  MURPH_DEV_WORKER_PORT: "8901",
  NEXT_DIST_DIR_MODE: "smoke",
};

let localHarness: HostedLocalDevHarness | null = null;

describe("hosted local end-to-end", () => {
  beforeAll(async () => {
    localHarness = await startHostedLocalDevHarness({
      env: devEnv,
      persistDirPrefix: "murph-hosted-local-e2e-",
      statusHeaders: (nextUserId: string) => ({
        [HOSTED_EXECUTION_USER_ID_HEADER]: nextUserId,
      }),
    });
  });

  afterAll(async () => {
    await localHarness?.stop();
    localHarness = null;
  });

  it("bootstraps a member and completes a follow-up manual run through the live local stack", async () => {
    const harness = requireHarness();
    const activationResult = parseHostedExecutionDispatchResult(await harness.requestJson(
      HOSTED_EXECUTION_DISPATCH_PATH,
      {
      body: JSON.stringify(activationDispatch),
      headers: {
        "content-type": "application/json; charset=utf-8",
        [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
      },
      method: "POST",
      },
    ));
    expect(activationResult.event.eventId).toBe(activationDispatch.eventId);

    const activatedStatus = await harness.waitForHostedCompletion(userId);
    expect(activatedStatus.bundleRef).not.toBeNull();
    expect(activatedStatus.lastError).toBeNull();
    expect(activatedStatus.pendingEventCount).toBe(0);

    await runSmokeHostedDeploy({
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_OIDC_TOKEN: harness.oidcToken,
        HOSTED_EXECUTION_SMOKE_STATUS_POLL_INTERVAL_MS: "1000",
        HOSTED_EXECUTION_SMOKE_STATUS_TIMEOUT_MS: "180000",
        HOSTED_EXECUTION_SMOKE_USER_ID: userId,
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: harness.workerBaseUrl,
      },
    });

    const finalStatus = await harness.readUserStatus(userId);
    expect(finalStatus.bundleRef).not.toBeNull();
    expect(finalStatus.lastError).toBeNull();
    expect(finalStatus.pendingEventCount).toBe(0);
  });
});

function requireHarness(): HostedLocalDevHarness {
  if (!localHarness) {
    throw new Error("Hosted local harness was not initialized.");
  }

  return localHarness;
}
