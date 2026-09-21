import {
  startHostedCodexAssistantVoice,
  type CodexRealtimeClosure,
  type CodexRealtimeInput,
  type CodexRealtimeSession,
  type HostedCodexAssistantVoiceInput,
} from "@murphai/assistant-engine/assistant-runtime";
import { HOSTED_ASSISTANT_TERRA_MODEL } from "@murphai/hosted-execution/assistant-model";
import { HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV, resolveHostedOperatorModelProvider } from "./codex-runtime-env.ts";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import { createHostedLiveUsageRecorder } from "./live-usage.ts";
import type { HostedRuntimeUsageRecordPort } from "./platform.ts";

type NativeVoiceOptions = Pick<
  HostedCodexAssistantVoiceInput,
  "sessionId" | "sdp" | "signal" | "onInput" | "onUsage"
>;
type StartNativeVoice = (options: NativeVoiceOptions) => Promise<CodexRealtimeSession>;

/** Ephemeral media only. The mailbox and checkpointed outbox still own work. */
export function createHostedRuntimeVoiceCall(input: {
  callId: string;
  memberId: string;
  signal: AbortSignal;
  usagePort: HostedRuntimeUsageRecordPort;
  admitInput(input: CodexRealtimeInput & { callId: string }): Promise<{ mailboxItemId: string }>;
  notifyRuntime(): void;
  onError(error: unknown): void;
}) {
  const abort = new AbortController();
  const acceptedMailboxItemIds = new Set<string>();
  let admissions = Promise.resolve();
  let starting: Promise<CodexRealtimeSession> | null = null;
  let native: CodexRealtimeSession | null = null;
  let offer: string | null = null;
  let closing: Promise<CodexRealtimeClosure | null> | null = null;
  let finished = false;
  const reservationTimer = setTimeout(() => { void close().catch(() => {}); }, 30_000);
  const usage = createHostedLiveUsageRecorder({
    memberId: input.memberId,
    sessionId: input.callId,
    port: input.usagePort,
    stopVoice: () => { void close().catch(() => {}); },
  });

  const onAbort = () => { void close().catch(() => {}); };
  input.signal.addEventListener("abort", onAbort, { once: true });

  function onInput(value: CodexRealtimeInput): void {
    if (abort.signal.aborted || input.signal.aborted) return;
    // Serialize admission, not backing work. Closing fences new notifications
    // but joins input already handed to the durable acceptance owner.
    admissions = admissions.then(async () => {
      const accepted = await input.admitInput({ ...value, callId: input.callId });
      acceptedMailboxItemIds.add(accepted.mailboxItemId);
      input.notifyRuntime();
    });
    void admissions.catch(() => { void close().catch(() => {}); });
  }

  function close(): Promise<CodexRealtimeClosure | null> {
    if (closing) return closing;
    abort.abort();
    clearTimeout(reservationTimer);
    input.signal.removeEventListener("abort", onAbort);
    closing = (async () => {
      try {
        const session = await starting?.catch(() => null);
        const receipt = session ? await session.close() : null;
        // The final receipt can precede the final usage callback. Coalescing
        // the same trusted total never charges twice.
        if (receipt?.seconds !== null && receipt?.seconds !== undefined) usage.observe(receipt.seconds);
        return receipt;
      } finally {
        try {
          await admissions;
        } finally {
          await usage.flush();
        }
      }
    })().catch((error: unknown) => {
      input.onError(error);
      throw error;
    }).finally(() => {
      finished = true;
      input.notifyRuntime();
    });
    return closing;
  }

  const unavailable = () => Object.assign(new VaultCliError(
    "ASSISTANT_VOICE_DELIVERY_UNAVAILABLE",
    "This voice call is no longer available.",
  ), { deliveryMayHaveSucceeded: false, retryable: false });

  if (input.signal.aborted) onAbort();

  return {
    callId: input.callId,
    isHoldingRuntime: () => !finished,
    close,
    async connect(sdp: string, start: StartNativeVoice): Promise<string> {
      if (abort.signal.aborted || input.signal.aborted) throw unavailable();
      if (offer !== null && offer !== sdp) throw unavailable();
      offer = sdp;
      starting ??= Promise.resolve().then(() => start({
        sessionId: input.callId,
        sdp,
        signal: abort.signal,
        onInput,
        onUsage: usage.observe,
      })).then((session) => {
        native = session;
        clearTimeout(reservationTimer);
        void session.closed.then(() => close(), () => close()).catch(() => {});
        return session;
      });
      try {
        const session = await starting;
        if (abort.signal.aborted) throw unavailable();
        return session.sdp;
      } catch (error) {
        await close();
        throw error;
      }
    },
    async speak(request: {
      callId: string;
      message: string;
      answeredMailboxItemIds: readonly string[];
    }): Promise<void> {
      if (
        !native || abort.signal.aborted || input.signal.aborted
        || request.callId !== input.callId
        || request.answeredMailboxItemIds.length === 0
        || request.answeredMailboxItemIds.some((id) => !acceptedMailboxItemIds.has(id))
      ) throw unavailable();
      // The existing non-idempotent outbox owns ambiguous failure. Never retry
      // here, and never redirect a stale call's answer to a subsequent call.
      await native.speak(request.message);
    },
  };
}

export type HostedRuntimeVoiceCall = ReturnType<typeof createHostedRuntimeVoiceCall>;

/** One invocation owns reservations, media, and the point at which it stops accepting calls. */
export function createHostedRuntimeVoice(input: {
  createCall(callId: string): HostedRuntimeVoiceCall;
  notifyRuntime(): void;
}) {
  let accepting = true;
  let current: HostedRuntimeVoiceCall | null = null;
  let start: StartNativeVoice | null = null;
  const usedCallIds = new Set<string>();
  return {
    reserve(callId: string): boolean {
      if (!accepting) return false;
      if (current?.callId === callId) return current.isHoldingRuntime();
      if (current?.isHoldingRuntime() || usedCallIds.has(callId)) return false;
      current = input.createCall(callId);
      usedCallIds.add(callId);
      input.notifyRuntime();
      return true;
    },
    bindStart(value: StartNativeVoice): void {
      start = value;
    },
    isHoldingRuntime: () => current?.isHoldingRuntime() === true,
    /** Called synchronously at the existing return decision, before yielding. */
    stopAccepting(): void {
      accepting = false;
    },
    async connect(callId: string, sdp: string): Promise<string> {
      if (!accepting || current?.callId !== callId) {
        throw new VaultCliError("HOSTED_VOICE_CALL_UNAVAILABLE", "The voice call reservation is unavailable.");
      }
      if (!start) {
        throw new VaultCliError("HOSTED_VOICE_NOT_READY", "The voice runtime is still starting.");
      }
      return await current.connect(sdp, start);
    },
    async closeCall(callId: string): Promise<CodexRealtimeClosure | null> {
      return current?.callId === callId ? await current.close() : null;
    },
    async close(): Promise<void> {
      accepting = false;
      await current?.close();
    },
    async speak(request: Parameters<HostedRuntimeVoiceCall["speak"]>[0]): Promise<void> {
      if (!current) {
        throw Object.assign(new VaultCliError(
          "ASSISTANT_VOICE_DELIVERY_UNAVAILABLE", "The accepted voice call is no longer available.",
        ), { deliveryMayHaveSucceeded: false, retryable: false });
      }
      await current.speak(request);
    },
  };
}

export type HostedRuntimeVoice = ReturnType<typeof createHostedRuntimeVoice>;

/** Keep media-specific launch policy out of the workspace checkpoint loop. */
export function configureHostedRuntimeVoice(
  voice: HostedRuntimeVoice | null | undefined,
  prepare: () => Promise<Pick<HostedCodexAssistantVoiceInput, "env" | "target" | "workingDirectory"> & { signal: AbortSignal }>,
): void {
  voice?.bindStart(async (nativeInput) => {
    const context = await prepare();
    context.signal.throwIfAborted();
    return await startHostedCodexAssistantVoice({
      ...context,
      ...nativeInput,
      mediaModel: HOSTED_ASSISTANT_TERRA_MODEL,
      mediaModelProvider: resolveHostedOperatorModelProvider(
        context.env?.[HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV],
      ),
      prompt: "You are Murph's voice interface. Delegate member requests to the backing assistant. Speak the responses it provides; do not answer from your own knowledge or claim work has completed before receiving its result.",
      signal: nativeInput.signal
        ? AbortSignal.any([context.signal, nativeInput.signal])
        : context.signal,
    });
  });
}
