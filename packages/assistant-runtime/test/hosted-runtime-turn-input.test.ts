import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

import {
  AssistantActiveTurnInputCheckpointRejectedError,
  upsertAssistantInputEvent,
  type AssistantTurnInputRefreshResult,
} from "@murphai/assistant-engine";
import type {
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";

import {
  createHostedAssistantInputSource,
} from "../src/hosted-runtime/turn-input.ts";
import {
  HostedMailboxImportCheckpointConflictError,
  HostedMailboxImportCheckpointUserMismatchError,
} from "../src/hosted-runtime/mailbox-checkpoint.ts";
import type {
  HostedRuntimeActiveTurnInputCheckpoint,
  HostedRuntimeActiveTurnInputMailboxRefresh,
} from "../src/hosted-runtime/platform.ts";

const TIMER_WAKE = {
  eventId: "evt_timer",
  kind: "runtime.timer",
  occurredAt: "2026-04-23T00:00:00.000Z",
  triggerKind: "runtime_timer",
  userId: "member_123",
} satisfies HostedRuntimeEvent;

const tempRoots: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    tempRoots.splice(0).map((root) =>
      rm(root, {
        force: true,
        recursive: true,
      })
    ),
  );
});

describe("createHostedAssistantInputSource", () => {
  it("returns a store-backed source when the hosted platform has no active-turn input ports", async () => {
    const vaultRoot = await createTempVault();
    const source = createHostedAssistantInputSource({
      requestId: "req_no_port",
      runtime: createRuntime(),
      vaultRoot,
      wake: TIMER_WAKE,
    });

    await expect(source.refresh({ phase: "request_boundary" })).resolves.toEqual({
      progressed: false,
      reason: "no_new_input",
    });
    await expect(source.listInputCandidates({ sourceId: "linq" })).resolves.toEqual({
      inputs: [],
      nextCursor: null,
    });
  });

  it("fails closed when only one hosted active-turn input hook is configured", () => {
    expect(() =>
      createHostedAssistantInputSource({
        requestId: "req_refresh_only",
        runtime: createRuntime({
          refreshMailboxForActiveTurnInput:
            vi.fn<HostedRuntimeActiveTurnInputMailboxRefresh>(async () => ({
            progressed: false,
            reason: "no_new_input",
          })),
        }),
        vaultRoot: "/tmp/vault-root",
        wake: TIMER_WAKE,
      }),
    ).toThrow(/requires both mailbox refresh and acceptance checkpoint ports/u);

    expect(() =>
      createHostedAssistantInputSource({
        requestId: "req_checkpoint_only",
        runtime: createRuntime({
          checkpointActiveTurnInput: vi.fn(async () => undefined),
        }),
        vaultRoot: "/tmp/vault-root",
        wake: TIMER_WAKE,
      }),
    ).toThrow(/requires both mailbox refresh and acceptance checkpoint ports/u);
  });

  it("forwards accepted input checkpoints with the hosted request id", async () => {
    const checkpointActiveTurnInput = vi.fn(async () => undefined);
    const source = createHostedAssistantInputSource({
      requestId: "req_turn_input",
      runtime: createRuntime({
        checkpointActiveTurnInput,
        refreshMailboxForActiveTurnInput:
          vi.fn<HostedRuntimeActiveTurnInputMailboxRefresh>(async () => ({
          progressed: false,
          reason: "no_new_input",
        })),
      }),
      vaultRoot: "/tmp/vault-root",
      wake: TIMER_WAKE,
    });

    await source?.checkpointAcceptedInput?.({
      acceptedInputIds: ["ain_00000000000000000000000000000000"],
      providerRequestOrdinal: 0,
      sessionId: "session_123",
      turnId: "turn_123",
      vault: "/tmp/vault-root",
    });

    expect(checkpointActiveTurnInput).toHaveBeenCalledWith({
      acceptedInputIds: ["ain_00000000000000000000000000000000"],
      providerRequestOrdinal: 0,
      requestId: "req_turn_input",
      sessionId: "session_123",
      turnId: "turn_123",
      vault: "/tmp/vault-root",
    });
  });

  it("normalizes hosted checkpoint rejection errors", async () => {
    for (const error of [
      new HostedMailboxImportCheckpointUserMismatchError({
        actualUserId: "member_other",
        expectedUserId: "member_123",
      }),
      new HostedMailboxImportCheckpointConflictError({
        checkpointed: false,
        workspace: {
          createdAt: "2026-04-23T00:00:00.000Z",
          checkpointedAt: "2026-04-23T00:00:01.000Z",
          nextWakeAt: null,
          nextWakeReason: null,
          redactedStatus: null,
          snapshotRef: null,
          updatedAt: "2026-04-23T00:00:01.000Z",
          userId: "member_123",
          version: "2",
        },
      }),
    ]) {
      const source = createHostedAssistantInputSource({
        requestId: "req_turn_input",
        runtime: createRuntime({
          checkpointActiveTurnInput: vi.fn(async () => {
            throw error;
          }),
          refreshMailboxForActiveTurnInput:
            vi.fn<HostedRuntimeActiveTurnInputMailboxRefresh>(async () => ({
            progressed: false,
            reason: "no_new_input",
          })),
        }),
        vaultRoot: "/tmp/vault-root",
        wake: TIMER_WAKE,
      });

      await expect(
        source?.checkpointAcceptedInput?.({
          acceptedInputIds: ["ain_00000000000000000000000000000000"],
          providerRequestOrdinal: 0,
          sessionId: "session_123",
          turnId: "turn_123",
          vault: "/tmp/vault-root",
        }),
      ).rejects.toBeInstanceOf(AssistantActiveTurnInputCheckpointRejectedError);
    }
  });

  it("refreshes hosted mailbox input and reads staged assistant input events", async () => {
    const vaultRoot = await createTempVault();
    const events: string[] = [];
    const refreshMailboxForActiveTurnInput =
      vi.fn<HostedRuntimeActiveTurnInputMailboxRefresh>(async () => {
        events.push("mailbox");
        await upsertAssistantInputEvent({
          vault: vaultRoot,
          event: createAssistantInputEvent(),
        });
        return {
          progressed: true,
          reason: "ingested_input",
        };
      });
    const source = createHostedAssistantInputSource({
      requestId: "req_turn_input",
      runtime: createRuntime({
        checkpointActiveTurnInput: vi.fn(async () => undefined),
        refreshMailboxForActiveTurnInput,
      }),
      vaultRoot,
      wake: TIMER_WAKE,
    });

    await expect(source?.refresh({ phase: "input_available" })).resolves.toEqual({
      progressed: true,
      reason: "ingested_input",
    });
    const listed = await source?.listInputCandidates({
      sourceId: "linq",
    });

    expect(events).toEqual(["mailbox"]);
    expect(refreshMailboxForActiveTurnInput).toHaveBeenCalledWith({
      requestId: "req_turn_input",
    });
    expect(listed?.inputs).toHaveLength(1);
    expect(listed?.inputs[0]).toMatchObject({
      acceptedInput: {
        source: "assistant-input",
        contentRef: {
          kind: "assistant-input-event",
        },
      },
      event: {
        source: "linq",
        text: "late same-conversation note",
      },
      projection: {
        captureId: null,
        status: "not_attempted",
      },
    });
  });

  it("skips the first hosted mailbox refresh when initial import already staged preferred input", async () => {
    const vaultRoot = await createTempVault();
    const staged = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent(),
    });
    const refreshMailboxForActiveTurnInput =
      vi.fn<HostedRuntimeActiveTurnInputMailboxRefresh>(async () => ({
        progressed: false,
        reason: "no_new_input",
      }));
    const source = createHostedAssistantInputSource({
      preferredInputIds: [staged.inputId],
      requestId: "req_turn_input",
      runtime: createRuntime({
        checkpointActiveTurnInput: vi.fn(async () => undefined),
        refreshMailboxForActiveTurnInput,
      }),
      vaultRoot,
      wake: TIMER_WAKE,
    });

    await expect(source?.refresh({ phase: "input_available" })).resolves.toEqual({
      progressed: false,
      reason: "no_new_input",
    });
    await expect(source?.refresh({ phase: "request_boundary" })).resolves.toEqual({
      progressed: false,
      reason: "no_new_input",
    });

    expect(refreshMailboxForActiveTurnInput).toHaveBeenCalledTimes(1);
    expect(refreshMailboxForActiveTurnInput).toHaveBeenCalledWith({
      requestId: "req_turn_input",
    });
  });

  it("skips the first hosted mailbox refresh when initial import already progressed", async () => {
    const vaultRoot = await createTempVault();
    const refreshMailboxForActiveTurnInput =
      vi.fn<HostedRuntimeActiveTurnInputMailboxRefresh>(async () => ({
        progressed: false,
        reason: "no_new_input",
      }));
    const source = createHostedAssistantInputSource({
      requestId: "req_turn_input",
      runtime: createRuntime({
        checkpointActiveTurnInput: vi.fn(async () => undefined),
        refreshMailboxForActiveTurnInput,
      }),
      skipInitialMailboxRefresh: true,
      vaultRoot,
      wake: TIMER_WAKE,
    });

    await expect(source?.refresh({ phase: "input_available" })).resolves.toEqual({
      progressed: false,
      reason: "no_new_input",
    });
    await expect(source?.refresh({ phase: "request_boundary" })).resolves.toEqual({
      progressed: false,
      reason: "no_new_input",
    });

    expect(refreshMailboxForActiveTurnInput).toHaveBeenCalledTimes(1);
    expect(refreshMailboxForActiveTurnInput).toHaveBeenCalledWith({
      requestId: "req_turn_input",
    });
  });

  it("does not let newer preferred input skip older unprocessed input", async () => {
    const vaultRoot = await createTempVault();
    const older = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_older",
        eventId: "evt_older",
        itemId: "item_older",
        laneSeq: "10",
        messageId: "msg_older",
        occurredAt: "2026-04-23T00:00:01.000Z",
        receivedAt: "2026-04-23T00:00:02.000Z",
        text: "older unprocessed note",
      }),
    });
    const preferred = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createAssistantInputEvent({
        dedupeKey: "dedupe_preferred",
        eventId: "evt_preferred",
        itemId: "item_preferred",
        laneSeq: "20",
        messageId: "msg_preferred",
        occurredAt: "2026-04-23T00:00:03.000Z",
        receivedAt: "2026-04-23T00:00:04.000Z",
        text: "newer preferred note",
      }),
    });
    const source = createHostedAssistantInputSource({
      preferredInputIds: [preferred.inputId],
      requestId: "req_preferred",
      runtime: createRuntime(),
      vaultRoot,
      wake: TIMER_WAKE,
    });

    const fullPage = await source.listInputCandidates({
      limit: 2,
      sourceId: "linq",
    });
    const first = await source.listInputCandidates({
      limit: 1,
      sourceId: "linq",
    });
    const second = await source.listInputCandidates({
      afterCursor: first.nextCursor,
      limit: 1,
      sourceId: "linq",
    });

    expect(fullPage.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      older.inputId,
      preferred.inputId,
    ]);
    expect(fullPage.nextCursor).toEqual(preferred.cursor);
    expect(first.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      older.inputId,
    ]);
    expect(first.nextCursor).toEqual(older.cursor);
    expect(second.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      preferred.inputId,
    ]);
    expect(second.nextCursor).toEqual(preferred.cursor);
  });

  it("logs and rethrows hosted mailbox refresh failures", async () => {
    const hostedError = new Error("hosted mailbox refresh failed");
    const source = createHostedAssistantInputSource({
      requestId: "req_turn_input",
      runtime: createRuntime({
        checkpointActiveTurnInput: vi.fn(async () => undefined),
        refreshMailboxForActiveTurnInput: vi
          .fn<HostedRuntimeActiveTurnInputMailboxRefresh>()
          .mockRejectedValueOnce(hostedError),
      }),
      vaultRoot: "/tmp/vault-root",
      wake: TIMER_WAKE,
    });

    await expect(source?.refresh({ phase: "request_boundary" })).rejects.toThrow(
      "hosted mailbox refresh failed",
    );

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith({
      component: "runtime",
      details: {
        requestId: "req_turn_input",
      },
      error: hostedError,
      level: "warn",
      message:
        "Hosted assistant mailbox refresh failed during active turn input admission.",
      phase: "wake.running",
      wake: TIMER_WAKE,
    });
  });
});

async function createTempVault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-source-"));
  tempRoots.push(root);
  return path.join(root, "vault");
}

function createRuntime(input: {
  checkpointActiveTurnInput?: HostedRuntimeActiveTurnInputCheckpoint;
  refreshMailboxForActiveTurnInput?: HostedRuntimeActiveTurnInputMailboxRefresh;
} = {}) {
  return {
    forwardedEnv: {},
    platform: {
      artifactStore: {
        get: vi.fn(async () => null),
        put: vi.fn(async () => undefined),
      },
      effectsPort: {
        readRawEmailMessage: vi.fn(async () => null),
        sendEmail: vi.fn(async () => undefined),
      },
      ...(input.checkpointActiveTurnInput
        ? { checkpointActiveTurnInput: input.checkpointActiveTurnInput }
        : {}),
      ...(input.refreshMailboxForActiveTurnInput
        ? { refreshMailboxForActiveTurnInput: input.refreshMailboxForActiveTurnInput }
        : {}),
    },
    platformEnv: {},
  };
}

function createAssistantInputEvent(input: {
  dedupeKey?: string;
  eventId?: string;
  itemId?: string;
  laneSeq?: string;
  messageId?: string;
  occurredAt?: string;
  receivedAt?: string;
  text?: string;
} = {}) {
  const text = input.text ?? "late same-conversation note";
  return {
    content: {
      text,
      transcriptText: text,
      userMessageContent: [
        {
          text,
          type: "text" as const,
        },
      ],
    },
    conversation: {
      accountId: "acct_1",
      actorId: "actor_1",
      actorIsSelf: false,
      source: "linq",
      threadId: "thread_1",
      threadIsDirect: true,
    },
    occurredAt: input.occurredAt ?? "2026-04-23T00:00:02.000Z",
    receivedAt: input.receivedAt ?? "2026-04-23T00:00:03.000Z",
    replyTarget: {
      channel: "linq",
      messageId: input.messageId ?? "msg_late",
      threadId: "thread_1",
    },
    sourceRef: {
      dedupeKey: input.dedupeKey ?? "dedupe_late",
      eventId: input.eventId ?? "evt_late",
      itemId: input.itemId ?? "item_late",
      kind: "hosted-mailbox" as const,
      lane: "conversation" as const,
      laneSeq: input.laneSeq ?? "42",
      payloadSchema: "murph.hosted-mailbox-payload.v1",
      payloadSource: "inline" as const,
      source: "hosted-mailbox" as const,
      wakeSchema: "murph.hosted-execution-wake.v1",
    },
  };
}
