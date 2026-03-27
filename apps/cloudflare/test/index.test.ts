import { afterEach, describe, expect, it, vi } from "vitest";

import { createHostedExecutionSignature } from "../src/auth.js";
import { createHostedExecutionJournalStore, persistHostedExecutionCommit } from "../src/execution-journal.js";
import worker, { UserRunnerDurableObject } from "../src/index.js";

describe("cloudflare worker routes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves a health endpoint even before secrets are configured", async () => {
    const response = await worker.fetch(
      new Request("https://runner.example.test/health"),
      {
        BUNDLES: {
          async get() {
            return null;
          },
          async put() {},
        },
        USER_RUNNER: {
          getByName() {
            return {
              fetch: vi.fn(),
            };
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
    const rootResponse = await worker.fetch(
      new Request("https://runner.example.test/"),
      createWorkerEnv(),
    );

    expect(rootResponse.status).toBe(200);
    await expect(rootResponse.json()).resolves.toMatchObject({
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


  it("injects the path user id into manual run requests", async () => {
    const stubFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/run", {
        body: JSON.stringify({ note: "manual" }),
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      createWorkerEnv(stubFetch, {
        HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      }),
    );

    expect(response.status).toBe(200);
    expect(stubFetch).toHaveBeenCalledTimes(1);
    const request = stubFetch.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://runner.internal/run");
    await expect(request.text()).resolves.toContain('"userId":"member_123"');
  });

  it("accepts an empty manual run body and still injects the path user id", async () => {
    const stubFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/run", {
        body: "",
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      createWorkerEnv(stubFetch, {
        HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      }),
    );

    expect(response.status).toBe(200);
    expect(stubFetch).toHaveBeenCalledTimes(1);
    const request = stubFetch.mock.calls[0]?.[0] as Request;
    await expect(request.text()).resolves.toBe('{"userId":"member_123"}');
  });

  it("accepts signed dispatch through the /internal/events alias", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const timestamp = "2026-03-26T12:00:00.000Z";
    const dispatch = {
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_123",
      occurredAt: "2026-03-20T12:00:00.000Z",
    };
    const payload = JSON.stringify(dispatch);
    const signature = await createHostedExecutionSignature({
      payload,
      secret: "dispatch-secret",
      timestamp,
    });
    const stubFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
        }),
      ),
    );

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/events", {
        body: payload,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-hb-execution-signature": signature,
          "x-hb-execution-timestamp": timestamp,
        },
        method: "POST",
      }),
      createWorkerEnv(stubFetch),
    );

    expect(response.status).toBe(200);
    expect(stubFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects stale signed dispatch requests", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:10:00.000Z"));
    const dispatch = {
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_stale",
      occurredAt: "2026-03-26T11:00:00.000Z",
    };
    const payload = JSON.stringify(dispatch);
    const staleTimestamp = "2026-03-26T12:00:00.000Z";
    const signature = await createHostedExecutionSignature({
      payload,
      secret: "dispatch-secret",
      timestamp: staleTimestamp,
    });
    const stubFetch = vi.fn();

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/dispatch", {
        body: payload,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-hb-execution-signature": signature,
          "x-hb-execution-timestamp": staleTimestamp,
        },
        method: "POST",
      }),
      createWorkerEnv(stubFetch),
    );

    expect(response.status).toBe(401);
    expect(stubFetch).not.toHaveBeenCalled();
  });

  it("rejects malformed signed dispatch timestamps", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const dispatch = {
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_malformed",
      occurredAt: "2026-03-20T11:00:00.000Z",
    };
    const payload = JSON.stringify(dispatch);
    const malformedTimestamp = "2026-03-26T12:00:00Z";
    const signature = await createHostedExecutionSignature({
      payload,
      secret: "dispatch-secret",
      timestamp: malformedTimestamp,
    });
    const stubFetch = vi.fn();

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/dispatch", {
        body: payload,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-hb-execution-signature": signature,
          "x-hb-execution-timestamp": malformedTimestamp,
        },
        method: "POST",
      }),
      createWorkerEnv(stubFetch),
    );

    expect(response.status).toBe(401);
    expect(stubFetch).not.toHaveBeenCalled();
  });

  it("rejects future signed dispatch requests beyond the skew window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const dispatch = {
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_future",
      occurredAt: "2026-03-20T11:00:00.000Z",
    };
    const payload = JSON.stringify(dispatch);
    const futureTimestamp = "2026-03-26T12:06:00.000Z";
    const signature = await createHostedExecutionSignature({
      payload,
      secret: "dispatch-secret",
      timestamp: futureTimestamp,
    });
    const stubFetch = vi.fn();

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/dispatch", {
        body: payload,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-hb-execution-signature": signature,
          "x-hb-execution-timestamp": futureTimestamp,
        },
        method: "POST",
      }),
      createWorkerEnv(stubFetch),
    );

    expect(response.status).toBe(401);
    expect(stubFetch).not.toHaveBeenCalled();
  });

  it("persists runner commits through the internal commit route", async () => {
    const bucket = createBucketStore();
    const storage = createStorage();
    const env = {
      BUNDLES: bucket.api,
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
      HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
      HOSTED_EXECUTION_SIGNING_SECRET: "dispatch-secret",
      USER_RUNNER: {
        getByName() {
          const durableObject = new UserRunnerDurableObject(storage.state, env as never);
          return {
            fetch(request: Request) {
              return durableObject.fetch(request);
            },
          };
        },
      },
    };

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/runner-events/member_123/evt_commit/commit", {
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
        }),
        headers: {
          authorization: "Bearer runner-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env as never,
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
    expect(bucket.keys()).toEqual([
      "users/member_123/agent-state.bundle.json",
      "users/member_123/execution-journal/evt_commit.json",
      "users/member_123/vault.bundle.json",
    ]);
  });

  it("persists finalized runner bundles through the internal finalize route", async () => {
    const bucket = createBucketStore();
    const storage = createStorage();
    const env = {
      BUNDLES: bucket.api,
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
      HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
      HOSTED_EXECUTION_SIGNING_SECRET: "dispatch-secret",
      USER_RUNNER: {
        getByName() {
          const durableObject = new UserRunnerDurableObject(storage.state, env as never);
          return {
            fetch(request: Request) {
              return durableObject.fetch(request);
            },
          };
        },
      },
    };

    await worker.fetch(
      new Request("https://runner.example.test/internal/runner-events/member_123/evt_finalize/commit", {
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
          authorization: "Bearer runner-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env as never,
    );

    const finalizeResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/runner-events/member_123/evt_finalize/finalize", {
        body: JSON.stringify({
          bundles: {
            agentState: Buffer.from("agent-state-final").toString("base64"),
            vault: Buffer.from("vault-final").toString("base64"),
          },
        }),
        headers: {
          authorization: "Bearer runner-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env as never,
    );
    const journalStore = createHostedExecutionJournalStore({
      bucket: bucket.api,
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

  it("rejects unauthorized runner finalization without mutating durable state", async () => {
    const bucket = createBucketStore();
    const storage = createStorage();
    const env = {
      BUNDLES: bucket.api,
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
      HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
      HOSTED_EXECUTION_SIGNING_SECRET: "dispatch-secret",
      USER_RUNNER: {
        getByName() {
          const durableObject = new UserRunnerDurableObject(storage.state, env as never);
          return {
            fetch(request: Request) {
              return durableObject.fetch(request);
            },
          };
        },
      },
    };
    const journalStore = createHostedExecutionJournalStore({
      bucket: bucket.api,
      key: Buffer.alloc(32, 9),
      keyId: "v1",
    });

    await worker.fetch(
      new Request("https://runner.example.test/internal/runner-events/member_123/evt_finalize_auth/commit", {
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
          authorization: "Bearer runner-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env as never,
    );

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/runner-events/member_123/evt_finalize_auth/finalize", {
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
      env as never,
    );

    expect(response.status).toBe(401);
    await expect(journalStore.readCommittedResult("member_123", "evt_finalize_auth")).resolves.toMatchObject({
      bundleRefs: {
        agentState: {
          size: "agent-state-committed".length,
        },
        vault: {
          size: "vault-committed".length,
        },
      },
      finalizedAt: null,
      result: {
        summary: "committed",
      },
    });
  });

  it("rejects malformed runner finalization without mutating durable state", async () => {
    const bucket = createBucketStore();
    const storage = createStorage();
    const env = {
      BUNDLES: bucket.api,
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
      HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
      HOSTED_EXECUTION_SIGNING_SECRET: "dispatch-secret",
      USER_RUNNER: {
        getByName() {
          const durableObject = new UserRunnerDurableObject(storage.state, env as never);
          return {
            fetch(request: Request) {
              return durableObject.fetch(request);
            },
          };
        },
      },
    };
    const journalStore = createHostedExecutionJournalStore({
      bucket: bucket.api,
      key: Buffer.alloc(32, 9),
      keyId: "v1",
    });

    await worker.fetch(
      new Request("https://runner.example.test/internal/runner-events/member_123/evt_finalize_bad/commit", {
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
          authorization: "Bearer runner-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env as never,
    );

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/runner-events/member_123/evt_finalize_bad/finalize", {
        body: JSON.stringify({
          bundles: {
            agentState: 42,
            vault: Buffer.from("vault-final").toString("base64"),
          },
        }),
        headers: {
          authorization: "Bearer runner-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env as never,
    );

    expect(response.status).toBe(500);
    await expect(journalStore.readCommittedResult("member_123", "evt_finalize_bad")).resolves.toMatchObject({
      bundleRefs: {
        agentState: {
          size: "agent-state-committed".length,
        },
        vault: {
          size: "vault-committed".length,
        },
      },
      finalizedAt: null,
      result: {
        summary: "committed",
      },
    });
  });

  it("rejects malformed runner commits without writing durable state", async () => {
    const bucket = createBucketStore();
    const storage = createStorage();
    const env = {
      BUNDLES: bucket.api,
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
      HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
      HOSTED_EXECUTION_SIGNING_SECRET: "dispatch-secret",
      USER_RUNNER: {
        getByName() {
          const durableObject = new UserRunnerDurableObject(storage.state, env as never);
          return {
            fetch(request: Request) {
              return durableObject.fetch(request);
            },
          };
        },
      },
    };

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/runner-events/member_123/evt_bad_commit/commit", {
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
            summary: "ok",
          },
        }),
        headers: {
          authorization: "Bearer runner-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env as never,
    );

    expect(response.status).toBe(500);
    expect(bucket.keys()).toEqual([]);
  });

  it("keeps the first durable commit for an event when duplicate callbacks arrive", async () => {
    const journalWriteStarted = createDeferred<void>();
    const releaseJournalWrite = createDeferred<void>();
    let journalWrites = 0;
    const bucket = createBucketStore({
      async onPut(key) {
        if (!key.includes("/execution-journal/")) {
          return;
        }

        journalWrites += 1;
        if (journalWrites === 1) {
          journalWriteStarted.resolve();
          await releaseJournalWrite.promise;
        }
      },
    });
    const storage = createStorage();
    const env = {
      BUNDLES: bucket.api,
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
      HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
      HOSTED_EXECUTION_SIGNING_SECRET: "dispatch-secret",
      USER_RUNNER: {
        getByName() {
          const durableObject = new UserRunnerDurableObject(storage.state, env as never);
          return {
            fetch(request: Request) {
              return durableObject.fetch(request);
            },
          };
        },
      },
    };

    const first = worker.fetch(
      new Request("https://runner.example.test/internal/runner-events/member_123/evt_first_wins/commit", {
        body: JSON.stringify({
          bundles: {
            agentState: Buffer.from("agent-state-a").toString("base64"),
            vault: Buffer.from("vault-a").toString("base64"),
          },
          currentBundleRefs: {
            agentState: null,
            vault: null,
          },
          result: {
            eventsHandled: 1,
            summary: "first",
          },
        }),
        headers: {
          authorization: "Bearer runner-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env as never,
    );
    await journalWriteStarted.promise;
    const second = worker.fetch(
      new Request("https://runner.example.test/internal/runner-events/member_123/evt_first_wins/commit", {
        body: JSON.stringify({
          bundles: {
            agentState: Buffer.from("agent-state-b").toString("base64"),
            vault: Buffer.from("vault-b").toString("base64"),
          },
          currentBundleRefs: {
            agentState: null,
            vault: null,
          },
          result: {
            eventsHandled: 1,
            summary: "second",
          },
        }),
        headers: {
          authorization: "Bearer runner-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env as never,
    );
    releaseJournalWrite.resolve();
    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    const journalStore = createHostedExecutionJournalStore({
      bucket: bucket.api,
      key: Buffer.alloc(32, 9),
      keyId: "v1",
    });

    await expect(firstResponse.json()).resolves.toMatchObject({
      committed: {
        result: {
          summary: "first",
        },
      },
      ok: true,
    });
    await expect(secondResponse.json()).resolves.toMatchObject({
      committed: {
        result: {
          summary: "first",
        },
      },
      ok: true,
    });
    expect(journalWrites).toBe(1);
    await expect(journalStore.readCommittedResult("member_123", "evt_first_wins")).resolves.toMatchObject({
      result: {
        summary: "first",
      },
    });
  });

  it("persists and reads hosted outbox delivery journal records through the runner route", async () => {
    const bucket = createBucketStore();
    const env = {
      BUNDLES: bucket.api,
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
      HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
      HOSTED_EXECUTION_SIGNING_SECRET: "dispatch-secret",
      USER_RUNNER: {
        getByName() {
          return {
            fetch: vi.fn(),
          };
        },
      },
    };

    const putResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/runner-outbox/member_123/outbox_123", {
        body: JSON.stringify({
          dedupeKey: "dedupe_123",
          delivery: {
            channel: "linq",
            sentAt: "2026-03-26T12:00:00.000Z",
            target: "chat_123",
            targetKind: "thread",
            messageLength: 21,
          },
        }),
        headers: {
          authorization: "Bearer runner-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "PUT",
      }),
      env as never,
    );

    expect(putResponse.status).toBe(200);
    await expect(putResponse.json()).resolves.toMatchObject({
      delivery: {
        channel: "linq",
        target: "chat_123",
      },
      intentId: "outbox_123",
    });

    const getResponse = await worker.fetch(
      new Request("https://runner.example.test/internal/runner-outbox/member_123/outbox_123?dedupeKey=dedupe_123", {
        headers: {
          authorization: "Bearer runner-token",
        },
        method: "GET",
      }),
      env as never,
    );

    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      delivery: {
        channel: "linq",
        target: "chat_123",
      },
      intentId: "outbox_123",
    });
    expect(bucket.keys()).toHaveLength(2);
    expect(bucket.keys()).toContain("users/member_123/outbox-deliveries/by-intent/outbox_123.json");
    expect(
      bucket.keys().some((key) => key.startsWith("users/member_123/outbox-deliveries/by-dedupe/")),
    ).toBe(true);
  });

  it("forwards operator env config updates to the durable object", async () => {
    const stubFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/env", {
        body: JSON.stringify({
          env: {
            OPENAI_API_KEY: "sk-user",
            TELEGRAM_BOT_TOKEN: "bot-token",
          },
          mode: "replace",
        }),
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "PUT",
      }),
      createWorkerEnv(stubFetch, {
        HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      }),
    );

    expect(response.status).toBe(200);
    expect(stubFetch).toHaveBeenCalledTimes(1);
    const request = stubFetch.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://runner.internal/env?userId=member_123");
    await expect(request.text()).resolves.toContain("\"OPENAI_API_KEY\":\"sk-user\"");
  });

  it("forwards operator env status reads to the durable object", async () => {
    const stubFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/env", {
        headers: {
          authorization: "Bearer control-token",
        },
        method: "GET",
      }),
      createWorkerEnv(stubFetch, {
        HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      }),
    );

    expect(response.status).toBe(200);
    expect(stubFetch).toHaveBeenCalledTimes(1);
    const request = stubFetch.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://runner.internal/env?userId=member_123");
    expect(request.method).toBe("GET");
  });

  it("forwards operator env clears to the durable object", async () => {
    const stubFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/env", {
        headers: {
          authorization: "Bearer control-token",
        },
        method: "DELETE",
      }),
      createWorkerEnv(stubFetch, {
        HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      }),
    );

    expect(response.status).toBe(200);
    expect(stubFetch).toHaveBeenCalledTimes(1);
    const request = stubFetch.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://runner.internal/env?userId=member_123");
    expect(request.method).toBe("DELETE");
  });

  it("returns HTTP 429 when dispatch backpressures a full per-user queue", async () => {
    const firstRun = createDeferred<void>();
    const durableObject = createUserRunnerDurableObject();
    const fetchMock = vi.fn()
      .mockImplementationOnce(async (_url, init) => {
        await firstRun.promise;
        return createCommittedRunnerSuccessResponse({
          bucket: durableObject.bucket,
          payload: createRunnerSuccessPayload(),
          requestBody: JSON.parse(String(init?.body)),
        });
      })
      .mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
        bucket: durableObject.bucket,
        payload: createRunnerSuccessPayload(),
        requestBody: JSON.parse(String(init?.body)),
      }));
    const originalFetch = global.fetch;
    vi.stubGlobal("fetch", fetchMock);

    try {
      const firstResponse = durableObject.durableObject.fetch(createDispatchRequest("evt_000"));
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      for (let index = 1; index < 64; index += 1) {
        await durableObject.durableObject.fetch(createDispatchRequest(`evt_${index.toString().padStart(3, "0")}`));
      }

      const overflowResponse = await durableObject.durableObject.fetch(createDispatchRequest("evt_overflow"));

      expect(overflowResponse.status).toBe(429);
      await expect(overflowResponse.json()).resolves.toMatchObject({
        backpressuredEventIds: ["evt_overflow"],
        poisonedEventIds: [],
      });

      firstRun.resolve();
      await firstResponse;
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("returns HTTP 429 for manual runs when the queue is already full", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const firstRun = createDeferred<void>();
    const durableObject = createUserRunnerDurableObject();
    const fetchMock = vi.fn()
      .mockImplementationOnce(async (_url, init) => {
        await firstRun.promise;
        return createCommittedRunnerSuccessResponse({
          bucket: durableObject.bucket,
          payload: createRunnerSuccessPayload(),
          requestBody: JSON.parse(String(init?.body)),
        });
      })
      .mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
        bucket: durableObject.bucket,
        payload: createRunnerSuccessPayload(),
        requestBody: JSON.parse(String(init?.body)),
      }));
    const originalFetch = global.fetch;
    vi.stubGlobal("fetch", fetchMock);

    try {
      const firstResponse = durableObject.durableObject.fetch(createDispatchRequest("evt_000"));
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      for (let index = 1; index < 64; index += 1) {
        await durableObject.durableObject.fetch(createDispatchRequest(`evt_${index.toString().padStart(3, "0")}`));
      }

      const manualEventId = `manual:${Date.now()}`;
      const runResponse = await durableObject.durableObject.fetch(
        new Request("https://runner.internal/run", {
          body: JSON.stringify({
            userId: "member_123",
          }),
          method: "POST",
        }),
      );

      expect(runResponse.status).toBe(429);
      await expect(runResponse.json()).resolves.toMatchObject({
        backpressuredEventIds: [manualEventId],
        poisonedEventIds: [],
      });

      firstRun.resolve();
      await firstResponse;
    } finally {
      global.fetch = originalFetch;
    }
  });
});

function createWorkerEnv(
  stubFetch = vi.fn(),
  overrides: Partial<{
    HOSTED_EXECUTION_CONTROL_TOKEN: string;
    HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: string;
  }> = {},
): {
  BUNDLES: { delete?: () => Promise<void>; get: () => Promise<null>; put: () => Promise<void> };
  HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: string;
  HOSTED_EXECUTION_CONTROL_TOKEN?: string;
  HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN?: string;
  HOSTED_EXECUTION_SIGNING_SECRET: string;
  USER_RUNNER: { getByName: () => { fetch: typeof stubFetch } };
} {
  return {
    BUNDLES: {
      async get() {
        return null;
      },
      async put() {},
    },
    HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    HOSTED_EXECUTION_CONTROL_TOKEN: overrides.HOSTED_EXECUTION_CONTROL_TOKEN,
    HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: overrides.HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN,
    HOSTED_EXECUTION_SIGNING_SECRET: "dispatch-secret",
    USER_RUNNER: {
      getByName() {
        return {
          fetch: stubFetch,
        };
      },
    },
  };
}

function createBucketStore(input: {
  onPut?: (key: string, value: string) => Promise<void> | void;
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
  let transition = Promise.resolve();
  const portFetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === "http://container/health") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    return globalThis.fetch(url, init);
  });
  const container = {
    running: false,
    start: vi.fn(async () => {
      container.running = true;
    }),
    getTcpPort() {
      return {
        fetch: portFetch,
      };
    },
    destroy: vi.fn(async () => {
      container.running = false;
    }),
  };
  const state = {
    async blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
      const result = transition.then(callback, callback);
      transition = result.then(() => undefined, () => undefined);
      return result;
    },
    container,
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
    },
  };

  return {
    container,
    portFetch,
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

function createDispatchRequest(eventId: string): Request {
  return new Request("https://runner.internal/dispatch", {
    body: JSON.stringify({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId,
      occurredAt: "2026-03-26T12:00:00.000Z",
    }),
    method: "POST",
  });
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

function createUserRunnerDurableObject() {
  const bucket = createBucketStore();
  const storage = createStorage();
  const env = {
    BUNDLES: bucket.api,
    HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    HOSTED_EXECUTION_CLOUDFLARE_BASE_URL: "https://worker.example.test",
    HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
    HOSTED_EXECUTION_SIGNING_SECRET: "dispatch-secret",
  };

  return {
    bucket,
    durableObject: new UserRunnerDurableObject(storage.state, env as never),
    env,
    storage,
  };
}
