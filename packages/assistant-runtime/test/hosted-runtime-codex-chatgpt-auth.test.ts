import assert from "node:assert/strict";

import type {
  HostedCodexAuthSeedResponse,
} from "@murphai/hosted-execution/runtime-control";
import { beforeEach, describe, expect, test, vi } from "vitest";

const engineMocks = vi.hoisted(() => ({
  clearWarmCodexChatGptAuthForSubject: vi.fn(async () => false),
}));

vi.mock("@murphai/assistant-engine", async () => {
  const actual = await vi.importActual<typeof import("@murphai/assistant-engine")>(
    "@murphai/assistant-engine",
  );
  return {
    ...actual,
    clearWarmCodexChatGptAuthForSubject:
      engineMocks.clearWarmCodexChatGptAuthForSubject,
  };
});

import {
  prepareHostedCodexChatGptAuth,
  readHostedCodexChatGptAuthModeChange,
} from "../src/hosted-runtime/codex-chatgpt-auth.ts";
import type {
  HostedRuntimeCodexAuthPort,
} from "../src/hosted-runtime/platform.ts";

const CONNECTION_VERSION = `hca_${"a".repeat(16)}`;
const NEXT_CONNECTION_VERSION = `hca_${"b".repeat(16)}`;
const SUBJECT = "member_synthetic_codex_auth";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("hosted Codex ChatGPT auth resolver", () => {
  test("uses the startup read only for mode selection and resolves every turn from fresh authority", async () => {
    const readAccessSeed = vi.fn()
      .mockResolvedValueOnce(availableMetadata(CONNECTION_VERSION))
      .mockResolvedValueOnce(availableSeed(CONNECTION_VERSION))
      .mockResolvedValueOnce({
        connectionVersion: CONNECTION_VERSION,
        schemaVersion: 1,
        status: "unchanged",
      } satisfies HostedCodexAuthSeedResponse);
    const prepared = await prepareHostedCodexChatGptAuth({
      port: createCodexAuthPort(readAccessSeed),
      subject: SUBJECT,
    });

    assert.equal(prepared.externalChatGptAuth, true);
    assert.ok(prepared.resolver);
    await expect(prepared.resolver.resolve({
      knownConnectionVersion: null,
      reason: "turn_start",
    })).resolves.toEqual({
      accessToken: "fixture-access-token",
      chatgptAccountId: "account_fixture",
      connectionVersion: CONNECTION_VERSION,
      expiresAt: "2026-07-22T00:00:00.000Z",
      kind: "login",
    });
    await expect(prepared.resolver.resolve({
      knownConnectionVersion: CONNECTION_VERSION,
      reason: "turn_start",
    })).resolves.toEqual({ kind: "unchanged" });

    expect(readAccessSeed).toHaveBeenCalledTimes(3);
    expect(readAccessSeed.mock.calls[0]?.[0]).toEqual({
      includeCredentials: false,
      knownConnectionVersion: null,
      schemaVersion: 1,
    });
    expect(readAccessSeed.mock.calls[1]?.[0]).toEqual({
      includeCredentials: true,
      knownConnectionVersion: null,
      schemaVersion: 1,
    });
    expect(readAccessSeed.mock.calls[2]?.[0]).toEqual({
      includeCredentials: true,
      knownConnectionVersion: CONNECTION_VERSION,
      schemaVersion: 1,
    });
  });

  test("never returns the startup token when the warm process already has its version", async () => {
    const readAccessSeed = vi.fn()
      .mockResolvedValueOnce(availableMetadata(CONNECTION_VERSION))
      .mockResolvedValueOnce({
        connectionVersion: CONNECTION_VERSION,
        schemaVersion: 1,
        status: "unchanged",
      } satisfies HostedCodexAuthSeedResponse);
    const prepared = await prepareHostedCodexChatGptAuth({
      port: createCodexAuthPort(readAccessSeed),
      subject: SUBJECT,
    });

    assert.ok(prepared.resolver);
    await expect(prepared.resolver.resolve({
      knownConnectionVersion: CONNECTION_VERSION,
      reason: "turn_start",
    })).resolves.toEqual({ kind: "unchanged" });
    expect(readAccessSeed.mock.calls.map(([request]) => request)).toEqual([
      {
        includeCredentials: false,
        knownConnectionVersion: null,
        schemaVersion: 1,
      },
      {
        includeCredentials: true,
        knownConnectionVersion: CONNECTION_VERSION,
        schemaVersion: 1,
      },
    ]);
  });

  test.each(["expired", "needs_attention"] as const)(
    "keeps %s connections in external mode and requires auth after logout",
    async (reason) => {
      const unavailable = {
        connectionVersion: CONNECTION_VERSION,
        reason,
        schemaVersion: 1,
        status: "unavailable",
      } satisfies HostedCodexAuthSeedResponse;
      const readAccessSeed = vi.fn().mockResolvedValue(unavailable);
      const prepared = await prepareHostedCodexChatGptAuth({
        port: createCodexAuthPort(readAccessSeed),
        subject: SUBJECT,
      });

      assert.equal(prepared.clearFileBackedChatGptAuth, true);
      assert.equal(prepared.externalChatGptAuth, true);
      assert.ok(prepared.resolver);
      expect(engineMocks.clearWarmCodexChatGptAuthForSubject)
        .toHaveBeenCalledWith(SUBJECT);
      await expect(prepared.resolver.resolve({
        knownConnectionVersion: CONNECTION_VERSION,
        reason: "turn_start",
      })).resolves.toEqual({
        authRequired: true,
        connectionVersion: CONNECTION_VERSION,
        kind: "logout",
      });
      expect(readAccessSeed.mock.calls.map(([request]) => request)).toEqual([
        {
          includeCredentials: false,
          knownConnectionVersion: null,
          schemaVersion: 1,
        },
        {
          includeCredentials: true,
          knownConnectionVersion: CONNECTION_VERSION,
          schemaVersion: 1,
        },
      ]);
    },
  );

  test.each(["unconfigured", "disconnected", "legacy_device_code"] as const)(
    "keeps initial %s state out of external mode",
    async (reason) => {
      const readAccessSeed = vi.fn().mockResolvedValueOnce({
        connectionVersion: reason === "unconfigured" ? null : CONNECTION_VERSION,
        reason,
        schemaVersion: 1,
        status: "unavailable",
      } satisfies HostedCodexAuthSeedResponse);
      const prepared = await prepareHostedCodexChatGptAuth({
        port: createCodexAuthPort(readAccessSeed),
        subject: SUBJECT,
      });

      assert.equal(
        prepared.clearFileBackedChatGptAuth,
        reason === "disconnected",
      );
      assert.equal(prepared.externalChatGptAuth, false);
      assert.equal(prepared.resolver, null);
      expect(engineMocks.clearWarmCodexChatGptAuthForSubject).toHaveBeenCalledTimes(1);
      expect(readAccessSeed).toHaveBeenCalledWith({
        includeCredentials: false,
        knownConnectionVersion: null,
        schemaVersion: 1,
      }, { signal: null });
    },
  );

  test("observes a disconnect that supersedes an available startup read before turn start", async () => {
    const readAccessSeed = vi.fn()
      .mockResolvedValueOnce(availableMetadata(CONNECTION_VERSION))
      .mockResolvedValueOnce({
        connectionVersion: NEXT_CONNECTION_VERSION,
        reason: "disconnected",
        schemaVersion: 1,
        status: "unavailable",
      } satisfies HostedCodexAuthSeedResponse);
    const prepared = await prepareHostedCodexChatGptAuth({
      port: createCodexAuthPort(readAccessSeed),
      subject: SUBJECT,
    });

    assert.ok(prepared.resolver);
    await expect(prepared.resolver.resolve({
      knownConnectionVersion: null,
      reason: "turn_start",
    })).resolves.toEqual({
      authRequired: false,
      connectionVersion: NEXT_CONNECTION_VERSION,
      kind: "logout",
    });
    expect(readAccessSeed.mock.calls.map(([request]) => request)).toEqual([
      {
        includeCredentials: false,
        knownConnectionVersion: null,
        schemaVersion: 1,
      },
      {
        includeCredentials: true,
        knownConnectionVersion: null,
        schemaVersion: 1,
      },
    ]);
  });

  test("detects managed-to-external mode changes without requesting a warm clear", async () => {
    const readAccessSeed = vi.fn()
      .mockResolvedValueOnce({
        connectionVersion: null,
        reason: "unconfigured",
        schemaVersion: 1,
        status: "unavailable",
      } satisfies HostedCodexAuthSeedResponse)
      .mockResolvedValueOnce(availableMetadata(CONNECTION_VERSION));
    const port = createCodexAuthPort(readAccessSeed);
    const prepared = await prepareHostedCodexChatGptAuth({
      port,
      subject: SUBJECT,
    });
    engineMocks.clearWarmCodexChatGptAuthForSubject.mockClear();

    await expect(readHostedCodexChatGptAuthModeChange({
      port,
      prepared,
    })).resolves.toEqual({
      changed: true,
      clearWarmChatGptAuth: false,
    });

    expect(engineMocks.clearWarmCodexChatGptAuthForSubject).not.toHaveBeenCalled();
    expect(readAccessSeed.mock.calls.map(([request]) => request)).toEqual([
      {
        includeCredentials: false,
        knownConnectionVersion: null,
        schemaVersion: 1,
      },
      {
        includeCredentials: false,
        knownConnectionVersion: null,
        schemaVersion: 1,
      },
    ]);
  });

  test("defers an external warm clear until after the runtime mode boundary", async () => {
    const readAccessSeed = vi.fn()
      .mockResolvedValueOnce(availableMetadata(CONNECTION_VERSION))
      .mockResolvedValueOnce({
        connectionVersion: NEXT_CONNECTION_VERSION,
        reason: "disconnected",
        schemaVersion: 1,
        status: "unavailable",
      } satisfies HostedCodexAuthSeedResponse);
    const port = createCodexAuthPort(readAccessSeed);
    const prepared = await prepareHostedCodexChatGptAuth({
      port,
      subject: SUBJECT,
    });
    engineMocks.clearWarmCodexChatGptAuthForSubject.mockClear();

    await expect(readHostedCodexChatGptAuthModeChange({
      port,
      prepared,
    })).resolves.toEqual({
      changed: true,
      clearWarmChatGptAuth: true,
    });

    expect(engineMocks.clearWarmCodexChatGptAuthForSubject).not.toHaveBeenCalled();
    expect(readAccessSeed.mock.calls.map(([request]) => request)).toEqual([
      {
        includeCredentials: false,
        knownConnectionVersion: null,
        schemaVersion: 1,
      },
      {
        includeCredentials: false,
        knownConnectionVersion: null,
        schemaVersion: 1,
      },
    ]);
  });

  test("keeps same-mode access-seed rotation on the per-turn resolver path", async () => {
    const readAccessSeed = vi.fn()
      .mockResolvedValueOnce(availableMetadata(CONNECTION_VERSION))
      .mockResolvedValueOnce(availableMetadata(NEXT_CONNECTION_VERSION));
    const port = createCodexAuthPort(readAccessSeed);
    const prepared = await prepareHostedCodexChatGptAuth({
      port,
      subject: SUBJECT,
    });
    engineMocks.clearWarmCodexChatGptAuthForSubject.mockClear();

    await expect(readHostedCodexChatGptAuthModeChange({
      port,
      prepared,
    })).resolves.toEqual({
      changed: false,
      clearWarmChatGptAuth: false,
    });

    expect(engineMocks.clearWarmCodexChatGptAuthForSubject).not.toHaveBeenCalled();
    expect(readAccessSeed.mock.calls.map(([request]) => request)).toEqual([
      {
        includeCredentials: false,
        knownConnectionVersion: null,
        schemaVersion: 1,
      },
      {
        includeCredentials: false,
        knownConnectionVersion: null,
        schemaVersion: 1,
      },
    ]);
  });

  test.each(["expired", "needs_attention"] as const)(
    "keeps external metadata-to-%s changes on the resolver-owned path",
    async (reason) => {
      const readAccessSeed = vi.fn()
        .mockResolvedValueOnce(availableMetadata(CONNECTION_VERSION))
        .mockResolvedValueOnce({
          connectionVersion: NEXT_CONNECTION_VERSION,
          reason,
          schemaVersion: 1,
          status: "unavailable",
        } satisfies HostedCodexAuthSeedResponse);
      const port = createCodexAuthPort(readAccessSeed);
      const prepared = await prepareHostedCodexChatGptAuth({
        port,
        subject: SUBJECT,
      });
      engineMocks.clearWarmCodexChatGptAuthForSubject.mockClear();

      await expect(readHostedCodexChatGptAuthModeChange({
        port,
        prepared,
      })).resolves.toEqual({
        changed: false,
        clearWarmChatGptAuth: false,
      });

      expect(engineMocks.clearWarmCodexChatGptAuthForSubject).not.toHaveBeenCalled();
      expect(readAccessSeed.mock.calls.map(([request]) => request)).toEqual([
        {
          includeCredentials: false,
          knownConnectionVersion: null,
          schemaVersion: 1,
        },
        {
          includeCredentials: false,
          knownConnectionVersion: null,
          schemaVersion: 1,
        },
      ]);
    },
  );

  test.each([
    ["connected", "applied", "current"],
    ["connected", "already_applied", "current"],
    ["failed", "superseded", "superseded"],
  ] as const)(
    "maps a credential-free %s login result with %s authority to %s",
    async (result, status, expected) => {
      const update = vi.fn(async (
        _update: Parameters<HostedRuntimeCodexAuthPort["update"]>[0],
      ) => ({
        applied: status !== "superseded",
        status,
      }));
      const prepared = await prepareHostedCodexChatGptAuth({
        port: createCodexAuthPort(
          vi.fn().mockResolvedValueOnce(availableMetadata(CONNECTION_VERSION)),
          update,
        ),
        subject: SUBJECT,
      });

      assert.ok(prepared.resolver?.reportLoginResult);
      await expect(prepared.resolver.reportLoginResult({
        connectionVersion: CONNECTION_VERSION,
        result,
      })).resolves.toBe(expected);
      expect(update).toHaveBeenCalledWith({
        attemptId: CONNECTION_VERSION,
        phase: result,
      });
      expect(Object.keys(update.mock.calls[0]?.[0] ?? {}).sort()).toEqual([
        "attemptId",
        "phase",
      ]);
    },
  );

  test("fails closed when an initial read claims unchanged authority", async () => {
    const readAccessSeed = vi.fn().mockResolvedValueOnce({
      connectionVersion: CONNECTION_VERSION,
      schemaVersion: 1,
      status: "unchanged",
    } satisfies HostedCodexAuthSeedResponse);
    await expect(prepareHostedCodexChatGptAuth({
      port: createCodexAuthPort(readAccessSeed),
      subject: SUBJECT,
    })).rejects.toThrow("without a known connection version");
    expect(readAccessSeed).toHaveBeenCalledWith({
      includeCredentials: false,
      knownConnectionVersion: null,
      schemaVersion: 1,
    }, { signal: null });
  });

  test("fails closed when a startup metadata read returns credential material", async () => {
    const readAccessSeed = vi.fn().mockResolvedValueOnce(
      availableSeed(CONNECTION_VERSION, "fixture-forbidden-mode-token"),
    );

    await expect(prepareHostedCodexChatGptAuth({
      port: createCodexAuthPort(readAccessSeed),
      subject: SUBJECT,
    })).rejects.toThrow("metadata read unexpectedly returned credentials");
    expect(readAccessSeed).toHaveBeenCalledWith({
      includeCredentials: false,
      knownConnectionVersion: null,
      schemaVersion: 1,
    }, { signal: null });
  });

  test("fails closed when a hot metadata probe returns credential material", async () => {
    const readAccessSeed = vi.fn()
      .mockResolvedValueOnce(availableMetadata(CONNECTION_VERSION))
      .mockResolvedValueOnce(
        availableSeed(NEXT_CONNECTION_VERSION, "fixture-forbidden-hot-mode-token"),
      );
    const port = createCodexAuthPort(readAccessSeed);
    const prepared = await prepareHostedCodexChatGptAuth({
      port,
      subject: SUBJECT,
    });

    await expect(readHostedCodexChatGptAuthModeChange({
      port,
      prepared,
    })).rejects.toThrow("metadata read unexpectedly returned credentials");
    expect(readAccessSeed.mock.calls.map(([request]) => request)).toEqual([
      {
        includeCredentials: false,
        knownConnectionVersion: null,
        schemaVersion: 1,
      },
      {
        includeCredentials: false,
        knownConnectionVersion: null,
        schemaVersion: 1,
      },
    ]);
  });

  test("fails closed when a credential read returns metadata without credentials", async () => {
    const readAccessSeed = vi.fn()
      .mockResolvedValueOnce(availableMetadata(CONNECTION_VERSION))
      .mockResolvedValueOnce(availableMetadata(NEXT_CONNECTION_VERSION));
    const prepared = await prepareHostedCodexChatGptAuth({
      port: createCodexAuthPort(readAccessSeed),
      subject: SUBJECT,
    });

    assert.ok(prepared.resolver);
    await expect(prepared.resolver.resolve({
      knownConnectionVersion: CONNECTION_VERSION,
      reason: "turn_start",
    })).rejects.toThrow("credential read returned metadata without credentials");
    expect(readAccessSeed.mock.calls.map(([request]) => request)).toEqual([
      {
        includeCredentials: false,
        knownConnectionVersion: null,
        schemaVersion: 1,
      },
      {
        includeCredentials: true,
        knownConnectionVersion: CONNECTION_VERSION,
        schemaVersion: 1,
      },
    ]);
  });

  test("forwards startup and turn abort signals to their separate authority reads", async () => {
    const initialSignal = new AbortController().signal;
    const turnSignal = new AbortController().signal;
    const readAccessSeed = vi.fn()
      .mockResolvedValueOnce(availableMetadata(CONNECTION_VERSION))
      .mockResolvedValueOnce(availableSeed(NEXT_CONNECTION_VERSION));
    const prepared = await prepareHostedCodexChatGptAuth({
      port: createCodexAuthPort(readAccessSeed),
      signal: initialSignal,
      subject: SUBJECT,
    });

    assert.ok(prepared.resolver);
    await prepared.resolver.resolve({
      knownConnectionVersion: CONNECTION_VERSION,
      reason: "turn_start",
      signal: turnSignal,
    });

    expect(readAccessSeed.mock.calls[0]?.[1]).toEqual({ signal: initialSignal });
    expect(readAccessSeed.mock.calls[1]?.[1]).toEqual({ signal: turnSignal });
    expect(readAccessSeed.mock.calls.map(([request]) => request)).toEqual([
      {
        includeCredentials: false,
        knownConnectionVersion: null,
        schemaVersion: 1,
      },
      {
        includeCredentials: true,
        knownConnectionVersion: CONNECTION_VERSION,
        schemaVersion: 1,
      },
    ]);
  });
});

function availableMetadata(
  connectionVersion: string,
): HostedCodexAuthSeedResponse {
  return {
    connectionVersion,
    schemaVersion: 1,
    status: "available_metadata",
  };
}

function availableSeed(
  connectionVersion: string,
  accessToken = "fixture-access-token",
): HostedCodexAuthSeedResponse {
  return {
    accessToken,
    chatgptAccountId: "account_fixture",
    connectionVersion,
    expiresAt: "2026-07-22T00:00:00.000Z",
    schemaVersion: 1,
    status: "available",
  };
}

function createCodexAuthPort(
  readAccessSeed: HostedRuntimeCodexAuthPort["readAccessSeed"],
  update: HostedRuntimeCodexAuthPort["update"] = vi.fn(),
): HostedRuntimeCodexAuthPort {
  return {
    readAccessSeed,
    update,
  };
}
