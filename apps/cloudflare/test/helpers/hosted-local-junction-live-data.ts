import { setTimeout as delay } from "node:timers/promises";

import { JunctionClient } from "@murphai/device-syncd/providers/junction-client";
import { buildCloudflareHostedControlUserStatusPath } from "@murphai/cloudflare-hosted-control/routes";
import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution/contracts";
import { parseHostedRunnerStatusResponse } from "@murphai/hosted-execution/parsers";
import {
  getHostedBrowserVaultReplicaStorageKeyId,
  type HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/browser-vault";
import { createBrowserVaultQueryClient, parseBrowserVaultReplica } from "@murphai/query/browser";
import {
  buildHostedStorageAad,
  decryptHostedStoragePayload,
  generateHostedUserRecipientKeyPair,
  parseHostedBrowserSessionKeyEnvelope,
  parseHostedCipherEnvelope,
  unwrapHostedBrowserSessionKey,
} from "@murphai/runtime-state";

import type { HostedLocalFullStackScenario } from "./hosted-local-full-stack-scenario.js";

export interface GarminStepExpectation {
  date: string;
  value: number;
}

// The oracle reads documented provider fields independently of Murph's importer.
// Exclude the most recent UTC day too, so every eligible calendar day is closed
// even for a provider west of UTC. Values and dates remain process-local.
export function readGarminStepExpectations(
  records: readonly unknown[],
  window: { from: string; to: string },
): GarminStepExpectation[] {
  return records.flatMap((value) => {
    const record = readRecord(value);
    const source = readRecord(record?.source);
    const provider = source?.provider ?? source?.slug;
    const date = record?.calendarDate ?? record?.calendar_date;
    const steps = record?.steps;
    if (
      provider !== "garmin"
      || typeof date !== "string"
      || !/^\d{4}-\d{2}-\d{2}$/u.test(date)
      || date < window.from
      || date > window.to
      || typeof steps !== "number"
      || !Number.isSafeInteger(steps)
      || steps <= 0
    ) return [];
    return [{ date, value: steps }];
  }).sort((left, right) => right.date.localeCompare(left.date));
}

export function hasCanonicalGarminSteps(
  replica: unknown,
  expected: readonly GarminStepExpectation[],
): boolean {
  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));
  return expected.some((expectation) => client.metrics.series({
    from: expectation.date,
    grain: "day",
    metricKey: "steps",
    to: expectation.date,
  }).some((row) => row.value === expectation.value
    && row.unit === "count"
    && row.sourceKind === "activity-summary"
    && row.sourceLabel === "Garmin"
    && row.recordIds.length > 0));
}

export async function assertEmptyGarminCanaryWorkspace(input: {
  memberId: string;
  scenario: HostedLocalFullStackScenario;
}): Promise<void> {
  const signal = AbortSignal.timeout(30_000);
  try {
    const status = parseHostedRunnerStatusResponse(await input.scenario.harness.requestJson<unknown>(
      `${buildCloudflareHostedControlUserStatusPath(input.memberId)}?logLimit=0`,
      { headers: { [HOSTED_EXECUTION_USER_ID_HEADER]: input.memberId }, signal },
    ));
    const ref = status.workspace?.browserVaultReplicaRef;
    if (!ref) return;
    const replica = await readCanaryBrowserVaultReplica({ ...input, ref, signal });
    const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));
    if (client.metrics.series({ metricKey: "steps" }).length === 0) return;
  } catch {
    throw new Error("MURPH_E2E_GARMIN_INITIAL_WORKSPACE_PROOF_FAILED");
  }
  throw new Error("MURPH_E2E_GARMIN_REQUIRES_EMPTY_CANONICAL_WORKSPACE");
}

export async function waitForLiveGarminCanonicalData(input: {
  client: JunctionClient;
  clientUserId: string;
  memberId: string;
  notBefore: number;
  scenario: HostedLocalFullStackScenario;
  signal: AbortSignal;
  timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs)]);
  const closedDay = new Date();
  closedDay.setUTCDate(closedDay.getUTCDate() - 2);
  const from = new Date(closedDay);
  from.setUTCDate(from.getUTCDate() - 13);
  const window = { from: from.toISOString().slice(0, 10), to: closedDay.toISOString().slice(0, 10) };
  let expected: GarminStepExpectation[] = [];
  let nextProviderRead = 0;
  let providerUserId: string | null = null;
  let observedProviderData = false;

  try {
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      if (Date.now() >= nextProviderRead) {
        providerUserId ??= (await input.client.resolveUser(input.clientUserId, { signal }))?.userId ?? null;
        if (!providerUserId) throw new Error("MURPH_E2E_GARMIN_PROVIDER_USER_MISSING");
        expected = readGarminStepExpectations(await input.client.listSummary({
          collectionWorkLimit: { maxAttemptsPerPage: 1, maxPages: 3, requestTimeoutMs: 8_000 },
          maxRecords: 100,
          resource: "activity",
          signal,
          sourceProviderSlug: "garmin",
          userId: providerUserId,
          windowEnd: window.to,
          windowStart: window.from,
        }), window);
        observedProviderData ||= expected.length > 0;
        nextProviderRead = Date.now() + 15_000;
      }
      const status = parseHostedRunnerStatusResponse(await input.scenario.harness.requestJson<unknown>(
        `${buildCloudflareHostedControlUserStatusPath(input.memberId)}?logLimit=0`,
        { headers: { [HOSTED_EXECUTION_USER_ID_HEADER]: input.memberId }, signal },
      ));
      const ref = status.workspace?.browserVaultReplicaRef;
      if (expected.length > 0 && ref && Date.parse(ref.generatedAt) >= input.notBefore) {
        const replica = await readCanaryBrowserVaultReplica({ ...input, ref, signal });
        if (hasCanonicalGarminSteps(replica, expected)) return;
      }
      await delay(3_000, undefined, { signal });
    }
  } catch {
    // Provider payloads, canonical health values, status logs and crypto errors
    // must never become CI output, including through an exception cause.
    if (!signal.aborted) throw new Error("MURPH_E2E_GARMIN_DATA_PROOF_FAILED");
  }
  throw new Error(observedProviderData
    ? "MURPH_E2E_GARMIN_CANONICAL_DATA_MISSING"
    : "MURPH_E2E_GARMIN_RECENT_PROVIDER_DATA_MISSING");
}

async function readCanaryBrowserVaultReplica(input: {
  memberId: string;
  ref: HostedBrowserVaultReplicaRef;
  scenario: HostedLocalFullStackScenario;
  signal: AbortSignal;
}): Promise<unknown> {
  const { privateKeyJwk, publicKeyJwk } = await generateHostedUserRecipientKeyPair();
  const session = await input.scenario.harness.requestJson<{
    encryptedReplica: unknown;
    replicaKeyEnvelope: unknown;
    state: string;
  }>(`/internal/users/${encodeURIComponent(input.memberId)}/browser-vault/session`, {
    body: JSON.stringify({ browserPublicKeyJwk: publicKeyJwk, replicaRef: input.ref }),
    headers: { [HOSTED_EXECUTION_USER_ID_HEADER]: input.memberId, "content-type": "application/json" },
    method: "POST",
    signal: input.signal,
  });
  if (session.state !== "ready") throw new Error("MURPH_E2E_GARMIN_REPLICA_NOT_READY");
  const key = await unwrapHostedBrowserSessionKey({
    envelope: parseHostedBrowserSessionKeyEnvelope(session.replicaKeyEnvelope),
    recipientPrivateKeyJwk: privateKeyJwk,
  });
  try {
    const plaintext = await decryptHostedStoragePayload({
      aad: buildHostedStorageAad({
        dataKeyId: input.ref.dataKeyEnvelope?.dataKeyId,
        dataKeyRootKeyId: input.ref.dataKeyEnvelope?.rootKeyId,
        dataVersion: input.ref.dataVersion,
        objectKey: input.ref.objectKey,
        purpose: "browser-vault-replica",
        runtimeRootKeyId: input.ref.runtimeRootKeyId,
        schema: "murph.browser-vault-replica",
        sourceBundleHash: input.ref.sourceBundleHash,
        userId: input.memberId,
      }),
      envelope: parseHostedCipherEnvelope(session.encryptedReplica),
      expectedKeyId: getHostedBrowserVaultReplicaStorageKeyId(input.ref),
      key,
      scope: "browser-vault-replica",
    });
    try {
      return JSON.parse(new TextDecoder().decode(plaintext));
    } finally {
      plaintext.fill(0);
    }
  } finally {
    key.fill(0);
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
