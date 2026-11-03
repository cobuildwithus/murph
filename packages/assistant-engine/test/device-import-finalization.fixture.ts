import assert from "node:assert/strict";
import type { AssistantSession } from "@murphai/operator-config/assistant-cli-contracts";
import { persistAssistantTurnAndSession } from "../src/assistant/turn-finalizer.ts";
import { createAssistantRuntimeStateService } from "../src/assistant/runtime-state-service.ts";

// Shared composed-runtime fixture: real transcripts, turn events and session writes.
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
    await persistAssistantTurnAndSession({
      input: { prompt: "Synthetic prompt", vault }, session,
      plan: {
        cliAccess: { env: {}, rawCommand: "vault-cli" },
        conversationPolicy: {
          audience: { actorId: null, bindingDelivery: null, channel: "linq",
            deliveryPolicy: "binding-target-only", threadIsDirect: true,
            explicitTarget: "thread_1", identityId: "synthetic-member",
            replyToMessageId: null, threadId: "thread_1" },
          operatorAuthority: "direct-operator",
        },
        onboardingGuidanceOpen: false, firstContactStateDocIds: [],
        operatorAuthority: "direct-operator", persistUserPromptOnFailure: false,
        requestedWorkingDirectory: vault,
      },
      providerResult: {
        assistantContractFingerprint: "a".repeat(64), attemptCount: 1,
        codexContinuation: { kind: "explicit-structured-history" }, codexThreadId: null,
        provider: "codex-cli", providerOptions: session.providerOptions, rawEvents: [],
        response: "Your message is received.", responseDeliveryContextOrdinal: 0,
        route: { codexCommand: null, label: "synthetic", provider: "codex-cli",
          providerOptions: session.providerOptions, routeId: "synthetic" },
        session, stderr: "", stdout: "", transcriptResponse: "Your message is received.",
        workingDirectory: vault,
      },
      providerResumeStateAction: "preserve-existing", turnCreatedAt: now, turnId: receipt.turnId,
    });
    assert.equal((await state.sessions.get(session.sessionId))?.turnCount, 1);
    assert.ok((await state.turns.readReceipt(receipt.turnId))?.timeline.some(event => event.kind === "user.persisted"));
    assert.deepEqual((await state.transcripts.list(session.sessionId)).map(row => row.kind), ["user", "assistant"]);
  };
}
