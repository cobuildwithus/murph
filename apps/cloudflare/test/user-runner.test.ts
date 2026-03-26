import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeHostedBundleTextFile } from "@healthybob/runtime-state";

import { persistHostedExecutionCommit } from "../src/execution-journal.js";
import { HostedUserRunner } from "../src/user-runner.js";

describe("HostedUserRunner", () => {
  const bucket = createBucket();
  const storage = createStorage();
  const environment = {
    allowedUserEnvKeys: null,
    allowedUserEnvPrefixes: null,
    bundleEncryptionKey: Uint8Array.from({ length: 32 }, () => 7),
    bundleEncryptionKeyId: "v1",
    cloudflareBaseUrl: "https://worker.example.test",
    controlToken: null,
    defaultAlarmDelayMs: 60_000,
    dispatchSigningSecret: "dispatch-secret",
    maxEventAttempts: 3,
    retryDelayMs: 10_000,
    runnerBaseUrl: "https://runner.example.test",
    runnerControlToken: "runner-token",
    runnerTimeoutMs: 60_000,
  };

  beforeEach(() => {
    bucket.clear();
    storage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("dispatches work through the runner endpoint and persists encrypted bundles", async () => {
    const resultPayload = {
      bundles: {
        agentState: Buffer.from("agent-state").toString("base64"),
        vault: Buffer.from("vault").toString("base64"),
      },
      result: {
        eventsHandled: 1,
        summary: "ok",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        await commitResultForRunnerRequest({
          bucket,
          environment,
          payload: resultPayload,
          requestBody: JSON.parse(String(init?.body)),
        });

        return new Response(JSON.stringify(resultPayload), {
          status: 200,
        });
      }),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const status = await runner.dispatch({
      event: {
        kind: "member.activated",
        linqChatId: "chat_123",
        normalizedPhoneNumber: "+15551234567",
        userId: "member_123",
      },
      eventId: "evt_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

    expect(status.userId).toBe("member_123");
    expect(status.lastEventId).toBe("evt_123");
    expect(status.lastError).toBeNull();
    expect(status.bundleRefs.vault?.size).toBe(5);
    expect(status.bundleRefs.agentState?.size).toBe(11);
    expect(status.pendingEventCount).toBe(0);
    expect(status.poisonedEventIds).toEqual([]);
    expect(status.retryingEventId).toBeNull();
    expect(storage.lastAlarm).not.toBeNull();
    expect(bucket.keys()).toEqual([
      "users/member_123/agent-state.bundle.json",
      "users/member_123/execution-journal/evt_123.json",
      "users/member_123/vault.bundle.json",
    ]);
  });


  it("reuses existing bundle refs when the runner returns unchanged bundle payloads", async () => {
    const encodedAgent = Buffer.from("agent-state").toString("base64");
    const encodedVault = Buffer.from("vault").toString("base64");
    const resultPayload = {
      bundles: {
        agentState: encodedAgent,
        vault: encodedVault,
      },
      result: {
        eventsHandled: 1,
        summary: "ok",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        await commitResultForRunnerRequest({
          bucket,
          environment,
          payload: resultPayload,
          requestBody: JSON.parse(String(init?.body)),
        });

        return new Response(JSON.stringify(resultPayload), {
          status: 200,
        });
      }),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const first = await runner.dispatch({
      event: {
        kind: "member.activated",
        linqChatId: "chat_123",
        normalizedPhoneNumber: "+15551234567",
        userId: "member_123",
      },
      eventId: "evt_first",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });
    const writeCountAfterFirstRun = bucket.putCount();

    const second = await runner.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_second",
      occurredAt: "2026-03-26T12:01:00.000Z",
    });

    expect(second.bundleRefs).toEqual(first.bundleRefs);
    expect(bucket.putCount()).toBe(writeCountAfterFirstRun + 1);
  });

  it("retries failed events and eventually poisons them after repeated runner failures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("runner failed", {
          status: 503,
        }),
      ),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const first = await runner.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_retry_1",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

    expect(first.lastError).toContain("HTTP 503");
    expect(first.pendingEventCount).toBe(1);
    expect(first.retryingEventId).toBe("evt_retry_1");

    vi.setSystemTime(new Date("2026-03-26T12:00:10.000Z"));
    await runner.alarm();
    vi.setSystemTime(new Date("2026-03-26T12:00:30.000Z"));
    await runner.alarm();

    const final = await runner.status("member_123");

    expect(final.pendingEventCount).toBe(0);
    expect(final.poisonedEventIds).toEqual(["evt_retry_1"]);
    expect(final.retryingEventId).toBeNull();
    expect(final.lastError).toContain("HTTP 503");
  });

  it("normalizes legacy durable-object state that predates replay and backpressure tracking", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => createCommittedRunnerSuccessResponse({
        bucket,
        environment,
        init,
      })),
    );
    await storage.state.storage.put("state", {
      activated: false,
      bundleRefs: {
        agentState: null,
        vault: null,
      },
      inFlight: false,
      lastError: null,
      lastEventId: null,
      lastRunAt: null,
      nextWakeAt: null,
      pendingEvents: [],
      poisonedEventIds: [],
      recentEventIds: [],
      retryingEventId: null,
      userId: "member_123",
    });
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    await expect(runner.dispatch(createDispatch("evt_legacy"))).resolves.toMatchObject({
      backpressuredEventIds: [],
      lastEventId: "evt_legacy",
      pendingEventCount: 0,
    });
  });

  it("backpressures new overflow events instead of evicting the oldest pending work", async () => {
    const firstRun = createDeferred<void>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(async (_url, init) => {
        await firstRun.promise;
        return createCommittedRunnerSuccessResponse({
          bucket,
          environment,
          init,
        });
      })
      .mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
        bucket,
        environment,
        init,
      }));
    vi.stubGlobal("fetch", fetchMock);
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const firstDispatch = runner.dispatch(createDispatch("evt_000"));
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    for (let index = 1; index < 64; index += 1) {
      await runner.dispatch(createDispatch(`evt_${index.toString().padStart(3, "0")}`));
    }

    const overflow = await runner.dispatch(createDispatch("evt_overflow"));

    expect(overflow.pendingEventCount).toBe(64);
    expect(overflow.backpressuredEventIds).toEqual(["evt_overflow"]);
    expect(overflow.poisonedEventIds).toEqual([]);

    firstRun.resolve();
    await firstDispatch;

    expect(readDispatchedEventIds(fetchMock)).toEqual([
      ...Array.from({ length: 64 }, (_, index) => `evt_${index.toString().padStart(3, "0")}`),
    ]);
    await expect(runner.status("member_123")).resolves.toMatchObject({
      backpressuredEventIds: ["evt_overflow"],
      lastEventId: "evt_063",
      pendingEventCount: 0,
      poisonedEventIds: [],
    });
  });

  it("serializes concurrent enqueue mutations while another run is already in flight", async () => {
    const firstRun = createDeferred<void>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(async (_url, init) => {
        await firstRun.promise;
        return createCommittedRunnerSuccessResponse({
          bucket,
          environment,
          init,
        });
      })
      .mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
        bucket,
        environment,
        init,
      }));
    vi.stubGlobal("fetch", fetchMock);
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const firstDispatch = runner.dispatch(createDispatch("evt_000"));
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    await Promise.all([
      runner.dispatch(createDispatch("evt_concurrent_a")),
      runner.dispatch(createDispatch("evt_concurrent_b")),
    ]);

    firstRun.resolve();
    await firstDispatch;

    expect(readDispatchedEventIds(fetchMock)).toHaveLength(3);
    expect(readDispatchedEventIds(fetchMock)).toContain("evt_concurrent_a");
    expect(readDispatchedEventIds(fetchMock)).toContain("evt_concurrent_b");
    await expect(runner.status("member_123")).resolves.toMatchObject({
      pendingEventCount: 0,
      poisonedEventIds: [],
    });
  });

  it("claims due work atomically so concurrent idle dispatches execute each event once", async () => {
    const firstRun = createDeferred<void>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(async (_url, init) => {
        await firstRun.promise;
        return createCommittedRunnerSuccessResponse({
          bucket,
          environment,
          init,
        });
      })
      .mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
        bucket,
        environment,
        init,
      }));
    vi.stubGlobal("fetch", fetchMock);
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const dispatchA = runner.dispatch(createDispatch("evt_idle_a"));
    const dispatchB = runner.dispatch(createDispatch("evt_idle_b"));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    firstRun.resolve();
    await Promise.all([dispatchA, dispatchB]);

    expect(readDispatchedEventIds(fetchMock)).toHaveLength(2);
    expect(readDispatchedEventIds(fetchMock).filter((eventId) => eventId === "evt_idle_a")).toHaveLength(1);
    expect(readDispatchedEventIds(fetchMock).filter((eventId) => eventId === "evt_idle_b")).toHaveLength(1);
    await expect(runner.status("member_123")).resolves.toMatchObject({
      pendingEventCount: 0,
      poisonedEventIds: [],
    });
  });

  it("keeps backpressured overflow events out of the poisoned set", async () => {
    const firstRun = createDeferred<void>();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockImplementationOnce(async (_url, init) => {
          await firstRun.promise;
          return createCommittedRunnerSuccessResponse({
            bucket,
            environment,
            init,
          });
        })
        .mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
          bucket,
          environment,
          init,
        })),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const firstDispatch = runner.dispatch(createDispatch("evt_000"));
    await vi.waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    for (let index = 1; index < 64; index += 1) {
      await runner.dispatch(createDispatch(`evt_fill_${index}`));
    }

    const overflow = await runner.dispatch(createDispatch("evt_backpressured"));

    expect(overflow.backpressuredEventIds).toEqual(["evt_backpressured"]);
    expect(overflow.poisonedEventIds).not.toContain("evt_backpressured");

    firstRun.resolve();
    await firstDispatch;

    await expect(runner.status("member_123")).resolves.toMatchObject({
      backpressuredEventIds: ["evt_backpressured"],
      poisonedEventIds: [],
    });
  });

  it("retries a previously backpressured event deterministically once queue capacity frees up", async () => {
    const firstRun = createDeferred<void>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(async (_url, init) => {
        await firstRun.promise;
        return createCommittedRunnerSuccessResponse({
          bucket,
          environment,
          init,
        });
      })
      .mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
        bucket,
        environment,
        init,
      }));
    vi.stubGlobal("fetch", fetchMock);
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const firstDispatch = runner.dispatch(createDispatch("evt_000"));
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    for (let index = 1; index < 64; index += 1) {
      await runner.dispatch(createDispatch(`evt_fill_${index}`));
    }

    const firstBackpressure = await runner.dispatch(createDispatch("evt_retry"));
    const secondBackpressure = await runner.dispatch(createDispatch("evt_retry"));

    expect(firstBackpressure.pendingEventCount).toBe(64);
    expect(firstBackpressure.backpressuredEventIds).toEqual(["evt_retry"]);
    expect(secondBackpressure.pendingEventCount).toBe(64);
    expect(secondBackpressure.backpressuredEventIds).toEqual(["evt_retry"]);
    expect(readDispatchedEventIds(fetchMock)).toEqual(["evt_000"]);

    firstRun.resolve();
    await firstDispatch;

    const replayed = await runner.dispatch(createDispatch("evt_retry"));

    expect(replayed.backpressuredEventIds).toEqual([]);
    expect(replayed.lastEventId).toBe("evt_retry");
    expect(replayed.pendingEventCount).toBe(0);
    expect(replayed.poisonedEventIds).toEqual([]);
    expect(readDispatchedEventIds(fetchMock)).toContain("evt_retry");
    expect(readDispatchedEventIds(fetchMock).filter((eventId) => eventId === "evt_retry")).toHaveLength(1);
  });

  it("preserves newer queued work and backpressure markers when an in-flight runner call fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const firstRun = createDeferred<Response>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => firstRun.promise)
      .mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
        bucket,
        environment,
        init,
      }));
    vi.stubGlobal("fetch", fetchMock);
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const firstDispatch = runner.dispatch(createDispatch("evt_000"));
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    for (let index = 1; index < 64; index += 1) {
      await runner.dispatch(createDispatch(`evt_fail_fill_${index}`));
    }

    const overflow = await runner.dispatch(createDispatch("evt_fail_backpressured"));
    expect(overflow.backpressuredEventIds).toEqual(["evt_fail_backpressured"]);

    firstRun.resolve(new Response("runner failed", { status: 503 }));
    const failed = await firstDispatch;

    expect(failed.pendingEventCount).toBe(64);
    expect(failed.backpressuredEventIds).toEqual(["evt_fail_backpressured"]);
    expect(failed.poisonedEventIds).toEqual([]);
    expect(failed.retryingEventId).toBe("evt_000");

    await runner.alarm();

    await expect(runner.status("member_123")).resolves.toMatchObject({
      backpressuredEventIds: ["evt_fail_backpressured"],
      pendingEventCount: 1,
      poisonedEventIds: [],
    });
    expect(readDispatchedEventIds(fetchMock)).toContain("evt_fail_fill_1");
    expect(readDispatchedEventIds(fetchMock)).not.toContain("evt_fail_backpressured");
  });

  it("recovers a durable commit when the runner response is lost", async () => {
    let sideEffects = 0;
    const resultPayload = {
      bundles: {
        agentState: Buffer.from("agent-state").toString("base64"),
        vault: Buffer.from("vault").toString("base64"),
      },
      result: {
        eventsHandled: 1,
        summary: "ok",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        sideEffects += 1;
        await commitResultForRunnerRequest({
          bucket,
          environment,
          payload: resultPayload,
          requestBody: JSON.parse(String(init?.body)),
        });
        throw new Error("network timeout");
      }),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    const dispatch = {
      event: {
        kind: "assistant.cron.tick" as const,
        reason: "manual" as const,
        userId: "member_123",
      },
      eventId: "evt_lost_response",
      occurredAt: "2026-03-26T12:15:00.000Z",
    };

    const first = await runner.dispatch(dispatch);
    const second = await runner.dispatch(dispatch);

    expect(first.pendingEventCount).toBe(0);
    expect(first.lastError).toBeNull();
    expect(first.lastEventId).toBe("evt_lost_response");
    expect(second.pendingEventCount).toBe(0);
    expect(sideEffects).toBe(1);
  });

  it("keeps an event pending when the runner returns 200 before the durable commit exists", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          bundles: {
            agentState: Buffer.from("agent-state").toString("base64"),
            vault: Buffer.from("vault").toString("base64"),
          },
          result: {
            eventsHandled: 1,
            summary: "ok",
          },
        }),
        {
          status: 200,
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    const dispatch = {
      event: {
        kind: "assistant.cron.tick" as const,
        reason: "manual" as const,
        userId: "member_123",
      },
      eventId: "evt_missing_commit",
      occurredAt: "2026-03-26T12:18:00.000Z",
    };

    const first = await runner.dispatch(dispatch);

    expect(first.pendingEventCount).toBe(1);
    expect(first.retryingEventId).toBe("evt_missing_commit");
    expect(first.lastError).toContain("durable commit");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await persistHostedExecutionCommit({
      bucket: bucket.api,
      currentBundleRefs: {
        agentState: null,
        vault: null,
      },
      eventId: dispatch.eventId,
      key: environment.bundleEncryptionKey,
      keyId: environment.bundleEncryptionKeyId,
      payload: {
        bundles: {
          agentState: Buffer.from("agent-state").toString("base64"),
          vault: Buffer.from("vault").toString("base64"),
        },
        result: {
          eventsHandled: 1,
          summary: "ok",
        },
      },
      userId: dispatch.event.userId,
    });

    const second = await runner.dispatch(dispatch);

    expect(second.pendingEventCount).toBe(0);
    expect(second.retryingEventId).toBeNull();
    expect(second.lastError).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("applies a precommitted event on retry without rerunning side effects", async () => {
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    const dispatch = {
      event: {
        kind: "assistant.cron.tick" as const,
        reason: "manual" as const,
        userId: "member_123",
      },
      eventId: "evt_ack_lost",
      occurredAt: "2026-03-26T12:20:00.000Z",
    };
    await storage.state.storage.put("state", {
      activated: false,
      bundleRefs: {
        agentState: null,
        vault: null,
      },
      inFlight: false,
      lastError: "timeout",
      lastEventId: dispatch.eventId,
      lastRunAt: null,
      nextWakeAt: null,
      pendingEvents: [
        {
          attempts: 1,
          availableAt: dispatch.occurredAt,
          dispatch,
          enqueuedAt: dispatch.occurredAt,
          lastError: "timeout",
        },
      ],
      poisonedEventIds: [],
      recentEventIds: [],
      retryingEventId: dispatch.eventId,
      userId: dispatch.event.userId,
    });
    await persistHostedExecutionCommit({
      bucket: bucket.api,
      currentBundleRefs: {
        agentState: null,
        vault: null,
      },
      eventId: dispatch.eventId,
      key: environment.bundleEncryptionKey,
      keyId: environment.bundleEncryptionKeyId,
      payload: {
        bundles: {
          agentState: Buffer.from("agent-state").toString("base64"),
          vault: Buffer.from("vault").toString("base64"),
        },
        result: {
          eventsHandled: 1,
          summary: "ok",
        },
      },
      userId: dispatch.event.userId,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const status = await runner.dispatch(dispatch);

    expect(status.pendingEventCount).toBe(0);
    expect(status.retryingEventId).toBeNull();
    expect(status.lastError).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a committed journal entry as authoritative even after recent-event cache rollover", async () => {
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    const dispatch = {
      event: {
        kind: "assistant.cron.tick" as const,
        reason: "manual" as const,
        userId: "member_123",
      },
      eventId: "evt_committed_only",
      occurredAt: "2026-03-26T12:25:00.000Z",
    };
    await storage.state.storage.put("state", {
      activated: false,
      bundleRefs: {
        agentState: null,
        vault: null,
      },
      inFlight: false,
      lastError: null,
      lastEventId: "older_event",
      lastRunAt: "2026-03-26T12:24:00.000Z",
      nextWakeAt: null,
      pendingEvents: [],
      poisonedEventIds: [],
      recentEventIds: Array.from({ length: 64 }, (_, index) => `older_event_${index}`),
      retryingEventId: null,
      userId: dispatch.event.userId,
    });
    await persistHostedExecutionCommit({
      bucket: bucket.api,
      currentBundleRefs: {
        agentState: null,
        vault: null,
      },
      eventId: dispatch.eventId,
      key: environment.bundleEncryptionKey,
      keyId: environment.bundleEncryptionKeyId,
      payload: {
        bundles: {
          agentState: Buffer.from("agent-state").toString("base64"),
          vault: Buffer.from("vault").toString("base64"),
        },
        result: {
          eventsHandled: 1,
          summary: "ok",
        },
      },
      userId: dispatch.event.userId,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const status = await runner.dispatch(dispatch);

    expect(status.pendingEventCount).toBe(0);
    expect(status.lastError).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps replay suppression after a durable-object restart", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const fetchSpy = vi.fn().mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
      bucket,
      environment,
      init,
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const firstRunner = new HostedUserRunner(storage.state, environment, bucket.api);
    await firstRunner.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_restart_safe",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

    const restartedRunner = new HostedUserRunner(storage.state, environment, bucket.api);
    vi.setSystemTime(new Date("2026-03-26T12:30:00.000Z"));
    await restartedRunner.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_restart_safe",
      occurredAt: "2026-03-26T12:30:00.000Z",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("allows a consumed event id again after the replay TTL expires without refresh on read", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const fetchSpy = vi.fn().mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
      bucket,
      environment,
      init,
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const firstRunner = new HostedUserRunner(storage.state, environment, bucket.api);
    await firstRunner.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_ttl_expiry",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

    vi.setSystemTime(new Date("2026-04-02T12:00:01.000Z"));
    const restartedRunner = new HostedUserRunner(storage.state, environment, bucket.api);

    await restartedRunner.status("member_123");
    await restartedRunner.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_ttl_expiry",
      occurredAt: "2026-04-02T12:00:01.000Z",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("backfills legacy replay state once without refreshing the stored expiry on later reads", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    await storage.state.storage.put("state", {
      activated: false,
      bundleRefs: {
        agentState: null,
        vault: null,
      },
      inFlight: false,
      lastError: null,
      lastEventId: "evt_legacy",
      lastRunAt: null,
      nextWakeAt: null,
      pendingEvents: [],
      poisonedEventIds: ["evt_poisoned_legacy"],
      recentEventIds: ["evt_legacy"],
      retryingEventId: null,
      userId: "member_123",
    });
    const fetchSpy = vi.fn().mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
      bucket,
      environment,
      init,
    }));
    vi.stubGlobal("fetch", fetchSpy);
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    await runner.status("member_123");
    const migrated = await storage.state.storage.get<{
      consumedEventExpirations?: Record<string, string>;
    }>("state");
    const firstExpiry = migrated?.consumedEventExpirations?.evt_legacy ?? null;

    expect(firstExpiry).not.toBeNull();

    vi.setSystemTime(new Date("2026-03-26T12:10:00.000Z"));
    await runner.status("member_123");
    const reread = await storage.state.storage.get<{
      consumedEventExpirations?: Record<string, string>;
    }>("state");

    expect(reread?.consumedEventExpirations?.evt_legacy).toBe(firstExpiry);

    await runner.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_legacy",
      occurredAt: "2026-03-26T12:10:00.000Z",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("clears stale poisoned status after TTL expiry and a successful replay", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("runner failed", {
          status: 503,
        }),
      ),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    await runner.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_poison_expiry",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });
    vi.setSystemTime(new Date("2026-03-26T12:00:10.000Z"));
    await runner.alarm();
    vi.setSystemTime(new Date("2026-03-26T12:00:30.000Z"));
    await runner.alarm();

    expect((await runner.status("member_123")).poisonedEventIds).toContain("evt_poison_expiry");

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
      bucket,
      environment,
      init,
    })));
    vi.setSystemTime(new Date("2026-04-02T12:00:31.000Z"));
    const replayed = await runner.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_poison_expiry",
      occurredAt: "2026-04-02T12:00:31.000Z",
    });

    expect(replayed.poisonedEventIds).not.toContain("evt_poison_expiry");
  });

  it("stores encrypted per-user env config inside the agent-state bundle", async () => {
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const saved = await runner.updateUserEnv("member_123", {
      env: {
        OPENAI_API_KEY: "sk-user",
        TELEGRAM_BOT_TOKEN: "bot-token",
      },
      mode: "replace",
    });

    expect(saved.configuredUserEnvKeys).toEqual([
      "OPENAI_API_KEY",
      "TELEGRAM_BOT_TOKEN",
    ]);
    expect(bucket.keys()).toEqual(["users/member_123/agent-state.bundle.json"]);
    await expect(runner.getUserEnvStatus("member_123")).resolves.toEqual({
      configuredUserEnvKeys: ["OPENAI_API_KEY", "TELEGRAM_BOT_TOKEN"],
      userId: "member_123",
    });
  });

  it("clears per-user env config without dropping unrelated agent-state bundle data", async () => {
    const initialAgentState = writeHostedBundleTextFile({
      bytes: null,
      kind: "agent-state",
      path: "automation.json",
      root: "assistant-state",
      text: "{\"autoReplyChannels\":[\"linq\"]}\n",
    });
    const resultPayload = {
      bundles: {
        agentState: Buffer.from(initialAgentState).toString("base64"),
        vault: Buffer.from("vault").toString("base64"),
      },
      result: {
        eventsHandled: 1,
        summary: "ok",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        await commitResultForRunnerRequest({
          bucket,
          environment,
          payload: resultPayload,
          requestBody: JSON.parse(String(init?.body)),
        });

        return new Response(JSON.stringify(resultPayload), {
          status: 200,
        });
      }),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    await runner.dispatch({
      event: {
        kind: "member.activated",
        linqChatId: "chat_123",
        normalizedPhoneNumber: "+15551234567",
        userId: "member_123",
      },
      eventId: "evt_bootstrap",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });
    const writesAfterBootstrap = bucket.putCount();

    await runner.updateUserEnv("member_123", {
      env: {
        OPENAI_API_KEY: "sk-user",
      },
      mode: "replace",
    });
    expect(bucket.putCount()).toBeGreaterThan(writesAfterBootstrap);

    const cleared = await runner.clearUserEnv("member_123");

    expect(cleared.configuredUserEnvKeys).toEqual([]);
    expect(bucket.keys()).toEqual([
      "users/member_123/agent-state.bundle.json",
      "users/member_123/execution-journal/evt_bootstrap.json",
      "users/member_123/vault.bundle.json",
    ]);
  });

  it("supports extension-only keys across update and status reads", async () => {
    const runner = new HostedUserRunner(
      storage.state,
      {
        ...environment,
        allowedUserEnvKeys: "CUSTOM_API_KEY",
      },
      bucket.api,
    );

    await expect(runner.updateUserEnv("member_123", {
      env: {
        CUSTOM_API_KEY: "custom-secret",
      },
      mode: "replace",
    })).resolves.toEqual({
      configuredUserEnvKeys: ["CUSTOM_API_KEY"],
      userId: "member_123",
    });
    await expect(runner.getUserEnvStatus("member_123")).resolves.toEqual({
      configuredUserEnvKeys: ["CUSTOM_API_KEY"],
      userId: "member_123",
    });
  });

  it("clears the durable-object alarm when no next wake remains", async () => {
    const resultPayload = {
      bundles: {
        agentState: Buffer.from("agent-state").toString("base64"),
        vault: Buffer.from("vault").toString("base64"),
      },
      result: {
        eventsHandled: 1,
        summary: "ok",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        await commitResultForRunnerRequest({
          bucket,
          environment,
          payload: resultPayload,
          requestBody: JSON.parse(String(init?.body)),
        });

        return new Response(JSON.stringify(resultPayload), {
          status: 200,
        });
      }),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    await runner.dispatch({
      event: {
        kind: "member.activated",
        linqChatId: "chat_123",
        normalizedPhoneNumber: "+15551234567",
        userId: "member_123",
      },
      eventId: "evt_alarm_clear",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });
    expect(storage.lastAlarm).not.toBeNull();

    storage.clear();
    await runner.alarm();

    expect(storage.lastAlarm).toBeNull();
  });
});

function createBucket() {
  const values = new Map<string, string>();
  let writes = 0;

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
        writes += 1;
        values.set(key, value);
      },
    },
    clear() {
      values.clear();
      writes = 0;
    },
    keys() {
      return [...values.keys()].sort();
    },
    putCount() {
      return writes;
    },
  };
}

function createStorage() {
  const values = new Map<string, unknown>();
  let transition = Promise.resolve();
  const state = {
    async blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
      const result = transition.then(callback, callback);
      transition = result.then(() => undefined, () => undefined);
      return result;
    },
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        return values.get(key) as T | undefined;
      },
      async put<T>(key: string, value: T): Promise<void> {
        values.set(key, value);
      },
      async deleteAlarm(): Promise<void> {
        storage.lastAlarm = null;
      },
      async getAlarm(): Promise<number | null> {
        return storage.lastAlarm;
      },
      async setAlarm(value: number | Date): Promise<void> {
        storage.lastAlarm = value instanceof Date ? value.getTime() : value;
      },
    },
  };
  const storage = {
    clear() {
      values.clear();
      storage.lastAlarm = null;
    },
    lastAlarm: null as number | null,
    state,
  };

  return storage;
}

function createDispatch(eventId: string) {
  return {
    event: {
      kind: "assistant.cron.tick" as const,
      reason: "manual" as const,
      userId: "member_123",
    },
    eventId,
    occurredAt: "2026-03-26T12:00:00.000Z",
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

function createRunnerSuccessPayload(input: Partial<{
  agentState: string | null;
  eventsHandled: number;
  summary: string;
  vault: string | null;
}> = {}) {
  return {
    bundles: {
      agentState: input.agentState ?? null,
      vault: input.vault ?? null,
    },
    result: {
      eventsHandled: input.eventsHandled ?? 1,
      summary: input.summary ?? "ok",
    },
  };
}

async function createCommittedRunnerSuccessResponse(input: {
  bucket: ReturnType<typeof createBucket>;
  environment: {
    bundleEncryptionKey: Uint8Array;
    bundleEncryptionKeyId: string;
  };
  init?: RequestInit;
  payload?: ReturnType<typeof createRunnerSuccessPayload>;
}): Promise<Response> {
  const payload = input.payload ?? createRunnerSuccessPayload();

  await commitResultForRunnerRequest({
    bucket: input.bucket,
    environment: input.environment,
    payload,
    requestBody: JSON.parse(String(input.init?.body)),
  });

  return new Response(JSON.stringify(payload), {
    status: 200,
  });
}

function readDispatchedEventIds(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([, init]) => {
    const body = typeof init?.body === "string" ? init.body : "";

    return (JSON.parse(body) as { dispatch: { eventId: string } }).dispatch.eventId;
  });
}

async function commitResultForRunnerRequest(input: {
  bucket: ReturnType<typeof createBucket>;
  environment: {
    bundleEncryptionKey: Uint8Array;
    bundleEncryptionKeyId: string;
  };
  payload: {
    bundles: {
      agentState: string | null;
      vault: string | null;
    };
    result: {
      eventsHandled: number;
      summary: string;
    };
  };
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
}): Promise<void> {
  await persistHostedExecutionCommit({
    bucket: input.bucket.api,
    currentBundleRefs: input.requestBody.commit.bundleRefs,
    eventId: input.requestBody.dispatch.eventId,
    key: input.environment.bundleEncryptionKey,
    keyId: input.environment.bundleEncryptionKeyId,
    payload: input.payload,
    userId: input.requestBody.dispatch.event.userId,
  });
}
