import { parseHostedVoiceCallId, parseHostedVoiceControlRequest } from "@murphai/hosted-execution";
import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";
import { executeHostedRuntimeOwnerCommand } from "@/src/lib/hosted-execution/runtime-owner-control";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { assertActiveHostedMemberAccessAllowed } from "@/src/lib/hosted-onboarding/member-access";
import { resolveHostedRuntimeAiUsageGate } from "@/src/lib/hosted-orchestration/runtime-usage-decision";
import { readRawBodyBuffer } from "@/src/lib/http";
import { assertHostedHistoricalLaunchConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireHostedAppSessionFromRequest(request);
  const body: unknown = await readVoiceRequest(request);
  if (typeof body !== "object" || body === null || !("action" in body)) {
    throw new TypeError("Voice action is required.");
  }
  const userId = auth.member.id;
  const prisma = getPrisma();
  const control = readHostedExecutionControlClientIfConfigured(30_000);
  if (!control) {
    throw hostedOnboardingError({
      code: "VOICE_UNAVAILABLE", httpStatus: 503,
      message: "Murph cannot start a voice call right now.", retryable: true,
    });
  }
  // A member who loses allowance or consent must still be able to close their call.
  if (body.action === "close") {
    return jsonOk(await control.controlVoice({ userId, request: parseHostedVoiceControlRequest(body) }));
  }
  await assertActiveHostedMemberAccessAllowed({ memberId: userId, prisma });
  await assertHostedHistoricalLaunchConsentGranted({ memberId: userId, prisma });
  const gate = await resolveHostedRuntimeAiUsageGate({ mode: "read_first", userId, prisma });
  if (gate.status !== "allowed") {
    const limit = gate.status === "denied" && gate.decision.reason === "ai_usage_limit_exceeded";
    throw hostedOnboardingError({
      code: "VOICE_ACCESS_REQUIRED", httpStatus: limit ? 429 : 403,
      message: limit ? "Your AI usage limit has been reached. Try voice after it resets." : "Your Murph access is not active.",
    });
  }
  if (body.action !== "reserve") {
    return jsonOk(await control.controlVoice({ userId, request: parseHostedVoiceControlRequest(body) }));
  }
  if (!("callId" in body) || Object.keys(body).some((key) => !["action", "callId"].includes(key))) {
    throw new TypeError("Voice reservation is invalid.");
  }
  const callId = parseHostedVoiceCallId(body.callId);
  const result = await control.ensureRuntimeProcessing({
    userId, voiceCallId: callId, orchestrationAttemptId: `voice-${callId}`, commandTimeoutMs: 25_000,
  });
  if (!("kind" in result) || result.kind !== "runtime_processing_accepted") return jsonOk({ kind: "not_ready" });
  const { owner, cutover } = await executeHostedRuntimeOwnerCommand({ prisma, userId, command: { operation: "reconcile" } });
  if (cutover !== "postgres" || !owner || owner.attemptId !== result.runtimeAttemptId
    || (owner.phase !== "starting" && owner.phase !== "active")) return jsonOk({ kind: "not_ready" });
  return jsonOk({ kind: "reserved", callId, attemptId: owner.attemptId, leaseGeneration: owner.generation });
});

async function readVoiceRequest(request: Request): Promise<unknown> {
  const text = (await readRawBodyBuffer(request, { limitBytes: 72 * 1024 })).toString("utf8");
  try { return JSON.parse(text); }
  catch { throw new TypeError("Voice request must contain valid JSON."); }
}
