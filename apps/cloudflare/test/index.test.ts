import { afterEach, describe, expect, it, vi } from "vitest";

import { createHostedExecutionSignature } from "../src/auth.ts";
import {
  parseHostedEmailThreadTarget,
  type HostedExecutionDispatchRequest,
} from "@healthybob/runtime-state";
import { encryptHostedBundle } from "../src/crypto.ts";
import { createHostedExecutionJournalStore, persistHostedExecutionCommit } from "../src/execution-journal.ts";
import worker, { UserRunnerDurableObject } from "../src/index.ts";
import { handleRunnerOutboundRequest } from "../src/runner-outbound.ts";
import { createTestSqlStorage } from "./sql-storage.ts";

describe("cloudflare worker routes", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it("accepts signed dispatch through the /internal/events alias", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const stub = createUserRunnerStub();
    const dispatch = createDispatch("evt_123");
    const request = await createSignedDispatchRequest("/internal/events", dispatch);

    const response = await worker.fetch(
      request,
      createWorkerEnv(stub),
    );

    expect(response.status).toBe(200);
    expect(stub.dispatch).toHaveBeenCalledTimes(1);
    expect(stub.dispatch).toHaveBeenCalledWith(dispatch);
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
      "transient/execution-journal/member_123/evt_commit.json",
      "users/member_123/agent-state.bundle.json",
      "users/member_123/vault.bundle.json",
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

  it("persists side-effect journal records through the canonical route and reads them back through the legacy alias", async () => {
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
      new Request("http://outbox.worker/intents/outbox_123?kind=assistant.delivery&fingerprint=dedupe_123", {
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

  it("falls back to fingerprint side-effect records across the legacy alias and canonical route", async () => {
    const env = createWorkerEnv();

    await callRunnerOutbound(
      new Request("http://outbox.worker/intents/outbox_a?kind=assistant.delivery&fingerprint=dedupe_123", {
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

  it("reads legacy side-effect journal objects through the canonical route after the transient prefix move", async () => {
    const env = createWorkerEnv();
    const legacyRecord = {
      delivery: createOutboxDelivery(),
      effectId: "outbox_legacy",
      fingerprint: "dedupe_legacy",
      intentId: "outbox_legacy",
      kind: "assistant.delivery" as const,
      recordedAt: "2026-03-26T12:00:05.000Z",
    };
    const envelope = await encryptHostedBundle({
      key: Buffer.alloc(32, 9),
      keyId: "v1",
      plaintext: new TextEncoder().encode(JSON.stringify(legacyRecord)),
    });

    await env.BUNDLES.put(
      "users/member_123/outbox-deliveries/by-intent/outbox_legacy.json",
      JSON.stringify(envelope),
    );

    const response = await callRunnerOutbound(
      new Request("http://side-effects.worker/effects/outbox_legacy?kind=assistant.delivery&fingerprint=dedupe_legacy", {
        method: "GET",
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      effectId: "outbox_legacy",
      record: {
        effectId: "outbox_legacy",
        fingerprint: "dedupe_legacy",
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
          mode: "merge",
          OPENAI_API_KEY: "sk-test",
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
    expect(stub.updateUserEnv).toHaveBeenCalledWith("member_123", {
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
    expect(stub.getUserEnvStatus).toHaveBeenCalledWith("member_123");

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
    expect(stub.clearUserEnv).toHaveBeenCalledWith("member_123");

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
    expect(stub.status).toHaveBeenCalledWith("member_123");
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

  it("sends hosted email through email.worker and returns a canonical serialized thread target", async () => {
    const env = createWorkerEnv(createUserRunnerStub(), {
      HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID: "acct_123",
      HOSTED_EMAIL_CLOUDFLARE_API_TOKEN: "cf-token",
      HOSTED_EMAIL_DEFAULT_SUBJECT: "Healthy Bob update",
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
          identityId: "assistant@mail.example.test",
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
    expect(threadTarget?.lastMessageId).toMatch(/^<hb\./u);
    expect(threadTarget?.subject).toBe("Healthy Bob update");
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
      new Request("http://outbox.worker/intents/outbox_123", {
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
      new Request("https://runner.example.test/internal/events", {
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
      backpressuredEventIds: ["evt_overflow"],
      poisonedEventIds: [],
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
  return {
    BUNDLES: createBucketStore().api,
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
): Promise<Response> {
  return handleRunnerOutboundRequest(request, env as never, "member_123");
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
        request: Record<string, unknown>;
      };

      return globalThis.fetch("https://runner-container.internal/__internal/run", {
        body: JSON.stringify(payload.request),
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
        fetch: runnerContainerFetch,
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
    messageLength: "Queued reply".length,
    sentAt: "2026-03-26T12:00:00.000Z",
    target: "thread_123",
    targetKind: "thread" as const,
  };
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

  return createCommittedRunnerSuccessResponse({
    bucket: input.bucket,
    payload: input.payload,
    requestBody: requestBody.request,
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
    clearUserEnv: vi.fn(async (userId: string) => ({
      configuredUserEnvKeys: [],
      userId,
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
    getUserEnvStatus: vi.fn(async (userId: string) => ({
      configuredUserEnvKeys: [],
      userId,
    })),
    status: vi.fn(async (userId: string) => ({
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
      userId,
    })),
    updateUserEnv: vi.fn(async (userId: string, update: { env: Record<string, string | null> }) => ({
      configuredUserEnvKeys: Object.keys(update.env).sort(),
      userId,
    })),
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
      "x-hb-execution-signature": signature,
      "x-hb-execution-timestamp": timestamp,
    },
    method: "POST",
  });
}
