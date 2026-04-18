import {
  buildCloudflareHostedControlUserWakePath,
} from "@murphai/cloudflare-hosted-control/routes";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedExecutionWake,
  type HostedExecutionUserStatus,
  type HostedWakeAppendRequest,
  type HostedWakeAppendResponse,
  type HostedWakeStatusResponse,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedWakeAppendResponse,
} from "@murphai/hosted-execution/parsers";

import {
  fetchHostedExecutionWebControlPlaneResponse,
  readHostedWakeStatusFromWeb,
} from "../../src/web-control-plane.ts";
import {
  TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
} from "../hosted-execution-fixtures.js";
import type { HostedLocalDevHarness } from "./hosted-local-dev-harness.js";

const DEFAULT_HOSTED_WEB_CALLBACK_SIGNING_KEY_ID = "v1";
const DEFAULT_TIMEOUT_MS = 30_000;

export async function appendHostedWakeAndWakeWorker(input: {
  wake: HostedExecutionWake;
  harness: HostedLocalDevHarness;
  timeoutMs?: number;
  userId: string;
}): Promise<{
  append: HostedWakeAppendResponse;
  wakeStatus: HostedExecutionUserStatus;
}> {
  const append = await appendHostedWake(input);
  const wakeStatus = await wakeHostedWorker({
    harness: input.harness,
    targetSeqHint: append.wake.seq,
    userId: input.userId,
  });

  return {
    append,
    wakeStatus,
  };
}

export async function appendHostedWake(input: {
  wake: HostedExecutionWake;
  harness: HostedLocalDevHarness;
  timeoutMs?: number;
  userId: string;
}): Promise<HostedWakeAppendResponse> {
  const appendBody = JSON.stringify({
    wake: input.wake,
  } satisfies HostedWakeAppendRequest);
  const appendResponse = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: input.harness.webBaseUrl,
    body: appendBody,
    boundUserId: input.userId,
    callbackSigning: {
      keyId: DEFAULT_HOSTED_WEB_CALLBACK_SIGNING_KEY_ID,
      privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
    },
    method: "POST",
    path: "/api/internal/hosted-wake/append",
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  const rawAppendBody = await appendResponse.text();

  if (!appendResponse.ok) {
    throw new Error(
      `Hosted wake append failed with HTTP ${appendResponse.status}. body: ${rawAppendBody}`,
    );
  }

  return parseHostedWakeAppendResponse(
    rawAppendBody.length > 0 ? JSON.parse(rawAppendBody) : null,
  );
}

export async function wakeHostedWorker(input: {
  harness: HostedLocalDevHarness;
  targetSeqHint?: string | null;
  userId: string;
}): Promise<HostedExecutionUserStatus> {
  return await input.harness.requestJson<HostedExecutionUserStatus>(
    buildCloudflareHostedControlUserWakePath(input.userId),
    {
      headers: {
        [HOSTED_EXECUTION_USER_ID_HEADER]: input.userId,
      },
      method: "POST",
      ...(input.targetSeqHint === undefined ? {} : {
        body: JSON.stringify({
          targetSeqHint: input.targetSeqHint,
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
          [HOSTED_EXECUTION_USER_ID_HEADER]: input.userId,
        },
      }),
    },
  );
}

export async function wakeHostedWorkerForLatestPendingWake(input: {
  harness: HostedLocalDevHarness;
  timeoutMs?: number;
  userId: string;
}): Promise<HostedExecutionUserStatus> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  let lastStatus: HostedExecutionUserStatus | null = null;

  while ((Date.now() - startedAt) < timeoutMs) {
    const status = await readHostedWakeStatus(input);

    if (status.pendingWakeCount > 0) {
      const targetSeqHint = deriveLatestPendingWakeSeq(status);
      lastStatus = await wakeHostedWorker({
        harness: input.harness,
        targetSeqHint,
        userId: input.userId,
      });
      await sleep(100);
      continue;
    }

    if (lastStatus) {
      return lastStatus;
    }

    await sleep(100);
  }

  if (lastStatus) {
    return lastStatus;
  }

  return await wakeHostedWorker({
    harness: input.harness,
    userId: input.userId,
  });
}

async function readHostedWakeStatus(input: {
  harness: HostedLocalDevHarness;
  userId: string;
}): Promise<HostedWakeStatusResponse> {
  return await readHostedWakeStatusFromWeb({
    baseUrl: input.harness.webBaseUrl,
    boundUserId: input.userId,
    callbackSigning: {
      keyId: DEFAULT_HOSTED_WEB_CALLBACK_SIGNING_KEY_ID,
      privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
    },
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
}

function deriveLatestPendingWakeSeq(status: HostedWakeStatusResponse): string {
  const latestPendingSeq = BigInt(status.cursor.nextSeq) - 1n;
  return latestPendingSeq.toString();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
