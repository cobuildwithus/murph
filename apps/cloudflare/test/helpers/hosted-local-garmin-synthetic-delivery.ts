import { randomInt, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import type { JunctionClient } from "@murphai/device-syncd/providers/junction-client";
import { buildCloudflareHostedControlUserStatusPath } from "@murphai/cloudflare-hosted-control/routes";
import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution/contracts";
import { parseHostedRunnerStatusResponse } from "@murphai/hosted-execution/parsers";

import type { HostedLocalFullStackScenario } from "./hosted-local-full-stack-scenario.js";
import { hasCanonicalGarminSteps, readCanaryBrowserVaultReplica } from "./hosted-local-junction-live-data.js";
import { buildSignedJunctionWebhookBody, createSignedJunctionSvixWebhook } from "./junction-webhook-replay.js";

export function buildSyntheticGarminActivity(now: Date) {
  const day = new Date(now);
  day.setUTCDate(day.getUTCDate() - 2);
  const date = day.toISOString().slice(0, 10);
  return {
    calendar_date: date,
    date: `${date}T00:00:00.000Z`,
    id: `synthetic-garmin-${randomUUID()}`,
    source: { provider: "garmin", type: "watch" },
    steps: randomInt(2000, 20000),
    timezone_offset: 0,
  };
}

// Mock only delivery into the local public ingress. Connection resolution,
// signature verification, scheduling, import, storage, and readback stay real.
export async function proveSyntheticGarminDelivery(input: {
  client: Pick<JunctionClient, "resolveUser">;
  clientUserId: string;
  memberId: string;
  scenario: { harness: Pick<HostedLocalFullStackScenario["harness"], "requestJson" | "webBaseUrl"> };
  signal: AbortSignal;
  timeoutMs: number;
  webhookSecret: string;
}): Promise<"synthetic_webhook_matched"> {
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs)]);
  try {
    signal.throwIfAborted();
    const base = new URL(input.scenario.harness.webBaseUrl);
    if (base.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
      || base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
      throw new Error("Synthetic delivery requires a local harness.");
    }
    const user = await input.client.resolveUser(input.clientUserId, { signal });
    signal.throwIfAborted();
    if (!user?.userId) throw new Error("Connected Junction user missing.");
    const record = buildSyntheticGarminActivity(new Date());
    const webhook = createSignedJunctionSvixWebhook({
      body: buildSignedJunctionWebhookBody({
        externalAccountId: user.userId,
        dirtyResource: {
          resource: "activity",
          sourceProviderSlug: "garmin",
          payload: {
            eventType: "daily.data.activity.created",
            objectId: record.id,
            webhookDataJson: JSON.stringify(record),
          },
        },
      }),
      messageId: `msg_synthetic_garmin_${randomUUID()}`,
      webhookSecret: input.webhookSecret,
    });
    webhook.headers.set("content-type", "application/json");
    const expected = [{ date: record.calendar_date, value: record.steps }];
    const readReplicaRef = async () => {
      const status = parseHostedRunnerStatusResponse(await input.scenario.harness.requestJson<unknown>(
        `${buildCloudflareHostedControlUserStatusPath(input.memberId)}?logLimit=0`,
        { headers: { [HOSTED_EXECUTION_USER_ID_HEADER]: input.memberId }, signal },
      ));
      return status.workspace?.browserVaultReplicaRef;
    };
    // The scenario owns a fresh member and isolated vault. If its initial
    // replica already exists, reject a matching value before injecting too.
    const baselineRef = await readReplicaRef();
    if (baselineRef) {
      const baseline = await readCanaryBrowserVaultReplica({ ...input, ref: baselineRef, signal });
      if (hasCanonicalGarminSteps(baseline, expected)) throw new Error("Fixture already present.");
    }
    signal.throwIfAborted();
    const notBefore = Date.now();
    const response = await fetch(new URL("/api/device-sync/webhooks/junction", base), {
      body: webhook.rawBody.toString("utf8"),
      headers: webhook.headers,
      method: "POST",
      redirect: "error",
      signal,
    });
    const receipt = await response.json() as { accepted?: unknown; duplicate?: unknown; orphaned?: unknown; queued?: unknown };
    if (!response.ok || receipt.accepted !== true || receipt.duplicate === true || receipt.orphaned === true) {
      throw new Error("Synthetic webhook was not admitted.");
    }
    while (!signal.aborted) {
      const ref = await readReplicaRef();
      if (ref && Date.parse(ref.generatedAt) >= notBefore) {
        const replica = await readCanaryBrowserVaultReplica({ ...input, ref, signal });
        signal.throwIfAborted();
        if (hasCanonicalGarminSteps(replica, expected)) return "synthetic_webhook_matched";
      }
      await delay(3_000, undefined, { signal });
    }
  } catch {
    // Never expose real account identity, provider errors, or vault contents.
  }
  throw new Error("MURPH_E2E_GARMIN_SYNTHETIC_DELIVERY_PROOF_FAILED");
}
