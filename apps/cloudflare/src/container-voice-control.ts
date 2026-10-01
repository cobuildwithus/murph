import type { HostedRuntimeVoice } from "@murphai/assistant-runtime/hosted-invocation";
import type { HostedVoiceControlRequest, HostedVoiceControlResponse } from "@murphai/hosted-execution";

export interface HostedContainerActiveInvocation {
  abort(reason: Error): void;
  attemptId: string | null;
  leaseGeneration: string | null;
  userId: string;
  signal: AbortSignal;
  voice?: Pick<HostedRuntimeVoice, "connect" | "closeCall">;
}

/** The existing invocation is the sole lifetime owner; no control request starts work. */
export async function controlHostedContainerVoice(input: {
  command: HostedVoiceControlRequest & { userId: string };
  readCurrent(): HostedContainerActiveInvocation | null;
  shutdownSignal: AbortSignal;
}): Promise<HostedVoiceControlResponse> {
  const active = input.readCurrent();
  const command = input.command;
  if (!active || active.userId !== command.userId || active.attemptId !== command.attemptId
    || active.leaseGeneration !== command.leaseGeneration) return { kind: "unavailable" };
  const voice = active.voice;
  if (!voice) return { kind: "not_ready" };
  try {
    if (command.action === "close") {
      const receipt = await voice.closeCall(command.callId);
      return { kind: "closed", providerConfirmed: receipt?.providerConfirmed === true, seconds: receipt?.seconds ?? null };
    }
    if (active.signal.aborted || input.shutdownSignal.aborted) return { kind: "unavailable" };
    const sdp = await voice.connect(command.callId, command.sdp);
    if (input.readCurrent() !== active || active.signal.aborted || input.shutdownSignal.aborted) {
      return { kind: "unavailable" };
    }
    return { kind: "connected", sdp };
  } catch (error) {
    return classifyVoiceControlFailure(error);
  }
}

function classifyVoiceControlFailure(error: unknown): HostedVoiceControlResponse {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "HOSTED_VOICE_NOT_READY") return { kind: "not_ready" };
    if (error.code === "HOSTED_VOICE_CALL_UNAVAILABLE"
      || error.code === "ASSISTANT_VOICE_DELIVERY_UNAVAILABLE") return { kind: "unavailable" };
  }
  return { kind: "failed" };
}
