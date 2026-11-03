import assert from "node:assert/strict";
import type { AssistantSession } from "@murphai/operator-config/assistant-cli-contracts";
import { createAssistantRuntimeStateService } from "@murphai/assistant-engine/assistant-state";

// Synthetic finalization tail: the same runtime-state writes persistAssistantTurnAndSession
// performs after provider return (user transcript, user.persisted event, assistant
// transcript, session save), through the public state service.
export async function prepareSyntheticFinalization(vault: string, now: string) {
  const target: AssistantSession["target"] = {
    adapter: "codex-cli", approvalPolicy: "never", codexCommand: null, codexHome: null,
    model: "gpt-6.1-sol", modelProvider: "hosted-openai", oss: false, profile: null,
    reasoningEffort: "medium", sandbox: "danger-full-access",
  };
  const session: AssistantSession = {
    alias: null, binding: {
      actorId: null, channel: "linq", conversationKey: null,
      delivery: { kind: "thread", target: "thread_1" }, identityId: "synthetic-member",
      threadId: "thread_1", threadIsDirect: true,
    }, createdAt: now, codexResume: null, codexTarget: target,
    conversationId: "synthetic-finalization", lastTurnAt: null, provider: "codex-cli",
    providerOptions: {
      provider: "codex-cli", approvalPolicy: "never", codexHome: null,
      continuityFingerprint: "synthetic", executionDriver: "codex-app-server",
      model: target.model, modelProvider: "hosted-openai", oss: false, profile: null,
      reasoningEffort: "medium", resumeKind: "codex-thread", sandbox: "danger-full-access",
    },
    resumeState: null, schema: "murph.assistant-conversation.v2",
    sessionId: "synthetic-finalization", target, turnCount: 0, updatedAt: now,
  };
  const state = createAssistantRuntimeStateService(vault);
  const receipt = await state.turns.createReceipt({
    deliveryRequested: true, prompt: "Synthetic prompt", provider: "codex-cli",
    providerModel: target.model, sessionId: session.sessionId, startedAt: now,
  });
  return async () => {
    await state.transcripts.append(session.sessionId, [
      { kind: "user", text: "Synthetic prompt", createdAt: now },
    ]);
    await state.turns.appendEvent({
      turnId: receipt.turnId, kind: "user.persisted",
      detail: "user prompt persisted after provider completion", at: now,
    });
    await state.transcripts.append(session.sessionId, [
      { kind: "assistant", text: "Your message is received.", createdAt: now },
    ]);
    await state.sessions.save({ ...session, lastTurnAt: now, turnCount: session.turnCount + 1, updatedAt: now });
    assert.equal((await state.sessions.get(session.sessionId))?.turnCount, 1);
    assert.ok((await state.turns.readReceipt(receipt.turnId))?.timeline.some(event => event.kind === "user.persisted"));
    assert.deepEqual((await state.transcripts.list(session.sessionId)).map(row => row.kind), ["user", "assistant"]);
  };
}
