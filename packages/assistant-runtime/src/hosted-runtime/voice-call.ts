import type {
  CodexRealtimeClosure,
  CodexRealtimeInput,
  CodexRealtimeSession,
  HostedCodexAssistantVoiceInput,
} from "@murphai/assistant-engine/assistant-runtime";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import { createHostedLiveUsageRecorder } from "./live-usage.ts";
import type { HostedRuntimeUsageRecordPort } from "./platform.ts";

type NativeVoiceOptions = Pick<
  HostedCodexAssistantVoiceInput,
  "sessionId" | "sdp" | "signal" | "onInput" | "onUsage"
>;

/** Ephemeral media only. The mailbox and checkpointed outbox still own work. */
export function createHostedRuntimeVoiceCall(input: {
  callId: string;
  memberId: string;
  signal: AbortSignal;
  usagePort: HostedRuntimeUsageRecordPort;
  admitInput(input: CodexRealtimeInput & { callId: string }): Promise<{ mailboxItemId: string }>;
  notifyRuntime(): void;
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
    })().finally(() => {
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
    async connect(sdp: string, start: (options: NativeVoiceOptions) => Promise<CodexRealtimeSession>): Promise<string> {
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
