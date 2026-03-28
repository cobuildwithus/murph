import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listHostedBundleArtifacts,
  snapshotHostedBundleRoots,
  writeHostedBundleTextFile,
} from "@murph/runtime-state";

import {
  createHostedArtifactStore,
  createHostedBundleStore,
} from "../src/bundle-store.js";
import { HostedBundleGarbageCollector } from "../src/bundle-gc.js";
import { encryptHostedBundle } from "../src/crypto.js";
import {
  createHostedExecutionJournalStore,
  persistHostedExecutionCommit,
  persistHostedExecutionFinalBundles,
} from "../src/execution-journal.js";
import { HostedUserRunner } from "../src/user-runner.js";
import { createTestSqlStorage } from "./sql-storage.js";

describe("HostedUserRunner", () => {
  const bucket = createBucket();
  const storage = createStorage();
  const environment = {
    allowedUserEnvKeys: null,
    allowedUserEnvPrefixes: null,
    bundleEncryptionKey: Uint8Array.from({ length: 32 }, () => 7),
    bundleEncryptionKeyId: "v1",
    controlToken: null,
    defaultAlarmDelayMs: 60_000,
    dispatchSigningSecret: "dispatch-secret",
    maxEventAttempts: 3,
    retryDelayMs: 10_000,
    runnerControlToken: "runner-token",
    runnerTimeoutMs: 60_000,
  };

  beforeEach(() => {
    bucket.clear();
    storage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("roundtrips encrypted bundle payloads through object storage", async () => {
    const bundleStore = createHostedBundleStore({
      bucket: bucket.api,
      key: environment.bundleEncryptionKey,
      keyId: environment.bundleEncryptionKeyId,
    });
    const plaintext = new TextEncoder().encode("vault bundle");

    const ref = await bundleStore.writeBundle("vault", plaintext);

    expect(ref).toMatchObject({
      key: expect.stringMatching(/^bundles\/vault\/[0-9a-f]+\.bundle\.json$/u),
      size: plaintext.byteLength,
    });
    await expect(bundleStore.readBundle(ref)).resolves.toEqual(plaintext);
  });

  it("reads legacy hosted bundle envelopes through object storage", async () => {
    const bundleStore = createHostedBundleStore({
      bucket: bucket.api,
      key: environment.bundleEncryptionKey,
      keyId: environment.bundleEncryptionKeyId,
    });
    const plaintext = new TextEncoder().encode("legacy vault bundle");
    const legacyEnvelope = await encryptHostedBundle({
      key: environment.bundleEncryptionKey,
      keyId: environment.bundleEncryptionKeyId,
      plaintext,
    });

    legacyEnvelope.schema = "healthybob.hosted-cipher.v1";
    await bucket.api.put("bundles/vault/legacy.bundle.json", JSON.stringify(legacyEnvelope));

    await expect(bundleStore.readBundle({
      key: "bundles/vault/legacy.bundle.json",
      sha256: "legacy",
      size: plaintext.byteLength,
    })).resolves.toEqual(plaintext);
  });

  it("fails clearly when reading hosted objects encrypted with a different key id", async () => {
    const bundleStore = createHostedBundleStore({
      bucket: bucket.api,
      key: environment.bundleEncryptionKey,
      keyId: "v2",
    });
    const plaintext = new TextEncoder().encode("vault bundle");
    const legacyRef = await createHostedBundleStore({
      bucket: bucket.api,
      key: environment.bundleEncryptionKey,
      keyId: "v1",
    }).writeBundle("vault", plaintext);

    await expect(bundleStore.readBundle(legacyRef)).rejects.toThrow(
      "Hosted bundle envelope keyId mismatch: expected v2, got v1. Multi-key decryption is not implemented.",
    );
  });

  it("cleans up superseded bundle objects and orphaned per-user artifacts after a bundle transition", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-bundle-gc-"));

    try {
      const previousVaultRoot = path.join(workspaceRoot, "previous-vault");
      const nextVaultRoot = path.join(workspaceRoot, "next-vault");
      const previousRawAttachmentPath = path.join(
        previousVaultRoot,
        "raw",
        "inbox",
        "example",
        "photo.jpg",
      );
      await mkdir(path.dirname(previousRawAttachmentPath), { recursive: true });
      await mkdir(nextVaultRoot, { recursive: true });
      await writeFile(path.join(previousVaultRoot, "vault.json"), "{\"schema\":\"vault\"}\n");
      await writeFile(previousRawAttachmentPath, Buffer.from("image-bytes-placeholder\n", "utf8"));
      await writeFile(path.join(nextVaultRoot, "vault.json"), "{\"schema\":\"vault\",\"next\":true}\n");

      const artifactStore = createHostedArtifactStore({
        bucket: bucket.api,
        key: environment.bundleEncryptionKey,
        keyId: environment.bundleEncryptionKeyId,
        userId: "member_gc",
      });
      const previousVaultBundle = await snapshotHostedBundleRoots({
        externalizeFile: async (artifact) => {
          const ref = {
            byteSize: artifact.bytes.byteLength,
            sha256: createHash("sha256").update(artifact.bytes).digest("hex"),
          };
          await artifactStore.writeArtifact(ref.sha256, artifact.bytes);
          return ref;
        },
        kind: "vault",
        roots: [
          {
            root: previousVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      const nextVaultBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: nextVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      const bundleStore = createHostedBundleStore({
        bucket: bucket.api,
        key: environment.bundleEncryptionKey,
        keyId: environment.bundleEncryptionKeyId,
      });
      const [previousArtifact] = listHostedBundleArtifacts({
        bytes: previousVaultBundle!,
        expectedKind: "vault",
      });
      const previousVaultRef = await bundleStore.writeBundle("vault", previousVaultBundle!);
      const nextVaultRef = await bundleStore.writeBundle("vault", nextVaultBundle!);
      const previousAgentRef = await bundleStore.writeBundle(
        "agent-state",
        new TextEncoder().encode("agent-state-previous"),
      );
      const nextAgentRef = await bundleStore.writeBundle(
        "agent-state",
        new TextEncoder().encode("agent-state-next"),
      );

      const collector = new HostedBundleGarbageCollector(
        bucket.api,
        environment.bundleEncryptionKey,
        environment.bundleEncryptionKeyId,
      );

      await collector.cleanupBundleTransition({
        nextBundleRefs: {
          agentState: nextAgentRef,
          vault: nextVaultRef,
        },
        previousBundleRefs: {
          agentState: previousAgentRef,
          vault: previousVaultRef,
        },
        userId: "member_gc",
      });

      expect(bucket.keys()).not.toContain(previousAgentRef.key);
      expect(bucket.keys()).not.toContain(previousVaultRef.key);
      expect(bucket.keys()).not.toContain(
        `users/member_gc/artifacts/${previousArtifact!.ref.sha256}.artifact.bin`,
      );
      expect(bucket.keys()).toContain(nextAgentRef.key);
      expect(bucket.keys()).toContain(nextVaultRef.key);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("roundtrips committed execution journal records through object storage", async () => {
    const journalStore = createHostedExecutionJournalStore({
      bucket: bucket.api,
      key: environment.bundleEncryptionKey,
      keyId: environment.bundleEncryptionKeyId,
    });
    const committedResult = {
      bundleRefs: {
        agentState: null,
        vault: null,
      },
      committedAt: "2026-03-27T00:00:00.000Z",
      eventId: "evt_roundtrip",
      finalizedAt: null,
      result: {
        eventsHandled: 1,
        summary: "ok",
      },
      sideEffects: [],
      userId: "member_123",
    };

    await journalStore.writeCommittedResult("member_123", "evt_roundtrip", committedResult);

    await expect(journalStore.readCommittedResult("member_123", "evt_roundtrip")).resolves.toEqual(
      committedResult,
    );
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
    expectHostedBundleKeys(bucket.keys(), ["agent-state", "vault"]);
    await expect(createHostedExecutionJournalStore({
      bucket: bucket.api,
      key: environment.bundleEncryptionKey,
      keyId: environment.bundleEncryptionKeyId,
    }).readCommittedResult("member_123", "evt_123")).resolves.toBeNull();
  });

  it("starts the native container runner and applies the next wake hint", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const resultPayload = {
      bundles: {
        agentState: Buffer.from("agent-state").toString("base64"),
        vault: Buffer.from("vault").toString("base64"),
      },
      result: {
        eventsHandled: 1,
        nextWakeAt: "2026-03-27T18:00:00.000Z",
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
        userId: "member_123",
      },
      eventId: "evt_native_container",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/invoke")).toBe(1);
    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/destroy")).toBe(0);
    expect(status.lastEventId).toBe("evt_native_container");
    expect(status.nextWakeAt).toBe("2026-03-27T18:00:00.000Z");
    expectHostedBundleKeys(bucket.keys(), ["agent-state", "vault"]);
  });

  it("does not reuse stale past nextWakeAt values after an alarm run returns no next wake", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const payload = {
          bundles: {
            agentState: Buffer.from("agent-state").toString("base64"),
            vault: Buffer.from("vault").toString("base64"),
          },
          result: {
            eventsHandled: 1,
            nextWakeAt: null,
            summary: "alarm",
          },
        };
        await commitResultForRunnerRequest({
          bucket,
          environment,
          payload,
          requestBody: JSON.parse(String(init?.body)),
        });

        return new Response(JSON.stringify(payload), {
          status: 200,
        });
      }),
    );
    seedRunnerQueueState(storage, {
      activated: true,
      lastError: null,
      lastEventId: "evt_seed_wake",
      lastRunAt: "2026-03-26T11:59:00.000Z",
      nextWakeAt: "2026-03-26T12:00:05.000Z",
      userId: "member_123",
    });
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    vi.setSystemTime(new Date("2026-03-26T12:00:10.000Z"));
    await runner.alarm();

    const status = await runner.status("member_123");
    expect(status.lastEventId).toMatch(/^alarm:/u);
    expect(status.nextWakeAt).not.toBe("2026-03-26T12:00:05.000Z");
    expect(status.nextWakeAt).toBe("2026-03-26T12:01:10.000Z");
    expect(storage.lastAlarm).toBe(Date.parse("2026-03-26T12:01:10.000Z"));
  });

  it("passes the worker commit callback metadata through the runner container invoke request", async () => {
    const resultPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state").toString("base64"),
      summary: "ok",
      vault: Buffer.from("vault").toString("base64"),
    });
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

    await runner.dispatch(createDispatch("evt_commit_callback"));

    const invokeCall = storage.runnerContainerFetch.mock.calls.find(([input]) => {
      const request = input instanceof Request ? input : new Request(input);
      return new URL(request.url).pathname === "/internal/invoke";
    });
    expect(invokeCall).toBeDefined();
    const invokeInput = invokeCall?.[0] as Request | string | URL;
    const invokeRequest = invokeInput instanceof Request
      ? invokeInput
      : new Request(invokeInput);
    const invokePayload = JSON.parse(await invokeRequest.text()) as {
      request: {
        commit: {
          bundleRefs: {
            agentState: null | { hash: string; key: string; size: number; updatedAt: string };
            vault: null | { hash: string; key: string; size: number; updatedAt: string };
          };
        };
      };
    };

    expect(invokePayload.request.commit.bundleRefs).toEqual({
      agentState: null,
      vault: null,
    });
  });

  it("forwards stored per-user env through the runner container invoke payload", async () => {
    const resultPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state").toString("base64"),
      summary: "ok",
      vault: Buffer.from("vault").toString("base64"),
    });
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
    const runner = new HostedUserRunner(
      storage.state,
      {
        ...environment,
        allowedUserEnvKeys: "OPENAI_API_KEY",
      },
      bucket.api,
    );

    await runner.bootstrapUser("member_123");
    await runner.updateUserEnv({
      env: {
        OPENAI_API_KEY: "sk-user",
      },
      mode: "replace",
    });
    await runner.dispatch(createDispatch("evt_user_env_set"));
    await runner.clearUserEnv();
    await runner.dispatch(createDispatch("evt_user_env_cleared"));

    const invokePayloads = await Promise.all(
      storage.runnerContainerFetch.mock.calls
        .filter(([input]) => {
          const request = input instanceof Request ? input : new Request(input);
          return new URL(request.url).pathname === "/internal/invoke";
        })
        .map(async ([input]) => {
          const request = input instanceof Request ? input : new Request(input);
          const payload = JSON.parse(await request.text()) as {
            request: {
              dispatch: {
                eventId: string;
              };
              userEnv: Record<string, string>;
            };
          };

          return {
            eventId: payload.request.dispatch.eventId,
            userEnv: payload.request.userEnv,
          };
        }),
    );

    expect(invokePayloads).toEqual([
      {
        eventId: "evt_user_env_set",
        userEnv: {
          OPENAI_API_KEY: "sk-user",
        },
      },
      {
        eventId: "evt_user_env_cleared",
        userEnv: {},
      },
    ]);
  });

  it("reconciles final runner bundles after the durable commit path advances earlier bundle refs", async () => {
    const committedPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state-committed").toString("base64"),
      summary: "committed",
      vault: Buffer.from("vault-committed").toString("base64"),
    });
    const finalPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state-final").toString("base64"),
      summary: "final",
      vault: Buffer.from("vault-final").toString("base64"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        await commitResultForRunnerRequest({
          bucket,
          environment,
          payload: committedPayload,
          requestBody: JSON.parse(String(init?.body)),
        });

        return new Response(JSON.stringify(finalPayload), {
          status: 200,
        });
      }),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const status = await runner.dispatch({
      event: {
        kind: "member.activated",
        userId: "member_123",
      },
      eventId: "evt_final_bundles",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

    expect(status.bundleRefs.agentState?.size).toBe("agent-state-final".length);
    expect(status.bundleRefs.vault?.size).toBe("vault-final".length);
  });

  it("recovers finalized bundle refs when the runner fails after durable finalize but before returning", async () => {
    const committedPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state-committed").toString("base64"),
      summary: "committed",
      vault: Buffer.from("vault-committed").toString("base64"),
    });
    const finalPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state-finalized").toString("base64"),
      summary: "finalized",
      vault: Buffer.from("vault-finalized").toString("base64"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const requestBody = JSON.parse(String(init?.body));
        await commitResultForRunnerRequest({
          bucket,
          environment,
          payload: committedPayload,
          requestBody,
        });
        await finalizeResultForRunnerRequest({
          bucket,
          environment,
          payload: finalPayload,
          requestBody,
        });
        throw new Error("runner connection dropped after finalize");
      }),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const status = await runner.dispatch({
      event: {
        kind: "member.activated",
        userId: "member_123",
      },
      eventId: "evt_finalized_recovery",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

    expect(status.lastError).toBeNull();
    expect(status.pendingEventCount).toBe(0);
    expect(status.bundleRefs.agentState?.size).toBe("agent-state-finalized".length);
    expect(status.bundleRefs.vault?.size).toBe("vault-finalized".length);
  });

  it("keeps committed events retryable until durable finalize succeeds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const sideEffects = [
      {
        effectId: "outbox_retry",
        fingerprint: "dedupe_retry",
        intentId: "outbox_retry",
        kind: "assistant.delivery" as const,
      },
    ];
    const committedPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state-committed").toString("base64"),
      sideEffects,
      summary: "committed",
      vault: Buffer.from("vault-committed").toString("base64"),
    });
    const finalPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state-final").toString("base64"),
      summary: "final",
      vault: Buffer.from("vault-final").toString("base64"),
    });
    const fetchSpy = vi.fn()
      .mockImplementationOnce(async (_url, init) => {
        await commitResultForRunnerRequest({
          bucket,
          environment,
          payload: committedPayload,
          requestBody: JSON.parse(String(init?.body)),
        });
        throw new Error("finalize failed");
      })
      .mockImplementationOnce(async (_url, init) => {
        const requestBody = JSON.parse(String(init?.body));
        expect(requestBody.resume).toEqual({
          committedResult: {
            result: committedPayload.result,
            sideEffects,
          },
        });
        await finalizeResultForRunnerRequest({
          bucket,
          environment,
          payload: finalPayload,
          requestBody,
        });

        return new Response(JSON.stringify(finalPayload), {
          status: 200,
        });
      });
    vi.stubGlobal("fetch", fetchSpy);
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const firstStatus = await runner.dispatch({
      event: {
        kind: "member.activated",
        userId: "member_123",
      },
      eventId: "evt_finalize_retry",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

    expect(firstStatus.pendingEventCount).toBe(1);
    expect(firstStatus.retryingEventId).toBe("evt_finalize_retry");
    expect(firstStatus.bundleRefs.agentState?.size).toBe("agent-state-committed".length);
    expect(firstStatus.bundleRefs.vault?.size).toBe("vault-committed".length);
    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/destroy")).toBe(0);

    vi.setSystemTime(new Date("2026-03-26T12:00:11.000Z"));
    await runner.alarm();

    const finalStatus = await runner.status("member_123");
    expect(finalStatus.pendingEventCount).toBe(0);
    expect(finalStatus.retryingEventId).toBeNull();
    expect(finalStatus.bundleRefs.agentState?.size).toBe("agent-state-final".length);
    expect(finalStatus.bundleRefs.vault?.size).toBe("vault-final".length);
    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/destroy")).toBe(0);
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

  it("continues past a rescheduled head event and runs later due work in the same pass", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const fetchMock = vi.fn(async (_url, init) => {
      const requestBody = JSON.parse(String(init?.body)) as {
        dispatch: {
          eventId: string;
        };
      };

      if (requestBody.dispatch.eventId === "evt_retry_head") {
        return new Response("runner failed", {
          status: 503,
        });
      }

      return createCommittedRunnerSuccessResponse({
        bucket,
        environment,
        init,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    seedRunnerQueueState(storage, {
      pendingEvents: [
        {
          attempts: 0,
          availableAt: "2026-03-26T12:00:00.000Z",
          dispatch: createDispatch("evt_retry_head"),
          enqueuedAt: "2026-03-26T12:00:00.000Z",
          lastError: null,
        },
        {
          attempts: 0,
          availableAt: "2026-03-26T12:00:00.000Z",
          dispatch: createDispatch("evt_tail"),
          enqueuedAt: "2026-03-26T12:00:01.000Z",
          lastError: null,
        },
      ],
      userId: "member_123",
    });
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    await runner.alarm();

    expect(readDispatchedEventIds(fetchMock)).toEqual(["evt_retry_head", "evt_tail"]);
    await expect(runner.status("member_123")).resolves.toMatchObject({
      lastEventId: "evt_tail",
      pendingEventCount: 1,
      poisonedEventIds: [],
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

    expect(failed.pendingEventCount).toBe(1);
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

  it("recovers a durable finalize when the runner response is lost", async () => {
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
        const requestBody = JSON.parse(String(init?.body));
        await commitResultForRunnerRequest({
          bucket,
          environment,
          payload: resultPayload,
          requestBody,
        });
        await finalizeResultForRunnerRequest({
          bucket,
          environment,
          payload: resultPayload,
          requestBody,
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
    await persistHostedExecutionFinalBundles({
      bucket: bucket.api,
      eventId: dispatch.eventId,
      key: environment.bundleEncryptionKey,
      keyId: environment.bundleEncryptionKeyId,
      payload: {
        bundles: {
          agentState: Buffer.from("agent-state").toString("base64"),
          vault: Buffer.from("vault").toString("base64"),
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

  it("applies a prefinalized event on retry without rerunning side effects", async () => {
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
    seedRunnerQueueState(storage, {
      activated: false,
      lastError: "timeout",
      lastEventId: dispatch.eventId,
      pendingEvents: [
        {
          attempts: 1,
          availableAt: dispatch.occurredAt,
          dispatch,
          enqueuedAt: dispatch.occurredAt,
          lastError: "timeout",
        },
      ],
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
    await persistHostedExecutionFinalBundles({
      bucket: bucket.api,
      eventId: dispatch.eventId,
      key: environment.bundleEncryptionKey,
      keyId: environment.bundleEncryptionKeyId,
      payload: {
        bundles: {
          agentState: Buffer.from("agent-state").toString("base64"),
          vault: Buffer.from("vault").toString("base64"),
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
    await expect(
      createHostedExecutionJournalStore({
        bucket: bucket.api,
        key: environment.bundleEncryptionKey,
        keyId: environment.bundleEncryptionKeyId,
      }).readCommittedResult(dispatch.event.userId, dispatch.eventId),
    ).resolves.toBeNull();
  });

  it("keeps pending work retryable when the runner control token is missing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const misconfiguredRunner = new HostedUserRunner(storage.state, {
      ...environment,
      maxEventAttempts: 1,
      runnerControlToken: null,
    }, bucket.api);

    const firstStatus = await misconfiguredRunner.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_missing_runner_token",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

    expect(firstStatus.pendingEventCount).toBe(1);
    expect(firstStatus.poisonedEventIds).toEqual([]);
    expect(firstStatus.retryingEventId).toBeNull();
    expect(firstStatus.lastError).toBe(
      "HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN must be configured for native hosted execution.",
    );
    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/invoke")).toBe(0);

    vi.setSystemTime(new Date("2026-03-26T12:00:11.000Z"));
    await misconfiguredRunner.alarm();

    const retryStatus = await misconfiguredRunner.status("member_123");
    expect(retryStatus.pendingEventCount).toBe(1);
    expect(retryStatus.poisonedEventIds).toEqual([]);
    expect(retryStatus.retryingEventId).toBeNull();
    expect(retryStatus.lastError).toBe(
      "HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN must be configured for native hosted execution.",
    );
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

  it("keeps consumed event ids blocked even after the old replay TTL window passes", async () => {
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

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps poisoned event ids blocked even after the old replay TTL window passes", async () => {
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

    expect(replayed.poisonedEventIds).toContain("evt_poison_expiry");
  });

  it("stores encrypted per-user env config in a dedicated hosted object", async () => {
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    await runner.bootstrapUser("member_123");
    const saved = await runner.updateUserEnv({
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
    expect(bucket.keys()).toEqual(["users/member_123/user-env.json"]);
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
        userId: "member_123",
      },
      eventId: "evt_bootstrap",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });
    const writesAfterBootstrap = bucket.putCount();

    await runner.updateUserEnv({
      env: {
        OPENAI_API_KEY: "sk-user",
      },
      mode: "replace",
    });
    expect(bucket.putCount()).toBe(writesAfterBootstrap + 1);
    expectHostedBundleKeys(bucket.keys(), ["agent-state", "vault"]);
    expect(bucket.keys()).toContain("users/member_123/user-env.json");

    const cleared = await runner.clearUserEnv();

    expect(cleared.configuredUserEnvKeys).toEqual([]);
    expectHostedBundleKeys(bucket.keys(), ["agent-state", "vault"]);
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

    await runner.bootstrapUser("member_123");
    await expect(runner.updateUserEnv({
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
      async deleteAlarm(): Promise<void> {
        storage.lastAlarm = null;
      },
      async getAlarm(): Promise<number | null> {
        return storage.lastAlarm;
      },
      async setAlarm(value: number | Date): Promise<void> {
        storage.lastAlarm = value instanceof Date ? value.getTime() : value;
      },
      sql,
    },
  };
  const storage = {
    clear() {
      values.clear();
      storage.lastAlarm = null;
      sql.reset();
      runnerContainerFetch.mockClear();
    },
    lastAlarm: null as number | null,
    runnerContainerFetch,
    runnerContainerNamespace,
    state,
  };

  return storage;
}

function seedRunnerQueueState(
  storage: ReturnType<typeof createStorage>,
  input: {
    activated?: boolean;
    backpressuredEventIds?: string[];
    inFlight?: boolean;
    lastError?: string | null;
    lastEventId?: string | null;
    lastRunAt?: string | null;
    nextWakeAt?: string | null;
    pendingEvents?: Array<{
      attempts: number;
      availableAt: string;
      dispatch: {
        event: Record<string, unknown>;
        eventId: string;
        occurredAt: string;
      };
      enqueuedAt: string;
      lastError: string | null;
    }>;
    poisonedEvents?: Array<{
      eventId: string;
      lastError: string;
      poisonedAt: string;
    }>;
    retryingEventId?: string | null;
    userId: string;
  },
): void {
  const sql = storage.state.storage.sql;
  if (!sql) {
    throw new Error("Test storage.sql is required.");
  }

  sql.exec("DELETE FROM pending_events");
  sql.exec("DELETE FROM consumed_events");
  sql.exec("DELETE FROM poisoned_events");
  sql.exec("DELETE FROM runner_meta");

  sql.exec(
    `INSERT INTO runner_meta (
      singleton,
      user_id,
      activated,
      in_flight,
      last_error,
      last_event_id,
      last_run_at,
      next_wake_at,
      retrying_event_id,
      backpressured_event_ids_json,
      agent_state_bundle_ref_json,
      vault_bundle_ref_json,
      agent_state_bundle_version,
      vault_bundle_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    1,
    input.userId,
    input.activated ? 1 : 0,
    input.inFlight ? 1 : 0,
    input.lastError ?? null,
    input.lastEventId ?? null,
    input.lastRunAt ?? null,
    input.nextWakeAt ?? null,
    input.retryingEventId ?? null,
    JSON.stringify(input.backpressuredEventIds ?? []),
    null,
    null,
    0,
    0,
  );

  for (const pendingEvent of input.pendingEvents ?? []) {
    sql.exec(
      `INSERT INTO pending_events (
        event_id,
        dispatch_json,
        attempts,
        available_at,
        enqueued_at,
        last_error
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      pendingEvent.dispatch.eventId,
      JSON.stringify(pendingEvent.dispatch),
      pendingEvent.attempts,
      pendingEvent.availableAt,
      pendingEvent.enqueuedAt,
      pendingEvent.lastError,
    );
  }

  for (const poisonedEvent of input.poisonedEvents ?? []) {
    sql.exec(
      `INSERT INTO poisoned_events (
        event_id,
        poisoned_at,
        last_error
      ) VALUES (?, ?, ?)`,
      poisonedEvent.eventId,
      poisonedEvent.poisonedAt,
      poisonedEvent.lastError,
    );
  }
}

function countRunnerContainerCalls(
  fetchMock: ReturnType<typeof vi.fn>,
  pathname: string,
): number {
  return fetchMock.mock.calls.filter(([input]) => {
    const request = input instanceof Request ? input : new Request(String(input));
    return new URL(request.url).pathname === pathname;
  }).length;
}

function expectHostedBundleKeys(
  keys: string[],
  kinds: Array<"agent-state" | "vault">,
): void {
  for (const kind of kinds) {
    expect(keys).toContainEqual(expect.stringMatching(
      new RegExp(`^bundles/${kind}/[0-9a-f]+\\.bundle\\.json$`, "u"),
    ));
  }
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
  sideEffects: Array<{
    effectId: string;
    fingerprint: string;
    intentId: string;
    kind: "assistant.delivery";
  }>;
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
    sideEffects: input.sideEffects ?? [],
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
    sideEffects?: Array<{
      effectId: string;
      fingerprint: string;
      intentId: string;
      kind: "assistant.delivery";
    }>;
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

async function finalizeResultForRunnerRequest(input: {
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
    sideEffects?: Array<{
      effectId: string;
      fingerprint: string;
      intentId: string;
      kind: "assistant.delivery";
    }>;
  };
  requestBody: {
    dispatch: {
      event: {
        userId: string;
      };
      eventId: string;
    };
  };
}): Promise<void> {
  await persistHostedExecutionFinalBundles({
    bucket: input.bucket.api,
    eventId: input.requestBody.dispatch.eventId,
    key: input.environment.bundleEncryptionKey,
    keyId: input.environment.bundleEncryptionKeyId,
    payload: {
      bundles: input.payload.bundles,
    },
    userId: input.requestBody.dispatch.event.userId,
  });
}
