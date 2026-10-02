import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as core from "@murphai/core";
import { importDeviceProviderSnapshot } from "@murphai/importers";
import { buildMetricProjection, readVault, readVaultRawTolerant } from "@murphai/query";
import { createBrowserVaultReplica } from "@murphai/query/browser";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as liveData from "./helpers/hosted-local-junction-live-data.js";
import { proveSyntheticGarminDelivery } from "./helpers/hosted-local-garmin-synthetic-delivery.js";

const failure = "MURPH_E2E_GARMIN_SYNTHETIC_DELIVERY_PROOF_FAILED";

describe("synthetic Garmin delivery proof", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  function setup() {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ accepted: true, duplicate: false }));
    vi.stubGlobal("fetch", fetchMock);
    const status = { inFlight: false, mailboxLag: [], userId: "synthetic-member", workspace: null };
    const input: Parameters<typeof proveSyntheticGarminDelivery>[0] = {
      client: { resolveUser: vi.fn().mockResolvedValue({ userId: "synthetic-junction-user" }) },
      clientUserId: "synthetic-client-user",
      memberId: "synthetic-member",
      scenario: { harness: {
        webBaseUrl: "http://localhost:12345",
        requestJson: async <T>() => JSON.parse(JSON.stringify(status)) as T,
      } },
      signal: new AbortController().signal,
      timeoutMs: 40,
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    };
    return { input, fetchMock };
  }

  it.each(["match", "wrong_value", "wrong_source", "stale"])("checks the delivered fixture through the real importer and canonical query: %s", async (variant) => {
    const { input, fetchMock } = setup();
    input.timeoutMs = variant === "match" ? 5000 : 1000;
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "garmin-synthetic-proof-"));
    try {
      await core.initializeVault({ createdAt: new Date().toISOString(), timezone: "UTC", vaultRoot });
      fetchMock.mockImplementation(async (url, options) => {
        expect(String(url)).toBe("http://localhost:12345/api/device-sync/webhooks/junction");
        expect(options.redirect).toBe("error");
        expect(options.headers.get("svix-signature")).toMatch(/^v1,/u);
        const body = JSON.parse(options.body);
        expect(body.event_type).toBe("daily.data.activity.created");
        expect(body.user_id).toBe("synthetic-junction-user");
        expect(body.data.source.provider).toBe("garmin");
        if (variant === "wrong_value") body.data.steps += 1;
        if (variant === "wrong_source") body.data.source.provider = "oura";
        const generatedAt = variant === "stale" ? "2000-01-01T00:00:00.000Z" : new Date().toISOString();
        await importDeviceProviderSnapshot({ provider: "junction", vaultRoot,
          snapshot: { importedAt: generatedAt, summaries: { activity: [body.data] } },
        }, { corePort: core });
        const projection = buildMetricProjection(await readVaultRawTolerant(vaultRoot));
        const replica = await createBrowserVaultReplica({
          generatedAt, metricPoints: projection.metricPoints,
          sourceBundleHash: "a".repeat(64), vault: await readVault(vaultRoot),
        });
        vi.spyOn(liveData, "readCanaryBrowserVaultReplica").mockResolvedValue(replica);
        const status = { inFlight: false, mailboxLag: [], userId: input.memberId, workspace: {
          createdAt: generatedAt, updatedAt: generatedAt, userId: input.memberId, version: "1",
          browserVaultReplicaRef: {
            byteLength: 256, dataVersion: "synthetic", generatedAt,
            keyId: "browser-vault-replica:synthetic", objectKey: "synthetic/replica.json",
            replicaSchema: "murph.browser-vault-replica", runtimeRootKeyId: "udrk:runtime:synthetic",
            schema: "murph.hosted-browser-vault-replica-ref.v1", sourceBundleHash: "a".repeat(64),
          },
        } };
        input.scenario.harness.requestJson = async <T>() => JSON.parse(JSON.stringify(status)) as T;
        return Response.json({ accepted: true, duplicate: false });
      });
      if (variant === "match") {
        await expect(proveSyntheticGarminDelivery(input)).resolves.toBe("synthetic_webhook_matched");
      } else {
        await expect(proveSyntheticGarminDelivery(input)).rejects.toThrow(failure);
      }
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("cannot pass with a webhook acknowledgement but no published vault data", async () => {
    const { input, fetchMock } = setup();
    await expect(proveSyntheticGarminDelivery(input)).rejects.toThrow(failure);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([{ accepted: false }, { accepted: true, orphaned: true }, { accepted: true, duplicate: true }, null])(
    "rejects inadmissible webhook receipt %j", async (receipt) => {
      const { input, fetchMock } = setup();
      fetchMock.mockResolvedValue(Response.json(receipt));
      await expect(proveSyntheticGarminDelivery(input)).rejects.toThrow(failure);
    },
  );

  it.each(["https://www.withmurph.ai", "http://localhost:12345/other"])(
    "never sends synthetic data outside the local root: %s", async (base) => {
      const { input, fetchMock } = setup();
      input.scenario.harness.webBaseUrl = base;
      await expect(proveSyntheticGarminDelivery(input)).rejects.toThrow(failure);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(input.client.resolveUser).not.toHaveBeenCalled();
    },
  );

  it("does not deliver after cancellation or expose provider errors", async () => {
    const { input, fetchMock } = setup();
    input.signal = AbortSignal.abort(new Error("private cancellation details"));
    await expect(proveSyntheticGarminDelivery(input)).rejects.toThrow(failure);
    expect(fetchMock).not.toHaveBeenCalled();
    input.signal = new AbortController().signal;
    vi.mocked(input.client.resolveUser).mockRejectedValue(new Error("private provider details"));
    await expect(proveSyntheticGarminDelivery(input)).rejects.toThrow(failure);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
