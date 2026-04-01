import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe as baseDescribe, expect, it, vi } from "vitest";

import { ContainerProxy as PackageContainerProxy } from "@cloudflare/containers";
import { createHostedExecutionSignature } from "../src/auth.ts";
import {
  createHostedVerifiedEmailUserEnv,
  parseHostedEmailThreadTarget,
  type HostedExecutionDispatchRequest,
} from "@murphai/runtime-state";
import { createHostedUserEnvStore } from "../src/bundle-store.ts";
import { writeEncryptedR2Json } from "../src/crypto.ts";
import { createHostedExecutionJournalStore, persistHostedExecutionCommit } from "../src/execution-journal.ts";
import worker, { ContainerProxy as ExportedContainerProxy, UserRunnerDurableObject } from "../src/index.ts";
import { encodeHostedUserEnvPayload } from "../src/user-env.ts";
import { handleRunnerOutboundRequest } from "../src/runner-outbound.ts";
import { createTestSqlStorage } from "./sql-storage.ts";

const describe = baseDescribe.sequential;

const RUNNER_PROXY_TOKEN = "runner-proxy-token";
const RUNNER_PROXY_TOKEN_HEADER = "x-hosted-execution-runner-proxy-token";

describe("cloudflare worker routes", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("re-exports ContainerProxy for container outbound routing", () => {
    expect(ExportedContainerProxy).toBe(PackageContainerProxy);
  });

  it("imports inbox email parsing through the email-only subpath", async () => {
    const workerSource = await readFile(
      path.resolve("apps/cloudflare/src/index.ts"),
      "utf8",
    );

    expect(workerSource).not.toMatch(/from "@murphai\/inboxd";/u);
    expect(workerSource).toMatch(/@murphai\/inboxd\/connectors\/email\/parsed/u);
  });

  it("serves a health endpoint even before secrets are configured", async () => {
    const response = await worker.fetch(
      new Request("https://runner.example.test/health"),
      {
        BUNDLES: createBucketStore().api,
        RUNNER_CONTAINER: createStorage().runnerContainerNamespace,
        USER_RUNNER: {
          getByName() {
            return createUserRunnerStub();
          },
        },
      } as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "cloudflare-hosted-runner",
    });
  });

  it("returns the service banner for / but 404s unknown worker routes", async () => {
    const response = await worker.fetch(
      new Request("https://runner.example.test/"),
      createWorkerEnv(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "cloudflare-hosted-runner",
    });

    const unknownResponse = await worker.fetch(
      new Request("https://runner.example.test/unknown"),
      createWorkerEnv(),
    );

    expect(unknownResponse.status).toBe(404);
    await expect(unknownResponse.json()).resolves.toEqual({
      error: "Not found",
    });
  });

  it("injects the path user id into manual run requests through direct RPC", async () => {
    const stub = createUserRunnerStub();

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/run", {
        body: JSON.stringify({ note: "manual" }),
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      createWorkerEnv(stub, {
        HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      }),
    );

    expect(response.status).toBe(200);
    expect(stub.dispatch).toHaveBeenCalledTimes(1);
    expect(stub.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: expect.stringMatching(/^manual:/u),
    }));
  });

  it("accepts an empty manual run body and still injects the path user id", async () => {
    const stub = createUserRunnerStub();

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/run", {
        body: "",
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      createWorkerEnv(stub, {
        HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      }),
    );

    expect(response.status).toBe(200);
    expect(stub.dispatch).toHaveBeenCalledTimes(1);
    expect(stub.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        userId: "member_123",
      }),
    }));
  });

  it("accepts signed dispatch through the canonical internal dispatch route", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const stub = createUserRunnerStub();
    const dispatch = createDispatch("evt_123");
    const request = await createSignedDispatchRequest("/internal/dispatch", dispatch);

    const response = await worker.fetch(
      request,
      createWorkerEnv(stub),
    );

    expect(response.status).toBe(200);
    expect(stub.dispatchWithOutcome).toHaveBeenCalledTimes(1);
    expect(stub.dispatchWithOutcome).toHaveBeenCalledWith(dispatch);
  });

  it("keeps the removed internal events alias hidden from signed dispatch callers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const stub = createUserRunnerStub();
    const request = await createSignedDispatchRequest("/internal/events", createDispatch("evt_removed_alias"));

    const response = await worker.fetch(request, createWorkerEnv(stub));

    expect(response.status).toBe(404);
    expect(stub.dispatchWithOutcome).not.toHaveBeenCalled();
  });

  it("rejects stale, malformed, and future signed dispatch requests", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const stub = createUserRunnerStub();
    const dispatch = createDispatch("evt_signed");

    const staleResponse = await worker.fetch(
      await createSignedDispatchRequest("/internal/dispatch", dispatch, {
        timestamp: "2026-03-26T11:50:00.000Z",
      }),
      createWorkerEnv(stub),
    );
    expect(staleResponse.status).toBe(401);

    const malformedResponse = await worker.fetch(
      await createSignedDispatchRequest("/internal/dispatch", dispatch, {
        timestamp: "2026-03-26T12:00:00Z",
      }),
      createWorkerEnv(stub),
    );
    expect(malformedResponse.status).toBe(401);

    const futureResponse = await worker.fetch(
      await createSignedDispatchRequest("/internal/dispatch", dispatch, {
        timestamp: "2026-03-26T12:06:00.000Z",
      }),
      createWorkerEnv(stub),
    );
    expect(futureResponse.status).toBe(401);
    expect(stub.dispatch).not.toHaveBeenCalled();
  });

  it("persists runner commits through the outbound commit.worker handler", async () => {
    const harness = createUserRunnerDurableObject();
    const sideEffects = [
      {
        effectId: "outbox_123",
        fingerprint: "dedupe_123",
        intentId: "outbox_123",
        kind: "assistant.delivery" as const,
      },
    ];

    const response = await callRunnerOutbound(
      new Request("http://commit.worker/events/evt_commit/commit", {
        body: JSON.stringify({
          bundles: {
            agentState: Buffer.from("agent-state").toString("base64"),
            vault: Buffer.from("vault").toString("base64"),
          },
          currentBundleRefs: {
            agentState: null,
            vault: null,
          },
          result: {
            eventsHandled: 1,
            summary: "ok",
          },
          sideEffects,
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      harness.env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      committed: {
        eventId: "evt_commit",
        result: {
          summary: "ok",
        },
      },
      ok: true,
    });
    expect(harness.bucket.keys()).toEqual([
      "bundles/agent-state/ad36dc9bda6b1f6ed90262c98b5884c0284212b608662e5d6d2398c4c7915feb.bundle.json",
      "bundles/vault/e6f0a1fbb43c89196dcfcbef85908f19ab4c5f7cc4f4c452284697757683d7ef.bundle.json",
      "transient/execution-journal/member_123/evt_commit.json",
    ]);
    const journalStore = createHostedExecutionJournalStore({
      bucket: harness.bucket.api,
      key: Buffer.alloc(32, 9),
      keyId: "v1",
    });
    await expect(journalStore.readCommittedResult("member_123", "evt_commit")).resolves.toMatchObject({
      sideEffects,
    });
  });

  it("stores and reads encrypted hosted artifact objects through the outbound artifacts.worker handler", async () => {
    const harness = createUserRunnerDurableObject();
    const artifactBytes = Buffer.from("artifact-payload\n", "utf8");

    const writeResponse = await callRunnerOutbound(
      new Request("http://artifacts.worker/objects/fec80655c7d8a98cd92de1c1a21057808541e5fd289183d3c9f99f20c60c6d2b", {
        body: artifactBytes,
        headers: {
          "content-type": "application/octet-stream",
        },
        method: "PUT",
      }),
      harness.env,
    );

    expect(writeResponse.status).toBe(200);
    await expect(writeResponse.json()).resolves.toMatchObject({
      ok: true,
      sha256: "fec80655c7d8a98cd92de1c1a21057808541e5fd289183d3c9f99f20c60c6d2b",
      size: artifactBytes.byteLength,
    });

    const readResponse = await callRunnerOutbound(
      new Request("http://artifacts.worker/objects/fec80655c7d8a98cd92de1c1a21057808541e5fd289183d3c9f99f20c60c6d2b", {
        method: "GET",
      }),
      harness.env,
    );

    expect(readResponse.status).toBe(200);
    expect(Buffer.from(await readResponse.arrayBuffer())).toEqual(artifactBytes);
    expect(harness.bucket.keys()).toEqual([
      "users/member_123/artifacts/fec80655c7d8a98cd92de1c1a21057808541e5fd289183d3c9f99f20c60c6d2b.artifact.bin",
    ]);
  });

  it("rejects artifact writes when the request hash does not match the payload", async () => {
    const harness = createUserRunnerDurableObject();

    await expect(() => callRunnerOutbound(
      new Request("http://artifacts.worker/objects/fec80655c7d8a98cd92de1c1a21057808541e5fd289183d3c9f99f20c60c6d2b", {
        body: Buffer.from("wrong-payload\n", "utf8"),
        headers: {
          "content-type": "application/octet-stream",
        },
        method: "PUT",
      }),
      harness.env,
    )).rejects.toThrow(
      "Hosted artifact hash mismatch: expected fec80655c7d8a98cd92de1c1a21057808541e5fd289183d3c9f99f20c60c6d2b",
    );
    expect(harness.bucket.keys()).toEqual([]);
  });

  it("keeps hosted artifact objects isolated per user", async () => {
    const harness = createUserRunnerDurableObject();
    const artifactBytes = Buffer.from("artifact-payload\n", "utf8");
    const artifactSha256 = "fec80655c7d8a98cd92de1c1a21057808541e5fd289183d3c9f99f20c60c6d2b";

    const writeResponse = await callRunnerOutbound(
      new Request(`http://artifacts.worker/objects/${artifactSha256}`, {
        body: artifactBytes,
        headers: {
          "content-type": "application/octet-stream",
        },
        method: "PUT",
      }),
      harness.env,
      "member_alpha",
    );

    expect(writeResponse.status).toBe(200);

    const readResponse = await callRunnerOutbound(
      new Request(`http://artifacts.worker/objects/${artifactSha256}`, {
        method: "GET",
      }),
      harness.env,
      "member_bravo",
    );

    expect(readResponse.status).toBe(404);
    expect(harness.bucket.keys()).toEqual([
      `users/member_alpha/artifacts/${artifactSha256}.artifact.bin`,
    ]);
  });

  it("persists finalized runner bundles through the outbound commit.worker handler", async () => {
    const harness = createUserRunnerDurableObject();

    await callRunnerOutbound(
      new Request("http://commit.worker/events/evt_finalize/commit", {
        body: JSON.stringify({
          bundles: {
            agentState: Buffer.from("agent-state-committed").toString("base64"),
            vault: Buffer.from("vault-committed").toString("base64"),
          },
          currentBundleRefs: {
            agentState: null,
            vault: null,
          },
          result: {
            eventsHandled: 1,
            summary: "committed",
          },
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      harness.env,
    );

    const finalizeResponse = await callRunnerOutbound(
      new Request("http://commit.worker/events/evt_finalize/finalize", {
        body: JSON.stringify({
          bundles: {
            agentState: Buffer.from("agent-state-final").toString("base64"),
            vault: Buffer.from("vault-final").toString("base64"),
          },
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      harness.env,
    );
    const journalStore = createHostedExecutionJournalStore({
      bucket: harness.bucket.api,
      key: Buffer.alloc(32, 9),
      keyId: "v1",
    });

    expect(finalizeResponse.status).toBe(200);
    await expect(finalizeResponse.json()).resolves.toMatchObject({
      finalized: {
        eventId: "evt_finalize",
        finalizedAt: expect.any(String),
        result: {
          summary: "committed",
        },
      },
      ok: true,
    });
    await expect(journalStore.readCommittedResult("member_123", "evt_finalize")).resolves.toMatchObject({
      bundleRefs: {
        agentState: {
          size: "agent-state-final".length,
        },
        vault: {
          size: "vault-final".length,
        },
      },
      finalizedAt: expect.any(String),
      result: {
        summary: "committed",
      },
    });
  });

  it("keeps malformed outbound callbacks from mutating journal state even when runner auth is unset", async () => {
    const harness = createUserRunnerDurableObject();
    const journalStore = createHostedExecutionJournalStore({
      bucket: harness.bucket.api,
      key: Buffer.alloc(32, 9),
      keyId: "v1",
    });

    await callRunnerOutbound(
      new Request("http://commit.worker/events/evt_finalize_auth/commit", {
        body: JSON.stringify({
          bundles: {
            agentState: Buffer.from("agent-state-committed").toString("base64"),
            vault: Buffer.from("vault-committed").toString("base64"),
          },
          currentBundleRefs: {
            agentState: null,
            vault: null,
          },
          result: {
            eventsHandled: 1,
            summary: "committed",
          },
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      harness.env,
    );

    await expect(() => callRunnerOutbound(
      new Request("http://commit.worker/events/evt_finalize_auth/finalize", {
        body: JSON.stringify({
          bundles: {
            agentState: 42,
            vault: Buffer.from("vault-final").toString("base64"),
          },
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      harness.env,
    )).rejects.toThrow("bundles.agentState must be a base64 string or null.");

    await expect(() => callRunnerOutbound(
      new Request("http://commit.worker/events/evt_bad_commit/commit", {
        body: JSON.stringify({
          bundles: {
            agentState: Buffer.from("agent-state").toString("base64"),
            vault: 42,
          },
          currentBundleRefs: {
            agentState: {},
            vault: null,
          },
          result: {
            eventsHandled: 1,
            summary: "bad",
          },
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      harness.env,
    )).rejects.toThrow("bundles.vault must be a base64 string or null.");

    const publicCommitResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/runner-events/member_123/evt_commit/commit", {
        method: "POST",
      }),
      createWorkerEnv(),
    );
    expect(publicCommitResponse.status).toBe(404);

    const publicOutboxResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/runner-outbox/member_123/outbox_123", {
        method: "GET",
      }),
      createWorkerEnv(),
    );
    expect(publicOutboxResponse.status).toBe(404);

    await expect(journalStore.readCommittedResult("member_123", "evt_finalize_auth")).resolves.toMatchObject({
      finalizedAt: null,
      result: {
        summary: "committed",
      },
    });
  });

  it("persists side-effect journal records through the side-effects route and reads them back through the outbox route", async () => {
    const env = createWorkerEnv();
    const response = await callRunnerOutbound(
      new Request("http://side-effects.worker/effects/outbox_123?kind=assistant.delivery&fingerprint=dedupe_123", {
        body: JSON.stringify({
          delivery: createOutboxDelivery(),
          effectId: "outbox_123",
          fingerprint: "dedupe_123",
          intentId: "outbox_123",
          kind: "assistant.delivery",
          recordedAt: "2026-03-26T12:00:05.000Z",
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "PUT",
      }),
      env,
    );

    expect(response.status).toBe(200);

    const readResponse = await callRunnerOutbound(
      new Request("http://side-effects.worker/intents/outbox_123?kind=assistant.delivery&fingerprint=dedupe_123", {
        method: "GET",
      }),
      env,
    );

    expect(readResponse.status).toBe(200);
    await expect(readResponse.json()).resolves.toMatchObject({
      effectId: "outbox_123",
      record: {
        delivery: {
          channel: "telegram",
          target: "thread_123",
        },
        effectId: "outbox_123",
        intentId: "outbox_123",
        kind: "assistant.delivery",
      },
    });
  });

  it("falls back to fingerprint side-effect records across the outbox and side-effects routes", async () => {
    const env = createWorkerEnv();

    await callRunnerOutbound(
      new Request("http://side-effects.worker/intents/outbox_a?kind=assistant.delivery&fingerprint=dedupe_123", {
        body: JSON.stringify({
          delivery: createOutboxDelivery(),
          effectId: "outbox_a",
          fingerprint: "dedupe_123",
          intentId: "outbox_a",
          kind: "assistant.delivery",
          recordedAt: "2026-03-26T12:00:05.000Z",
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "PUT",
      }),
      env,
    );

    const readResponse = await callRunnerOutbound(
      new Request("http://side-effects.worker/effects/outbox_b?kind=assistant.delivery&fingerprint=dedupe_123", {
        method: "GET",
      }),
      env,
    );

    expect(readResponse.status).toBe(200);
    await expect(readResponse.json()).resolves.toMatchObject({
      effectId: "outbox_a",
      record: {
        delivery: {
          channel: "telegram",
        },
        effectId: "outbox_a",
        intentId: "outbox_a",
        kind: "assistant.delivery",
      },
    });
  });

  it("reads side-effect journal records encrypted with a previous key id after rotation", async () => {
    const previousKey = Buffer.alloc(32, 8);
    const env = createWorkerEnv(createUserRunnerStub(), {
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY_ID: "v2",
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEYRING_JSON: JSON.stringify({
        v1: previousKey.toString("base64"),
      }),
    });
    const record = {
      delivery: createOutboxDelivery(),
      effectId: "outbox_rotated",
      fingerprint: "dedupe_rotated",
      intentId: "outbox_rotated",
      kind: "assistant.delivery" as const,
      recordedAt: "2026-03-26T12:00:05.000Z",
    };
    const canonicalKey = fingerprintRecordKey("member_123", record.kind, record.fingerprint);

    await writeEncryptedR2Json({
      bucket: env.BUNDLES,
      cryptoKey: previousKey,
      key: canonicalKey,
      keyId: "v1",
      value: record,
    });
    await writeEncryptedR2Json({
      bucket: env.BUNDLES,
      cryptoKey: previousKey,
      key: effectRecordKey("member_123", record.effectId),
      keyId: "v1",
      value: {
        recordKey: canonicalKey,
        schema: "murph.hosted-side-effect-alias.v1",
      },
    });

    const response = await callRunnerOutbound(
      new Request(`http://side-effects.worker/intents/${record.effectId}?kind=${record.kind}&fingerprint=${record.fingerprint}`, {
        method: "GET",
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      effectId: "outbox_rotated",
      record: {
        delivery: {
          channel: "telegram",
          target: "thread_123",
        },
        effectId: "outbox_rotated",
        intentId: "outbox_rotated",
        kind: "assistant.delivery",
      },
    });
  });

  it("forwards operator env and status routes to direct durable-object methods", async () => {
    const stub = createUserRunnerStub();
    const env = createWorkerEnv(stub, {
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
    });

    const updateResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/env", {
        body: JSON.stringify({
          env: {
            OPENAI_API_KEY: "sk-test",
          },
          mode: "merge",
        }),
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "PUT",
      }),
      env,
    );
    expect(updateResponse.status).toBe(200);
    expect(stub.updateUserEnv).toHaveBeenCalledWith({
      env: {
        OPENAI_API_KEY: "sk-test",
      },
      mode: "merge",
    });

    const envStatusResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/env", {
        headers: {
          authorization: "Bearer control-token",
        },
        method: "GET",
      }),
      env,
    );
    expect(envStatusResponse.status).toBe(200);
    expect(stub.getUserEnvStatus).toHaveBeenCalledWith();

    const clearResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/env", {
        headers: {
          authorization: "Bearer control-token",
        },
        method: "DELETE",
      }),
      env,
    );
    expect(clearResponse.status).toBe(200);
    expect(stub.clearUserEnv).toHaveBeenCalledWith();

    const statusResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/status", {
        headers: {
          authorization: "Bearer control-token",
        },
        method: "GET",
      }),
      env,
    );
    expect(statusResponse.status).toBe(200);
    expect(stub.status).toHaveBeenCalledWith();
  });

  it("forwards hosted gateway read and send routes through the gateway seam", async () => {
    const stub = createUserRunnerStub();
    const env = createWorkerEnv(stub, {
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
    });

    const listResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/gateway/conversations/list", {
        body: JSON.stringify({ limit: 5 }),
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env,
    );
    expect(listResponse.status).toBe(200);
    expect(stub.gatewayListConversations).toHaveBeenCalledWith({
      channel: null,
      includeDerivedTitles: true,
      includeLastMessage: true,
      limit: 5,
      search: null,
    });

    const readResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/gateway/messages/read", {
        body: JSON.stringify({ sessionKey: "gwcs_worker_test" }),
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env,
    );
    expect(readResponse.status).toBe(200);
    expect(stub.gatewayReadMessages).toHaveBeenCalledWith({
      afterMessageId: null,
      limit: 100,
      oldestFirst: false,
      sessionKey: "gwcs_worker_test",
    });

    const waitResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/gateway/events/wait", {
        body: JSON.stringify({ cursor: 7, timeoutMs: 1 }),
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env,
    );
    expect(waitResponse.status).toBe(200);
    expect(stub.gatewayPollEvents).toHaveBeenCalled();

    const sendResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/gateway/messages/send", {
        body: JSON.stringify({
          sessionKey: "gwcs_worker_test",
          text: "Please follow up.",
        }),
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env,
    );
    expect(sendResponse.status).toBe(200);
    expect(stub.gatewayGetConversation).toHaveBeenCalledWith({
      sessionKey: "gwcs_worker_test",
    });
    expect(stub.dispatchWithOutcome).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        kind: "gateway.message.send",
        clientRequestId: null,
        replyToMessageId: null,
        sessionKey: "gwcs_worker_test",
        text: "Please follow up.",
        userId: "member_123",
      }),
      eventId: expect.stringMatching(/^gateway-send:/u),
    }));
    await expect(sendResponse.json()).resolves.toMatchObject({
      delivery: null,
      messageId: null,
      queued: true,
      sessionKey: "gwcs_worker_test",
    });
  });

  it("threads clientRequestId through hosted gateway sends", async () => {
    const stub = createUserRunnerStub();
    const env = createWorkerEnv(stub, {
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
    });

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/gateway/messages/send", {
        body: JSON.stringify({
          clientRequestId: "req-456",
          sessionKey: "gwcs_worker_test",
          text: "Please follow up.",
        }),
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(stub.dispatchWithOutcome).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        kind: "gateway.message.send",
        clientRequestId: "req-456",
        sessionKey: "gwcs_worker_test",
        text: "Please follow up.",
        userId: "member_123",
      }),
      eventId: expect.stringMatching(/^gateway-send:[0-9a-f-]{36}$/u),
    }));
  });

  it("rejects gateway reply-to sends for channels without stable reply-to support", async () => {
    const stub = createUserRunnerStub();
    const env = createWorkerEnv(stub, {
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
    });

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/gateway/messages/send", {
        body: JSON.stringify({
          replyToMessageId: "gwcm_worker_test",
          sessionKey: "gwcs_worker_test",
          text: "Please follow up.",
        }),
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Gateway reply-to is not supported for this channel.",
    });
    expect(stub.dispatchWithOutcome).not.toHaveBeenCalled();
  });

  it("accepts gateway reply-to sends that point at same-session outbox ids", async () => {
    const stub = createUserRunnerStub();
    const routeToken = "route_worker_test";
    stub.gatewayGetConversation.mockResolvedValueOnce({
      canSend: true,
      lastActivityAt: "2026-03-26T12:00:00.000Z",
      lastMessagePreview: "Please send the latest PDF.",
      messageCount: 2,
      route: {
        channel: "linq",
        directness: "direct",
        identityId: "default",
        participantId: "contact:alex",
        reply: {
          kind: "thread",
          target: "chat_123",
        },
        threadId: "chat_123",
      },
      schema: "murph.gateway-conversation.v1",
      sessionKey: createGatewayConversationSessionKeyForTests(routeToken),
      title: "Lab thread",
    });
    const env = createWorkerEnv(stub, {
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
    });

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/gateway/messages/send", {
        body: JSON.stringify({
          replyToMessageId: createGatewayOutboxMessageIdForTests(routeToken, "outbox_test"),
          sessionKey: createGatewayConversationSessionKeyForTests(routeToken),
          text: "Please follow up.",
        }),
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      delivery: null,
      messageId: null,
      queued: true,
      sessionKey: createGatewayConversationSessionKeyForTests(routeToken),
    });
    expect(stub.dispatchWithOutcome).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        kind: "gateway.message.send",
        replyToMessageId: createGatewayOutboxMessageIdForTests(routeToken, "outbox_test"),
        sessionKey: createGatewayConversationSessionKeyForTests(routeToken),
        text: "Please follow up.",
        userId: "member_123",
      }),
      eventId: expect.stringMatching(/^gateway-send:/u),
    }));
  });

  it("rejects gateway reply-to sends that point at a foreign-session outbox id", async () => {
    const stub = createUserRunnerStub();
    const routeToken = "route_worker_test";
    const otherRouteToken = "route_other_test";
    stub.gatewayGetConversation.mockResolvedValueOnce({
      canSend: true,
      lastActivityAt: "2026-03-26T12:00:00.000Z",
      lastMessagePreview: "Please send the latest PDF.",
      messageCount: 2,
      route: {
        channel: "linq",
        directness: "direct",
        identityId: "default",
        participantId: "contact:alex",
        reply: {
          kind: "thread",
          target: "chat_123",
        },
        threadId: "chat_123",
      },
      schema: "murph.gateway-conversation.v1",
      sessionKey: createGatewayConversationSessionKeyForTests(routeToken),
      title: "Lab thread",
    });
    const env = createWorkerEnv(stub, {
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
    });

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/gateway/messages/send", {
        body: JSON.stringify({
          replyToMessageId: createGatewayOutboxMessageIdForTests(otherRouteToken, "outbox_other"),
          sessionKey: createGatewayConversationSessionKeyForTests(routeToken),
          text: "Please follow up.",
        }),
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Gateway reply-to did not belong to the requested session.",
    });
    expect(stub.dispatchWithOutcome).not.toHaveBeenCalled();
  });

  it("rejects gateway reply-to sends that point at same-session non-message ids", async () => {
    const stub = createUserRunnerStub();
    const routeToken = "route_worker_test";
    stub.gatewayGetConversation.mockResolvedValueOnce({
      canSend: true,
      lastActivityAt: "2026-03-26T12:00:00.000Z",
      lastMessagePreview: "Please send the latest PDF.",
      messageCount: 2,
      route: {
        channel: "linq",
        directness: "direct",
        identityId: "default",
        participantId: "contact:alex",
        reply: {
          kind: "thread",
          target: "chat_123",
        },
        threadId: "chat_123",
      },
      schema: "murph.gateway-conversation.v1",
      sessionKey: createGatewayConversationSessionKeyForTests(routeToken),
      title: "Lab thread",
    });
    const env = createWorkerEnv(stub, {
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
    });

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/gateway/messages/send", {
        body: JSON.stringify({
          replyToMessageId: createGatewayAttachmentIdForTests(routeToken, "attachment_test"),
          sessionKey: createGatewayConversationSessionKeyForTests(routeToken),
          text: "Please follow up.",
        }),
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Gateway opaque id is invalid.",
    });
    expect(stub.dispatchWithOutcome).not.toHaveBeenCalled();
  });

  it("returns a stable invalid JSON error for malformed worker control payloads", async () => {
    const env = createWorkerEnv(createUserRunnerStub(), {
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
    });

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/env", {
        body: "{]",
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "PUT",
      }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid JSON.",
    });
  });

  it("returns a stable invalid request error for malformed worker control payload shapes", async () => {
    const env = createWorkerEnv(createUserRunnerStub(), {
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
    });

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/env", {
        body: JSON.stringify([]),
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "PUT",
      }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request.",
    });
  });

  it("fails closed on control routes when the worker control token is missing", async () => {
    const stub = createUserRunnerStub();

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/status", {
        method: "GET",
      }),
      createWorkerEnv(stub),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted execution control token is not configured.",
    });
    expect(stub.status).not.toHaveBeenCalled();
  });


  it("returns a stable hosted email address for a user through the control route", async () => {
    const stub = createUserRunnerStub();
    const env = createWorkerEnv(stub, {
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "email-secret",
    });

    const firstResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/email-address", {
        headers: {
          authorization: "Bearer control-token",
        },
        method: "GET",
      }),
      env,
    );
    const secondResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/email-address", {
        headers: {
          authorization: "Bearer control-token",
        },
        method: "GET",
      }),
      env,
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    const firstPayload = await firstResponse.json() as {
      address: string;
      identityId: string;
      userId: string;
    };
    const secondPayload = await secondResponse.json() as typeof firstPayload;
    expect(firstPayload.userId).toBe("member_123");
    expect(firstPayload.identityId).toBe("assistant@mail.example.test");
    expect(firstPayload.address).toContain("assistant+u-");
    expect(firstPayload.address.endsWith("@mail.example.test")).toBe(true);
    expect(secondPayload.address).toBe(firstPayload.address);
  });

  it("returns 503 from the hosted email address route when ingress is not configured", async () => {
    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/email-address", {
        headers: {
          authorization: "Bearer control-token",
        },
        method: "GET",
      }),
      createWorkerEnv(createUserRunnerStub(), {
        HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted email ingress is not configured.",
    });
  });

  it("returns 503 from the hosted email address route when a sender address is configured without a hosted email domain", async () => {
    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/email-address", {
        headers: {
          authorization: "Bearer control-token",
        },
        method: "GET",
      }),
      createWorkerEnv(createUserRunnerStub(), {
        HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
        HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID: "acct_123",
        HOSTED_EMAIL_CLOUDFLARE_API_TOKEN: "cf-token",
        HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
        HOSTED_EMAIL_SIGNING_SECRET: "email-secret",
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted email ingress is not configured.",
    });
  });

  it("routes inbound hosted email through the stable alias and stores the raw message for the runner", async () => {
    const stub = createUserRunnerStub();
    const env = createWorkerEnv(stub, {
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "email-secret",
    });

    const addressResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/email-address", {
        headers: {
          authorization: "Bearer control-token",
        },
        method: "GET",
      }),
      env,
    );
    const { address } = await addressResponse.json() as { address: string };
    await seedHostedVerifiedEmailUserEnv(env, "member_123", "alice@example.test");
    const raw = [
      'From: Alice Example <alice@example.test>',
      `To: ${address}`,
      'Subject: Hosted hello',
      'Message-ID: <msg_123@example.test>',
      'Date: Thu, 26 Mar 2026 12:00:00 +0000',
      '',
      'Hello from the hosted email worker.',
      '',
    ].join('\r\n');
    const setReject = vi.fn();

    await worker.email?.({
      from: 'alice@example.test',
      raw,
      setReject,
      to: address,
    } as never, env as never);

    expect(setReject).not.toHaveBeenCalled();
    expect(stub.dispatch).toHaveBeenCalledTimes(1);
    const dispatch = stub.dispatch.mock.calls[0]?.[0] as HostedExecutionDispatchRequest;
    const dispatchedEvent = dispatch.event as Extract<
      HostedExecutionDispatchRequest["event"],
      { kind: "email.message.received" }
    >;
    expect(dispatchedEvent.kind).toBe("email.message.received");
    expect(dispatchedEvent.userId).toBe("member_123");
    expect(dispatchedEvent.identityId).toBe("assistant@mail.example.test");
    expect(dispatchedEvent.threadTarget).toBeNull();
    expect(dispatchedEvent.rawMessageKey).toMatch(/^[0-9a-f]{32}$/u);
    expect(dispatch.eventId).toBe(`email:${dispatchedEvent.rawMessageKey}`);

    const readResponse = await callRunnerOutbound(
      new Request(`http://email.worker/messages/${dispatchedEvent.rawMessageKey}`, {
        method: "GET",
      }),
      env,
    );

    expect(readResponse.status).toBe(200);
    expect(readResponse.headers.get("content-type")).toBe("message/rfc822");
    await expect(readResponse.text()).resolves.toBe(raw);
  });

  it("rejects inbound hosted email on the stable alias when the sender does not match the verified email", async () => {
    const stub = createUserRunnerStub();
    const env = createWorkerEnv(stub, {
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "email-secret",
    });

    const addressResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/email-address", {
        headers: {
          authorization: "Bearer control-token",
        },
        method: "GET",
      }),
      env,
    );
    const { address } = await addressResponse.json() as { address: string };
    await seedHostedVerifiedEmailUserEnv(env, "member_123", "owner@example.test");
    const setReject = vi.fn();

    await worker.email?.({
      from: "intruder@example.test",
      raw: [
        "From: intruder@example.test",
        `To: ${address}`,
        "Subject: Sneaky",
        "",
        "hello",
        "",
      ].join("\r\n"),
      setReject,
      to: address,
    } as never, env as never);

    expect(setReject).toHaveBeenCalledWith("Hosted email sender is not authorized for this route.");
    expect(stub.dispatch).not.toHaveBeenCalled();
    expect(env.__bucketStore.keys().filter((key) => key.includes("/messages/"))).toEqual([]);
  });

  it("rejects inbound hosted email when the header sender and envelope sender disagree", async () => {
    const stub = createUserRunnerStub();
    const env = createWorkerEnv(stub, {
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "email-secret",
    });

    const addressResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/email-address", {
        headers: {
          authorization: "Bearer control-token",
        },
        method: "GET",
      }),
      env,
    );
    const { address } = await addressResponse.json() as { address: string };
    await seedHostedVerifiedEmailUserEnv(env, "member_123", "owner@example.test");
    const setReject = vi.fn();

    await worker.email?.({
      from: "intruder@example.test",
      raw: [
        "From: Owner <owner@example.test>",
        `To: ${address}`,
        "Subject: Sneaky",
        "",
        "hello",
        "",
      ].join("\r\n"),
      setReject,
      to: address,
    } as never, env as never);

    expect(setReject).toHaveBeenCalledWith("Hosted email sender is not authorized for this route.");
    expect(stub.dispatch).not.toHaveBeenCalled();
    expect(env.__bucketStore.keys().filter((key) => key.includes("/messages/"))).toEqual([]);
  });

  it("rejects inbound hosted email when the raw message contains duplicate From headers", async () => {
    const stub = createUserRunnerStub();
    const env = createWorkerEnv(stub, {
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "email-secret",
    });

    const addressResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/email-address", {
        headers: {
          authorization: "Bearer control-token",
        },
        method: "GET",
      }),
      env,
    );
    const { address } = await addressResponse.json() as { address: string };
    await seedHostedVerifiedEmailUserEnv(env, "member_123", "owner@example.test");
    const setReject = vi.fn();

    await worker.email?.({
      from: "owner@example.test",
      raw: [
        "From: intruder@example.test",
        "From: Owner <owner@example.test>",
        `To: ${address}`,
        "Subject: Sneaky",
        "",
        "hello",
        "",
      ].join("\r\n"),
      setReject,
      to: address,
    } as never, env as never);

    expect(setReject).toHaveBeenCalledWith("Hosted email sender is not authorized for this route.");
    expect(stub.dispatch).not.toHaveBeenCalled();
    expect(env.__bucketStore.keys().filter((key) => key.includes("/messages/"))).toEqual([]);
  });

  it("rejects inbound hosted email before route lookup when ingress is not configured", async () => {
    const stub = createUserRunnerStub();
    const setReject = vi.fn();

    await worker.email?.({
      from: "alice@example.test",
      raw: "From: alice@example.test\r\nTo: assistant@example.test\r\n\r\nhello\r\n",
      setReject,
      to: "assistant@example.test",
    } as never, createWorkerEnv(stub) as never);

    expect(setReject).toHaveBeenCalledWith("Hosted email ingress is not configured.");
    expect(stub.dispatch).not.toHaveBeenCalled();
  });

  it("sends hosted email through email.worker and returns a canonical serialized thread target", async () => {
    const env = createWorkerEnv(createUserRunnerStub(), {
      HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID: "acct_123",
      HOSTED_EMAIL_CLOUDFLARE_API_TOKEN: "cf-token",
      HOSTED_EMAIL_DEFAULT_SUBJECT: "Murph update",
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "email-secret",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        expect(String(url)).toBe(
          "https://api.cloudflare.com/client/v4/accounts/acct_123/email/sending/send_raw",
        );
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cf-token");
        const body = JSON.parse(String(init?.body)) as {
          from: string;
          mime_message: string;
          recipients: string[];
        };
        expect(body.from).toBe("assistant@mail.example.test");
        expect(body.recipients).toEqual(["user@example.test"]);
        expect(body.mime_message).toContain("Reply-To: assistant+t-");
        expect(body.mime_message).toContain("To: user@example.test");
        return new Response(JSON.stringify({
          result: {
            queued: ["user@example.test"],
          },
          success: true,
        }), { status: 200 });
      }),
    );

    const response = await callRunnerOutbound(
      new Request("http://email.worker/send", {
        body: JSON.stringify({
          identityId: "different@example.test",
          message: "Hosted email hello.",
          target: "user@example.test",
          targetKind: "participant",
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env,
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      ok: boolean;
      target: string;
    };
    expect(payload.ok).toBe(true);
    const threadTarget = parseHostedEmailThreadTarget(payload.target);
    expect(threadTarget).not.toBeNull();
    expect(threadTarget?.to).toEqual(["user@example.test"]);
    expect(threadTarget?.replyAliasAddress).toContain("assistant+t-");
    expect(threadTarget?.replyAliasAddress?.endsWith("@mail.example.test")).toBe(true);
    expect(threadTarget?.lastMessageId).toMatch(/^<hosted\./u);
    expect(threadTarget?.subject).toBe("Murph update");
  });

  it("routes replies to a hosted send alias back through the configured sender identity", async () => {
    const stub = createUserRunnerStub();
    const env = createWorkerEnv(stub, {
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY_ID: "v2",
      HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID: "acct_123",
      HOSTED_EMAIL_CLOUDFLARE_API_TOKEN: "cf-token",
      HOSTED_EMAIL_DEFAULT_SUBJECT: "Murph update",
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "email-secret",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({
          result: {
            queued: ["user@example.test"],
          },
          success: true,
        }), { status: 200 })),
    );

    const sendResponse = await callRunnerOutbound(
      new Request("http://email.worker/send", {
        body: JSON.stringify({
          identityId: "different@example.test",
          message: "Hosted email hello.",
          target: "user@example.test",
          targetKind: "participant",
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env,
    );
    const sendPayload = await sendResponse.json() as {
      ok: boolean;
      target: string;
    };
    const threadTarget = parseHostedEmailThreadTarget(sendPayload.target);
    const threadRouteKey = env.__bucketStore.keys().find((key) =>
      key.startsWith("transient/hosted-email/threads/"),
    );

    expect(threadTarget?.replyAliasAddress).toBeTruthy();
    if (!threadRouteKey || !threadTarget) {
      throw new Error("Expected the hosted email thread route object to be written.");
    }

    await writeEncryptedR2Json({
      bucket: env.BUNDLES,
      cryptoKey: Buffer.alloc(32, 9),
      key: threadRouteKey,
      keyId: "v2",
      value: {
        identityId: "assistant@mail.example.test",
        replyKey: threadRouteKey.slice("transient/hosted-email/threads/".length, -".json".length),
        schema: "murph.hosted-email-thread-route.v1",
        target: threadTarget,
        updatedAt: "2026-03-26T12:00:00.000Z",
        userId: "member_123",
      },
    });

    await worker.email?.({
      from: "user@example.test",
      raw: [
        'From: user@example.test',
        `To: ${threadTarget?.replyAliasAddress}`,
        'Subject: Re: Murph update',
        '',
        'Replying to the hosted alias.',
        '',
      ].join('\r\n'),
      to: threadTarget?.replyAliasAddress ?? "",
    } as never, env as never);

    expect(stub.dispatch).toHaveBeenCalledTimes(1);
    expect(stub.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        identityId: "assistant@mail.example.test",
        kind: "email.message.received",
        threadTarget: sendPayload.target,
        userId: "member_123",
      }),
    }));
  });

  it("rejects hosted thread replies from senders outside the saved participant list", async () => {
    const stub = createUserRunnerStub();
    const env = createWorkerEnv(stub, {
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY_ID: "v2",
      HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID: "acct_123",
      HOSTED_EMAIL_CLOUDFLARE_API_TOKEN: "cf-token",
      HOSTED_EMAIL_DEFAULT_SUBJECT: "Murph update",
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "email-secret",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({
          result: {
            queued: ["user@example.test"],
          },
          success: true,
        }), { status: 200 })),
    );

    const sendResponse = await callRunnerOutbound(
      new Request("http://email.worker/send", {
        body: JSON.stringify({
          identityId: "different@example.test",
          message: "Hosted email hello.",
          target: "user@example.test",
          targetKind: "participant",
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env,
    );
    const sendPayload = await sendResponse.json() as {
      ok: boolean;
      target: string;
    };
    const threadTarget = parseHostedEmailThreadTarget(sendPayload.target);
    const threadRouteKey = env.__bucketStore.keys().find((key) =>
      key.startsWith("transient/hosted-email/threads/"),
    );

    if (!threadRouteKey || !threadTarget) {
      throw new Error("Expected the hosted email thread route object to be written.");
    }

    await writeEncryptedR2Json({
      bucket: env.BUNDLES,
      cryptoKey: Buffer.alloc(32, 9),
      key: threadRouteKey,
      keyId: "v2",
      value: {
        identityId: "assistant@mail.example.test",
        replyKey: threadRouteKey.slice("transient/hosted-email/threads/".length, -".json".length),
        schema: "murph.hosted-email-thread-route.v1",
        target: threadTarget,
        updatedAt: "2026-03-26T12:00:00.000Z",
        userId: "member_123",
      },
    });

    const setReject = vi.fn();
    await worker.email?.({
      from: "intruder@example.test",
      raw: [
        "From: intruder@example.test",
        `To: ${threadTarget.replyAliasAddress}`,
        "Subject: Re: Murph update",
        "",
        "Replying to the hosted alias.",
        "",
      ].join("\r\n"),
      setReject,
      to: threadTarget.replyAliasAddress ?? "",
    } as never, env as never);

    expect(setReject).toHaveBeenCalledWith("Hosted email sender is not authorized for this route.");
    expect(stub.dispatch).not.toHaveBeenCalled();
    expect(env.__bucketStore.keys().filter((key) => key.includes("/messages/"))).toEqual([]);
  });

  it("rejects hosted thread replies with an ambiguous From header", async () => {
    const stub = createUserRunnerStub();
    const env = createWorkerEnv(stub, {
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY_ID: "v2",
      HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID: "acct_123",
      HOSTED_EMAIL_CLOUDFLARE_API_TOKEN: "cf-token",
      HOSTED_EMAIL_DEFAULT_SUBJECT: "Murph update",
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "email-secret",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({
          result: {
            queued: ["user@example.test"],
          },
          success: true,
        }), { status: 200 })),
    );

    const sendResponse = await callRunnerOutbound(
      new Request("http://email.worker/send", {
        body: JSON.stringify({
          identityId: "different@example.test",
          message: "Hosted email hello.",
          target: "user@example.test",
          targetKind: "participant",
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env,
    );
    const sendPayload = await sendResponse.json() as {
      ok: boolean;
      target: string;
    };
    const threadTarget = parseHostedEmailThreadTarget(sendPayload.target);
    const threadRouteKey = env.__bucketStore.keys().find((key) =>
      key.startsWith("transient/hosted-email/threads/"),
    );

    if (!threadRouteKey || !threadTarget) {
      throw new Error("Expected the hosted email thread route object to be written.");
    }

    await writeEncryptedR2Json({
      bucket: env.BUNDLES,
      cryptoKey: Buffer.alloc(32, 9),
      key: threadRouteKey,
      keyId: "v2",
      value: {
        identityId: "assistant@mail.example.test",
        replyKey: threadRouteKey.slice("transient/hosted-email/threads/".length, -".json".length),
        schema: "murph.hosted-email-thread-route.v1",
        target: threadTarget,
        updatedAt: "2026-03-26T12:00:00.000Z",
        userId: "member_123",
      },
    });

    const setReject = vi.fn();
    await worker.email?.({
      from: "user@example.test",
      raw: [
        "From: User <user@example.test>, Intruder <intruder@example.test>",
        `To: ${threadTarget.replyAliasAddress}`,
        "Subject: Re: Murph update",
        "",
        "Replying to the hosted alias.",
        "",
      ].join("\r\n"),
      setReject,
      to: threadTarget.replyAliasAddress ?? "",
    } as never, env as never);

    expect(setReject).toHaveBeenCalledWith("Hosted email sender is not authorized for this route.");
    expect(stub.dispatch).not.toHaveBeenCalled();
    expect(env.__bucketStore.keys().filter((key) => key.includes("/messages/"))).toEqual([]);
  });

  it("returns method and auth errors on protected routes in the same order as before", async () => {
    const unauthorizedRunResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/run", {
        method: "GET",
      }),
      createWorkerEnv(undefined, {
        HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      }),
    );

    expect(unauthorizedRunResponse.status).toBe(401);
    await expect(unauthorizedRunResponse.json()).resolves.toEqual({
      error: "Unauthorized",
    });

    const wrongMethodOutboxResponse = await callRunnerOutbound(
      new Request("http://side-effects.worker/intents/outbox_123", {
        method: "POST",
      }),
      createWorkerEnv(),
    );

    expect(wrongMethodOutboxResponse.status).toBe(405);
    await expect(wrongMethodOutboxResponse.json()).resolves.toEqual({
      error: "Method not allowed.",
    });
  });

  it("keeps malformed encoded route params behind existing auth and hidden-method boundaries", async () => {
    const controlResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/users/%E0%A4%A/run", {
        method: "GET",
      }),
      createWorkerEnv(undefined, {
        HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      }),
    );

    expect(controlResponse.status).toBe(401);
    await expect(controlResponse.json()).resolves.toEqual({
      error: "Unauthorized",
    });

    const runnerEventResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/runner-events/%E0%A4%A/evt_commit/commit", {
        method: "GET",
      }),
      createWorkerEnv(),
    );

    expect(runnerEventResponse.status).toBe(404);
    await expect(runnerEventResponse.json()).resolves.toEqual({
      error: "Not found",
    });
  });

  it("preserves hidden not-found responses for wrong methods on worker routes that were never public", async () => {
    const dispatchResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/dispatch", {
        method: "GET",
      }),
      createWorkerEnv(),
    );

    expect(dispatchResponse.status).toBe(404);
    await expect(dispatchResponse.json()).resolves.toEqual({
      error: "Not found",
    });
  });

  it("returns HTTP 429 when signed dispatch backpressures a full per-user queue", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const harness = createUserRunnerDurableObject();
    const firstRun = createDeferred<void>();
    harness.storage.runnerContainerFetch.mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
      await firstRun.promise;
      return createRunnerContainerInvokeSuccessResponse({
        bucket: harness.bucket,
        payload: createRunnerSuccessPayload(),
        request: input instanceof Request ? input : new Request(input, init),
      });
    }).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => (
      createRunnerContainerInvokeSuccessResponse({
        bucket: harness.bucket,
        payload: createRunnerSuccessPayload(),
        request: input instanceof Request ? input : new Request(input, init),
      })
    ));

    const firstResponse = worker.fetch(
      await createSignedDispatchRequest("/internal/dispatch", createDispatch("evt_000")),
      harness.env as never,
    );
    await vi.waitFor(() => {
      expect(harness.storage.runnerContainerFetch).toHaveBeenCalledTimes(1);
    });

    for (let index = 1; index < 64; index += 1) {
      await harness.durableObject.dispatch(createDispatch(`evt_${index.toString().padStart(3, "0")}`));
    }

    const overflowResponse = await worker.fetch(
      await createSignedDispatchRequest("/internal/dispatch", createDispatch("evt_overflow")),
      harness.env as never,
    );

    expect(overflowResponse.status).toBe(429);
    await expect(overflowResponse.json()).resolves.toMatchObject({
      event: {
        eventId: "evt_overflow",
        state: "backpressured",
      },
      status: {
        backpressuredEventIds: ["evt_overflow"],
        poisonedEventIds: [],
      },
    });

    firstRun.resolve();
    await firstResponse;
  });

  it("returns HTTP 429 for manual runs when the queue is already full", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const harness = createUserRunnerDurableObject({
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
    });
    const firstRun = createDeferred<void>();
    harness.storage.runnerContainerFetch.mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
      await firstRun.promise;
      return createRunnerContainerInvokeSuccessResponse({
        bucket: harness.bucket,
        payload: createRunnerSuccessPayload(),
        request: input instanceof Request ? input : new Request(input, init),
      });
    }).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => (
      createRunnerContainerInvokeSuccessResponse({
        bucket: harness.bucket,
        payload: createRunnerSuccessPayload(),
        request: input instanceof Request ? input : new Request(input, init),
      })
    ));

    const firstResponse = harness.durableObject.dispatch(createDispatch("evt_000"));
    await vi.waitFor(() => {
      expect(harness.storage.runnerContainerFetch).toHaveBeenCalledTimes(1);
    });

    for (let index = 1; index < 64; index += 1) {
      await harness.durableObject.dispatch(createDispatch(`evt_${index.toString().padStart(3, "0")}`));
    }

    const runResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/run", {
        headers: {
          authorization: "Bearer control-token",
        },
        method: "POST",
      }),
      harness.env as never,
    );

    expect(runResponse.status).toBe(429);
    await expect(runResponse.json()).resolves.toMatchObject({
      backpressuredEventIds: [expect.stringMatching(/^manual:/u)],
    });

    firstRun.resolve();
    await firstResponse;
  });
});

function createWorkerEnv(
  userRunnerStub: UserRunnerStub = createUserRunnerStub(),
  overrides: Partial<Record<string, unknown>> = {},
) {
  const bucketStore = createBucketStore();

  return {
    __bucketStore: bucketStore,
    BUNDLES: bucketStore.api,
    HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    HOSTED_EXECUTION_SIGNING_SECRET: "dispatch-secret",
    RUNNER_CONTAINER: createStorage().runnerContainerNamespace,
    USER_RUNNER: {
      getByName() {
        return userRunnerStub;
      },
    },
    ...overrides,
  };
}

function callRunnerOutbound(
  request: Request,
  env: Record<string, unknown>,
  userId = "member_123",
): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.set(RUNNER_PROXY_TOKEN_HEADER, RUNNER_PROXY_TOKEN);
  return handleRunnerOutboundRequest(
    new Request(request, { headers }),
    env as never,
    userId,
    RUNNER_PROXY_TOKEN,
  );
}

async function seedHostedVerifiedEmailUserEnv(
  env: ReturnType<typeof createWorkerEnv>,
  userId: string,
  emailAddress: string,
): Promise<void> {
  const payload = encodeHostedUserEnvPayload({
    env: createHostedVerifiedEmailUserEnv({
      address: emailAddress,
    }),
  });

  if (!payload) {
    throw new Error("Expected the hosted user env payload to be written.");
  }

  await createHostedUserEnvStore({
    bucket: env.BUNDLES,
    key:
      typeof env.HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY === "string"
        ? Buffer.from(env.HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY, "base64")
        : Buffer.alloc(32, 9),
    keyId: String(env.HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY_ID ?? "v1"),
  }).writeUserEnv(userId, payload);
}

function createBucketStore(input: {
  onPut?(key: string, value: string): Promise<void> | void;
} = {}) {
  const values = new Map<string, string>();

  return {
    api: {
      async delete(key: string) {
        values.delete(key);
      },
      async get(key: string) {
        const value = values.get(key);

        if (!value) {
          return null;
        }

        return {
          async arrayBuffer() {
            return Buffer.from(value, "utf8");
          },
        };
      },
      async put(key: string, value: string) {
        await input.onPut?.(key, value);
        values.set(key, value);
      },
    },
    keys() {
      return [...values.keys()].sort();
    },
  };
}

function createStorage() {
  const values = new Map<string, unknown>();
  const sql = createTestSqlStorage();
  const runnerContainerFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);

    if (url.pathname === "/internal/invoke") {
      const payload = JSON.parse(await request.clone().text()) as {
        job: {
          request: Record<string, unknown>;
        };
      };

      return globalThis.fetch("https://runner-container.internal/__internal/run", {
        body: JSON.stringify(payload.job.request),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });
    }

    if (url.pathname === "/internal/destroy") {
      return new Response(null, { status: 204 });
    }

    return new Response("Not found", { status: 404 });
  });
  const runnerContainerNamespace = {
    getByName() {
      return {
        async destroyInstance() {
          await runnerContainerFetch(new Request("https://runner.internal/internal/destroy", {
            headers: {
              authorization: "Bearer runner-token",
            },
            method: "POST",
          }));
        },
        async invoke(payload: Record<string, unknown>) {
          const response = await runnerContainerFetch(new Request("https://runner.internal/internal/invoke", {
            body: JSON.stringify(payload),
            headers: {
              authorization: "Bearer runner-token",
              "content-type": "application/json; charset=utf-8",
            },
            method: "POST",
          }));

          if (!response.ok) {
            throw new Error(`Runner container returned HTTP ${response.status}.`);
          }

          return await response.json();
        },
      };
    },
  };
  const state = {
    runnerContainerNamespace,
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        return values.get(key) as T | undefined;
      },
      async put<T>(key: string, value: T): Promise<void> {
        values.set(key, value);
      },
      async deleteAlarm(): Promise<void> {},
      async getAlarm(): Promise<number | null> {
        return null;
      },
      async setAlarm(): Promise<void> {},
      sql,
    },
  };

  return {
    clear() {
      values.clear();
      sql.reset();
      runnerContainerFetch.mockClear();
    },
    runnerContainerFetch,
    runnerContainerNamespace,
    state,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

function createDispatch(eventId: string): HostedExecutionDispatchRequest {
  return {
    event: {
      kind: "assistant.cron.tick",
      reason: "manual",
      userId: "member_123",
    },
    eventId,
    occurredAt: "2026-03-26T12:00:00.000Z",
  };
}

function createRunnerSuccessPayload() {
  return {
    bundles: {
      agentState: null,
      vault: null,
    },
    result: {
      eventsHandled: 1,
      summary: "ok",
    },
  };
}

function createOutboxDelivery() {
  return {
    channel: "telegram",
    idempotencyKey: "assistant-outbox:intent_123",
    messageLength: "Queued reply".length,
    sentAt: "2026-03-26T12:00:00.000Z",
    target: "thread_123",
    targetKind: "thread" as const,
  };
}

function effectRecordKey(userId: string, effectId: string): string {
  return `transient/side-effects/by-effect/${encodeURIComponent(userId)}/${encodeURIComponent(effectId)}.json`;
}

function fingerprintRecordKey(
  userId: string,
  kind: string,
  fingerprint: string,
): string {
  return `transient/side-effects/by-fingerprint/${hashFingerprint(kind, fingerprint)}/${encodeURIComponent(userId)}.json`;
}

function hashFingerprint(kind: string, fingerprint: string): string {
  return createHash("sha256").update(`${kind}:${fingerprint}`).digest("hex");
}

async function createCommittedRunnerSuccessResponse(input: {
  bucket: ReturnType<typeof createBucketStore>;
  payload: ReturnType<typeof createRunnerSuccessPayload>;
  requestBody: {
    commit: {
      bundleRefs: {
        agentState: { hash: string; key: string; size: number; updatedAt: string } | null;
        vault: { hash: string; key: string; size: number; updatedAt: string } | null;
      };
    };
    dispatch: {
      event: {
        userId: string;
      };
      eventId: string;
    };
  };
}): Promise<Response> {
  await persistHostedExecutionCommit({
    bucket: input.bucket.api,
    currentBundleRefs: input.requestBody.commit.bundleRefs,
    eventId: input.requestBody.dispatch.eventId,
    key: Buffer.alloc(32, 9),
    keyId: "v1",
    payload: input.payload,
    userId: input.requestBody.dispatch.event.userId,
  });

  return new Response(JSON.stringify(input.payload), {
    status: 200,
  });
}

async function createRunnerContainerInvokeSuccessResponse(input: {
  bucket: ReturnType<typeof createBucketStore>;
  payload: ReturnType<typeof createRunnerSuccessPayload>;
  request: Request;
}): Promise<Response> {
  const url = new URL(input.request.url);

  if (url.pathname === "/internal/destroy") {
    return new Response(null, { status: 204 });
  }

  if (url.pathname !== "/internal/invoke") {
    return new Response("Not found", { status: 404 });
  }

  const requestBody = JSON.parse(await input.request.clone().text()) as {
    job: {
      request: {
        commit: {
          bundleRefs: {
            agentState: { hash: string; key: string; size: number; updatedAt: string } | null;
            vault: { hash: string; key: string; size: number; updatedAt: string } | null;
          };
        };
        dispatch: {
          event: {
            userId: string;
          };
          eventId: string;
        };
      };
    };
  };

  return createCommittedRunnerSuccessResponse({
    bucket: input.bucket,
    payload: input.payload,
    requestBody: requestBody.job.request,
  });
}

function createUserRunnerDurableObject(
  overrides: Partial<Record<string, unknown>> = {},
) {
  const bucket = createBucketStore();
  const storage = createStorage();
  const env = {
    BUNDLES: bucket.api,
    HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
    HOSTED_EXECUTION_SIGNING_SECRET: "dispatch-secret",
    RUNNER_CONTAINER: storage.runnerContainerNamespace,
    ...overrides,
  };
  const durableObject = new UserRunnerDurableObject(storage.state, env as never);

  return {
    bucket,
    durableObject,
    env: {
      ...env,
      USER_RUNNER: {
        getByName() {
          return durableObject;
        },
      },
    },
    storage,
  };
}

type UserRunnerStub = ReturnType<typeof createUserRunnerStub>;

function createUserRunnerStub() {
  return {
    bootstrapUser: vi.fn(async (userId: string) => ({
      userId,
    })),
    clearUserEnv: vi.fn(async () => ({
      configuredUserEnvKeys: [],
      userId: "member_123",
    })),
    commit: vi.fn(async (input: {
      eventId: string;
    }) => ({
      bundleRefs: {
        agentState: null,
        vault: null,
      },
      committedAt: "2026-03-26T12:00:00.000Z",
      eventId: input.eventId,
      finalizedAt: null,
      result: {
        eventsHandled: 1,
        summary: "ok",
      },
    })),
    dispatchWithOutcome: vi.fn(async (input: HostedExecutionDispatchRequest) =>
      buildDispatchResultFixture(input.event.userId, input.eventId)),
    dispatch: vi.fn(async (input: HostedExecutionDispatchRequest) => ({
      backpressuredEventIds: [],
      bundleRefs: {
        agentState: null,
        vault: null,
      },
      inFlight: false,
      lastError: null,
      lastEventId: input.eventId,
      lastRunAt: null,
      nextWakeAt: null,
      pendingEventCount: 0,
      poisonedEventIds: [],
      retryingEventId: null,
      userId: input.event.userId,
    })),
    finalizeCommit: vi.fn(async (input: {
      eventId: string;
    }) => ({
      bundleRefs: {
        agentState: null,
        vault: null,
      },
      committedAt: "2026-03-26T12:00:00.000Z",
      eventId: input.eventId,
      finalizedAt: "2026-03-26T12:00:01.000Z",
      result: {
        eventsHandled: 1,
        summary: "ok",
      },
    })),
    gatewayFetchAttachments: vi.fn(async () => ([{
      attachmentId: "gwca_worker_test",
      byteSize: 3,
      extractedText: null,
      fileName: "labs.pdf",
      kind: "document",
      messageId: "gwcm_worker_test",
      mime: "application/pdf",
      parseState: "pending",
      schema: "murph.gateway-attachment.v1",
      transcriptText: null,
    }])),
    gatewayGetConversation: vi.fn(async () => ({
      canSend: true,
      lastActivityAt: "2026-03-26T12:00:00.000Z",
      lastMessagePreview: "Please send the latest PDF.",
      messageCount: 2,
      route: {
        channel: "email",
        directness: "group",
        identityId: "murph@example.com",
        participantId: "contact:alex",
        reply: {
          kind: "thread",
          target: "thread-labs",
        },
        threadId: "thread-labs",
      },
      schema: "murph.gateway-conversation.v1",
      sessionKey: "gwcs_worker_test",
      title: "Lab thread",
    })),
    gatewayListConversations: vi.fn(async () => ({
      conversations: [{
        canSend: true,
        lastActivityAt: "2026-03-26T12:00:00.000Z",
        lastMessagePreview: "Please send the latest PDF.",
        messageCount: 2,
        route: {
          channel: "email",
          directness: "group",
          identityId: "murph@example.com",
          participantId: "contact:alex",
          reply: {
            kind: "thread",
            target: "thread-labs",
          },
          threadId: "thread-labs",
        },
        schema: "murph.gateway-conversation.v1",
        sessionKey: "gwcs_worker_test",
        title: "Lab thread",
      }],
      nextCursor: null,
    })),
    gatewayListOpenPermissions: vi.fn(async () => []),
    gatewayPollEvents: vi.fn(async (input?: { cursor?: number }) => ({
      events: [],
      live: true,
      nextCursor: input?.cursor ?? 0,
    })),
    gatewayReadMessages: vi.fn(async () => ({
      messages: [{
        actorDisplayName: "Alex",
        attachments: [],
        createdAt: "2026-03-26T12:00:00.000Z",
        direction: "inbound",
        messageId: "gwcm_worker_test",
        schema: "murph.gateway-message.v1",
        sessionKey: "gwcs_worker_test",
        text: "Here is the latest lab PDF.",
      }],
      nextCursor: null,
    })),
    gatewayRespondToPermission: vi.fn(async () => null),
    getUserEnvStatus: vi.fn(async () => ({
      configuredUserEnvKeys: [],
      userId: "member_123",
    })),
    status: vi.fn(async () => ({
      backpressuredEventIds: [],
      bundleRefs: {
        agentState: null,
        vault: null,
      },
      inFlight: false,
      lastError: null,
      lastEventId: null,
      lastRunAt: null,
      nextWakeAt: null,
      pendingEventCount: 0,
      poisonedEventIds: [],
      retryingEventId: null,
      userId: "member_123",
    })),
    updateUserEnv: vi.fn(async (update: { env: Record<string, string | null> }) => ({
      configuredUserEnvKeys: Object.keys(update.env).sort(),
      userId: "member_123",
    })),
  };
}

function createGatewayConversationSessionKeyForTests(routeToken: string): string {
  return `gwcs_${Buffer.from(JSON.stringify({
    kind: "conversation",
    routeToken,
    version: 2,
  }), "utf8").toString("base64url")}`;
}

function createGatewayOutboxMessageIdForTests(routeToken: string, sourceToken: string): string {
  return `gwcm_${Buffer.from(JSON.stringify({
    kind: "outbox-message",
    routeToken,
    sourceToken,
    version: 2,
  }), "utf8").toString("base64url")}`;
}

function createGatewayAttachmentIdForTests(routeToken: string, sourceToken: string): string {
  return `gwca_${Buffer.from(JSON.stringify({
    kind: "attachment",
    routeToken,
    sourceToken,
    version: 2,
  }), "utf8").toString("base64url")}`;
}

function buildDispatchResultFixture(userId: string, eventId: string) {
  return {
    event: {
      eventId,
      lastError: null,
      state: "completed" as const,
      userId,
    },
    status: {
      backpressuredEventIds: [],
      bundleRefs: {
        agentState: null,
        vault: null,
      },
      inFlight: false,
      lastError: null,
      lastEventId: eventId,
      lastRunAt: null,
      nextWakeAt: null,
      pendingEventCount: 0,
      poisonedEventIds: [],
      retryingEventId: null,
      userId,
    },
  };
}

async function createSignedDispatchRequest(
  path: string,
  dispatch: HostedExecutionDispatchRequest,
  input: {
    timestamp?: string;
  } = {},
): Promise<Request> {
  const payload = JSON.stringify(dispatch);
  const timestamp = input.timestamp ?? "2026-03-26T12:00:00.000Z";
  const signature = await createHostedExecutionSignature({
    payload,
    secret: "dispatch-secret",
    timestamp,
  });

  return new Request(`https://runner.example.test${path}`, {
    body: payload,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-hosted-execution-signature": signature,
      "x-hosted-execution-timestamp": timestamp,
    },
    method: "POST",
  });
}
