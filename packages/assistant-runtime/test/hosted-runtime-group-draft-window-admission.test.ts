// Real composed owners: import -> foreground loop -> assistant phase -> hosted input
// source -> reply admission -> held group draft window -> Codex app-server wire.
// Synthetic fixtures only. Ordering is proven from recorded times on one host clock.
import {
  REAL_SET_TIMEOUT,
  TEST_USER_ID,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createSnapshotFixtureRef,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceSnapshotV2Ref,
  createWorkspaceState,
  removeTempRoot,
  withRealTimeout,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";

import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeVault } from "@murphai/core";
import { buildHostedExecutionLinqConversationMessageWake } from "@murphai/hosted-execution";
import { HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV } from "@murphai/hosted-execution/env";
import { listAssistantOutboxIntents } from "@murphai/assistant-engine";
import type { HostedMailboxItem } from "@murphai/hosted-execution";
import { test } from "vitest";

import {
  createCoalescingRuntimeWakeSignal,
  runHostedWorkspaceRuntimeJobInProcess,
} from "../src/hosted-runtime.ts";
import { runHostedWorkspaceAssistantPhase } from "../src/hosted-runtime/workspace-assistant-phase.ts";
import { importHostedConversationMailboxItem } from "../src/hosted-runtime/mailbox-conversation-import.ts";
import { normalizeHostedAssistantRuntimeConfig } from "../src/hosted-runtime/environment.ts";
import type { HostedRuntimeLogRequest, HostedRuntimePlatform } from "../src/hosted-runtime-contracts.ts";

const GROUP_THREAD = "thread_synthetic_group_window";
const OTHER_THREAD = "thread_synthetic_other_group";
const FIRST_TEXT = "Synthetic group question about a meeting time.";
const FOLLOW_UP_TEXT = "Synthetic group follow-up asking for an earlier slot.";
const REACTION_TEXT = "Reacted with a like reaction.";
const FIRST_ANSWER = "Synthetic provisional answer to the first question.";
const COMBINED_ANSWER = "Synthetic answer covering both group messages.";

type Request0Mode = "answer" | "no_reply";
type FollowUp = "plain" | "native-reply" | "affirmative-reaction" | "other-thread";

// Codex app-server double. thread/start and thread/resume echo the requested
// execution context (including the group permission profile), as the engine's
// process fixtures do, so request 1 resumes instead of failing as stale. Request 0
// answers, or calls the real murph.finish_without_reply tool and ends with no
// message. A request that received the follow-up answers with the combined reply.
async function writeCodexDouble(root: string, eventLog: string, mode: Request0Mode): Promise<string> {
  const commandPath = path.join(root, "synthetic-group-window-codex.py");
  await writeFile(commandPath, `#!/usr/bin/python3
import json, sys, time

THREAD_ID = "00000000-0000-4000-8000-000000002706"
TOOL_CALL_ID = 777001
pending_tool = None

def log(event, **fields):
    with open(${JSON.stringify(eventLog)}, "a") as handle:
        handle.write(json.dumps(dict(ev=event, t=int(time.time() * 1000), **fields)) + "\\n")

def send(message):
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\\n")
    sys.stdout.flush()

def echo_context(params):
    result = {
        "approvalPolicy": params.get("approvalPolicy"),
        "cwd": params.get("cwd"),
        "modelProvider": params.get("modelProvider"),
        "runtimeWorkspaceRoots": params.get("runtimeWorkspaceRoots"),
        "thread": {"id": params.get("threadId", THREAD_ID)},
    }
    if params.get("permissions"):
        result["activePermissionProfile"] = {"id": params.get("permissions")}
    else:
        result["sandbox"] = {"type": "workspaceWrite"}
    return result

def complete(turn_id, text):
    if text is not None:
        send({"method": "item/completed", "params": {"completedAtMs": 1, "item": {
            "id": "assistant-" + turn_id, "memoryCitation": None, "phase": "final_answer",
            "text": text, "type": "agentMessage"}, "threadId": THREAD_ID, "turnId": turn_id}})
    send({"method": "turn/completed", "params": {"threadId": THREAD_ID, "turn": {
        "completedAt": 1, "durationMs": 1, "error": None, "id": turn_id, "items": [],
        "itemsView": "full", "startedAt": 0, "status": "completed"}}})

for line in sys.stdin:
    request = json.loads(line)
    method = request.get("method")
    if pending_tool and request.get("id") == TOOL_CALL_ID and "method" not in request:
        log("tool_result", success=bool((request.get("result") or {}).get("success")))
        turn_id = pending_tool
        pending_tool = None
        log("request_completed", followup=False)
        complete(turn_id, None)
        continue
    if method == "initialize":
        send({"id": request.get("id"), "result": {}})
        continue
    if method == "initialized":
        continue
    if method in ("thread/start", "thread/resume"):
        log(method.replace("/", "_"))
        send({"id": request.get("id"), "result": echo_context(request.get("params") or {})})
        continue
    if method == "turn/start":
        params = json.dumps(request.get("params") or {})
        followup = ${JSON.stringify(FOLLOW_UP_TEXT)} in params or ${JSON.stringify(REACTION_TEXT)} in params
        turn_id = "turn-group-window-" + str(int(time.time() * 1000))
        log("turn_start", followup=followup)
        send({"id": request.get("id"), "result": {"turn": {"id": turn_id}}})
        send({"method": "turn/started", "params": {"threadId": THREAD_ID, "turn": {
            "completedAt": None, "durationMs": None, "error": None, "id": turn_id,
            "items": [], "itemsView": "full", "startedAt": 0, "status": "inProgress"}}})
        if followup:
            log("request_completed", followup=True)
            complete(turn_id, ${JSON.stringify(COMBINED_ANSWER)})
        elif ${JSON.stringify(mode)} == "no_reply":
            pending_tool = turn_id
            send({"id": TOOL_CALL_ID, "method": "item/tool/call", "params": {
                "namespace": "murph", "tool": "finish_without_reply", "arguments": {},
                "threadId": THREAD_ID, "turnId": turn_id, "callId": "call-synthetic-no-reply"}})
        else:
            log("request_completed", followup=False)
            complete(turn_id, ${JSON.stringify(FIRST_ANSWER)})
        continue
    if "id" in request and "method" in request:
        send({"id": request["id"], "result": {}})
`, "utf8");
  await chmod(commandPath, 0o755);
  return commandPath;
}

type ProviderEvent = { ev: string; t: number; followup?: boolean; success?: boolean };
async function readProviderEvents(file: string): Promise<ProviderEvent[]> {
  try {
    return (await readFile(file, "utf8")).trim().split("\n").filter(Boolean)
      .map((line) => JSON.parse(line) as ProviderEvent);
  } catch {
    return [];
  }
}

async function runGroupWindowScenario(input: { mode: Request0Mode; followUp: FollowUp }) {
  const root = await mkdtemp(path.join(tmpdir(), "murph-group-draft-admission-"));
  const vaultRoot = path.join(root, "vault");
  const eventLog = path.join(root, "provider-events.jsonl");
  const logRequests: HostedRuntimeLogRequest[] = [];
  const staged: Array<{ laneSeq: string; at: number }> = [];
  try {
    const codexCommand = await writeCodexDouble(root, eventLog, input.mode);
    const events: string[] = [];
    const mailboxItems: HostedMailboxItem[] = [createMailboxItem({
      causalSeq: "11", id: "mailbox_item_group_window_first", laneSeq: "1",
    })];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const linqSends: string[] = [];
    const providerFetch: typeof fetch = async (request, init) => {
      const url = request instanceof Request ? request.url : String(request);
      const method = init?.method ?? (request instanceof Request ? request.method : "GET");
      if (method === "POST" && url.includes("/messages")) {
        linqSends.push(new URL(url).pathname);
        return Response.json({ message: { id: `provider_group_window_${linqSends.length}` } });
      }
      return new Response(null, { status: 204 });
    };
    const basePlatform = createPlatform({
      logRequests,
      mailboxPort: createMailboxPort({ events, items: mailboxItems }),
      workspacePort: createWorkspacePort({
        checkpointRequests: [],
        events,
        workspace: createWorkspaceState({
          snapshotRef: createWorkspaceSnapshotV2Ref("snapshot_group_window"),
          version: "0",
        }),
      }),
      workspaceSnapshotPort: {
        async abortSnapshotSession() { throw new Error("unexpected snapshot abort"); },
        async completeSnapshotSession() { throw new Error("unexpected snapshot completion"); },
        async putSnapshotObjectDirect() { throw new Error("unexpected snapshot upload"); },
        async restoreWorkspaceSnapshot(restore) {
          await initializeVault({
            createdAt: new Date().toISOString(),
            vaultRoot: path.join(restore.durableRoot, "vault"),
          });
        },
        async startSnapshotSession() { throw new Error("unexpected snapshot start"); },
      },
    });
    const platform: HostedRuntimePlatform = {
      ...basePlatform,
      effectsPort: {
        async assertLinqRecentInboundEngagement() {
          return {
            providerDispatchClaimed: true,
            resolvedRoute: {
              conversationThreadId: null,
              directRecipientPhoneNumber: null,
              fromPhoneNumber: null,
              target: GROUP_THREAD,
              targetKind: "thread",
              threadIsDirect: false,
            },
          };
        },
        async readRawEmailMessage() { return null; },
        async recordLinqDeliveryOutcome() {},
        async sendEmail() {},
      },
      providerFetch,
    };
    const runtimeJobInput = createWorkspaceRuntimeJobInput({
      forwardedEnv: {
        [HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV]: codexCommand,
        LINQ_API_TOKEN: "synthetic-linq-token",
        NODE_ENV: "test",
      },
      resolvedConfig: {
        channelCapabilities: { emailSendReady: false, telegramBotConfigured: false },
        deviceSync: null,
        managedAutoReplyChannels: [{ capabilityReady: true, channel: "linq", memberChannel: "linq" }],
      },
      request: {
        attemptId: "attempt_group_draft_admission",
        budget: { maxMailboxItems: 10 },
        leaseGeneration: "3",
        runnerIdleTtlMs: 50,
        userId: TEST_USER_ID,
        workspaceVersion: "0",
      },
    });
    const importRuntime = normalizeHostedAssistantRuntimeConfig(runtimeJobInput.runtime, platform);

    // Queue the follow-up 300 ms after request 0 completed (provider side), so it
    // is staged inside the held window rather than at a fixed offset from an
    // earlier hook.
    let followUpQueued = false;
    let watching = true;
    const watcher = (async () => {
      while (watching && !followUpQueued) {
        const done = (await readProviderEvents(eventLog))
          .find((event) => event.ev === "request_completed" && event.followup === false);
        if (done) {
          await new Promise((resolve) => REAL_SET_TIMEOUT(resolve, Math.max(0, done.t + 300 - Date.now())));
          const at = new Date().toISOString();
          mailboxItems.push(createMailboxItem({
            causalSeq: "14",
            createdAt: at,
            id: "mailbox_item_group_window_follow_up",
            laneSeq: "2",
            occurredAt: at,
            updatedAt: at,
          }));
          followUpQueued = true;
          runtimeWakeSignal.notify();
          return;
        }
        await new Promise((resolve) => REAL_SET_TIMEOUT(resolve, 10));
      }
    })();

    await withRealTimeout(runHostedWorkspaceRuntimeJobInProcess(runtimeJobInput, {
      async createCheckpointSnapshot() {
        return { snapshotRef: createSnapshotFixtureRef({ hash: "7".repeat(64), size: 512 }) };
      },
      async importItem(item, context) {
        const isFollowUp = item.item.laneSeq === "2";
        const thread = isFollowUp && input.followUp === "other-thread" ? OTHER_THREAD : GROUP_THREAD;
        const reaction = isFollowUp && input.followUp === "affirmative-reaction";
        const wake = buildHostedExecutionLinqConversationMessageWake({
          accountLookupKey: "hbidx:synthetic-group-account",
          eventId: item.item.dedupeKey,
          linqMessage: {
            ...(reaction ? { affirmativeReaction: true as const } : {}),
            chatId: thread,
            from: "+15550000271",
            isFromMe: false,
            messageId: `msg_${item.item.id}`,
            parts: [{ type: "text", value: !isFollowUp ? FIRST_TEXT : reaction ? REACTION_TEXT : FOLLOW_UP_TEXT }],
            ...(isFollowUp && (input.followUp === "native-reply" || reaction)
              ? { replyToMessageId: "msg_synthetic_earlier_group_message" }
              : {}),
            reactionEligible: !reaction,
            service: "iMessage",
            threadIsDirect: false,
          },
          occurredAt: item.item.occurredAt,
          phoneLookupKey: "+15550000271",
          routeAuthority: {
            accountLookupKey: "hbidx:synthetic-group-account",
            channel: "linq",
            containerMemberId: TEST_USER_ID,
            threadId: thread,
          },
          userId: TEST_USER_ID,
        });
        return await importHostedConversationMailboxItem({
          decodePayload: { async decode() { return { status: "decoded", wake }; } },
          async importConversationWake() {
            return { captureId: null, metrics: { nextWakeAt: null, parserProcessed: 0 } };
          },
          item,
          onConversationInputStaged: (channel) => {
            staged.push({ at: Date.now(), laneSeq: item.item.laneSeq });
            context?.onConversationInputStaged?.(channel);
          },
          runtime: importRuntime,
          signal: context?.signal ?? null,
          vaultRoot,
        });
      },
      platform,
      runtimeWakeSignal,
      runAssistantPhase: runHostedWorkspaceAssistantPhase,
      vaultRoot,
    }), 60_000, () => events.join(","));
    watching = false;
    await watcher;

    // Source-owned pass rows; the first assistant pass ends at its pass_finished.
    const firstPass: Array<Record<string, unknown>> = [];
    let passEnded = false;
    for (const request of logRequests) {
      for (const entry of request.entries) {
        if (entry.eventCode === "assistant.pass_finished") passEnded = true;
        if (!passEnded && entry.eventCode === "assistant.automation_detail") {
          firstPass.push((entry.redactedJson ?? {}) as Record<string, unknown>);
        }
      }
    }
    const providerEvents = await readProviderEvents(eventLog);
    return {
      firstPass,
      followUpStagedAt: staged.find((entry) => entry.laneSeq === "2")?.at ?? null,
      intents: (await listAssistantOutboxIntents(vaultRoot)).map((intent) => intent.message),
      linqSends: linqSends.length,
      providerEvents,
    };
  } finally {
    await removeTempRoot(root);
  }
}

const exactLookupRows = (rows: Array<Record<string, unknown>>) =>
  rows.filter((row) => row.type === "assistant.input_candidates.listed" && row.exactLookupCalled === true);
const providerOrdinals = (rows: Array<Record<string, unknown>>) =>
  rows.filter((row) => row.turnTimingStage === "provider-result-returned").map((row) => row.providerRequestOrdinal);

test.each([
  { followUp: "plain" as const, mode: "answer" as const },
  { followUp: "native-reply" as const, mode: "answer" as const },
  { followUp: "plain" as const, mode: "no_reply" as const },
  { followUp: "native-reply" as const, mode: "no_reply" as const },
])("admits a $followUp follow-up staged inside the held window after a $mode request into request 1 of the same pass", async (scenario) => {
  const result = await runGroupWindowScenario(scenario);
  const outcome = JSON.stringify(result);
  const requestZeroDone = result.providerEvents.find((event) => event.ev === "request_completed" && event.followup === false);
  const requestOneStart = result.providerEvents.find((event) => event.ev === "turn_start" && event.followup === true);
  assert.ok(requestZeroDone && requestOneStart && result.followUpStagedAt !== null, outcome);
  // Staged after request 0 settled, then request 1 at the end of the 4 s window.
  assert.ok(result.followUpStagedAt > requestZeroDone.t, outcome);
  assert.ok(requestOneStart.t > result.followUpStagedAt, outcome);
  const windowMs = requestOneStart.t - requestZeroDone.t;
  assert.ok(windowMs >= 3_500 && windowMs <= 6_500, outcome);
  if (scenario.mode === "no_reply") {
    assert.ok(result.providerEvents.some((event) => event.ev === "tool_result" && event.success === true), outcome);
  }
  assert.ok(result.providerEvents.some((event) => event.ev === "thread_resume"), outcome);
  assert.equal(result.providerEvents.filter((event) => event.ev === "turn_start").length, 2, outcome);
  assert.deepEqual(providerOrdinals(result.firstPass), [0, 1], outcome);
  assert.ok(!result.firstPass.some((row) => row.type === "input.reply-failed"), outcome);
  assert.deepEqual(result.intents, [COMBINED_ANSWER], outcome);
  assert.equal(result.linqSends, 1, outcome);
  // The admission that accepted the follow-up records its own exact lookup.
  assert.deepEqual(exactLookupRows(result.firstPass).map((row) => [
    row.exactLookupRequestedCount, row.exactLookupReturnedCount, row.exactLookupExclusionSummary,
  ]), [[1, 1, "none"]], outcome);
}, 90_000);

test("keeps an in-window affirmative reaction out of request 1 and names the grouping step", async () => {
  const result = await runGroupWindowScenario({ followUp: "affirmative-reaction", mode: "no_reply" });
  const outcome = JSON.stringify(result);
  assert.deepEqual(providerOrdinals(result.firstPass), [0], outcome);
  assert.ok(result.firstPass.some((row) => row.safeDetails === "reply_skip:intentional_no_reply"), outcome);
  const rows = exactLookupRows(result.firstPass);
  assert.ok(rows.length > 0, outcome);
  for (const row of rows) {
    assert.equal(row.exactLookupRequestedCount, 1, outcome);
    assert.equal(row.exactLookupReturnedCount, 0, outcome);
    assert.equal(row.exactLookupExclusionSummary, "not_grouped_with_anchor:1", outcome);
  }
}, 90_000);

test("does not offer another thread's message to this turn's exact lookup", async () => {
  const result = await runGroupWindowScenario({ followUp: "other-thread", mode: "answer" });
  const outcome = JSON.stringify(result);
  assert.deepEqual(providerOrdinals(result.firstPass), [0], outcome);
  assert.deepEqual(exactLookupRows(result.firstPass), [], outcome);
  // Its admissions still record that no exact lookup was requested.
  assert.ok(result.firstPass.some((row) => row.exactLookupCalled === false && row.exactLookupRequestedCount === 0), outcome);
  assert.deepEqual(result.intents.sort(), [COMBINED_ANSWER, FIRST_ANSWER].sort(), outcome);
}, 90_000);
