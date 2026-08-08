import { createHash } from "node:crypto";

import {
  buildHostedExecutionEnvironmentVoiceCapturedWake,
  HOSTED_EXECUTION_ENVIRONMENT_VOICE_CONTENT_TYPES,
  HOSTED_EXECUTION_ENVIRONMENT_VOICE_MAX_BYTES,
} from "@murphai/hosted-execution";

import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";
import {
  appendHostedEnvironmentVoiceMailboxEnvelopeTx,
  hasPendingHostedEnvironmentVoiceMailboxItem,
  hasPendingHostedEnvironmentVoiceMailboxItemTx,
  readHostedMailboxWakeAfterDedupeLockTx,
  readHostedMailboxWakeByDedupeKey,
} from "@/src/lib/hosted-mailbox/store";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "@/src/lib/hosted-onboarding/shared";
import {
  signalHostedMailboxAppendRuntime,
  signalHostedRuntimeRecheckRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import { resolveHostedRuntimeAiUsageGate } from "@/src/lib/hosted-orchestration/runtime-usage-decision";
import { readRawBodyBuffer } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

const CAPTURE_ID_HEADER = "x-murph-environment-voice-capture-id";
const CAPTURED_AT_HEADER = "x-murph-environment-voice-captured-at";
const DURATION_MS_HEADER = "x-murph-environment-voice-duration-ms";
const CAPTURE_TIME_TOLERANCE_MS = 10 * 60 * 1_000;

export const GET = withJsonError(async (request: Request) => {
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  const processing = await hasPendingHostedEnvironmentVoiceMailboxItem({
    userId: auth.member.id,
  });
  return jsonOk({ processing });
});

export const PATCH = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  const processing = await hasPendingHostedEnvironmentVoiceMailboxItem({
    userId: auth.member.id,
  });
  if (processing) {
    await signalHostedRuntimeRecheckRuntime({ userId: auth.member.id });
  }
  return jsonOk({
    processing,
    recheckRequested: processing,
  });
});

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  const upload = await readEnvironmentVoiceUpload(request);
  const eventId = `environment-voice:${upload.captureId}`;
  const prisma = getPrisma();
  const existingBeforeStage = await readHostedMailboxWakeByDedupeKey({
    dedupeKey: eventId,
    prisma,
    userId: auth.member.id,
  });
  if (!isExactEnvironmentVoiceRetry(existingBeforeStage, upload)) {
    const usageGate = await resolveHostedRuntimeAiUsageGate({
      mode: "read_first",
      prisma,
      userId: auth.member.id,
    });
    if (usageGate.status === "denied") {
      const message =
        usageGate.decision.reason === "ai_usage_limit_exceeded"
          ? "Murph has reached your current AI usage limit. Keep the recording and try again after more usage is available."
          : "Your Murph access is not active. Keep the recording and try again after restoring access.";
      throw hostedOnboardingError({
        code: "ENVIRONMENT_VOICE_AI_USAGE_DENIED",
        httpStatus:
          usageGate.decision.reason === "ai_usage_limit_exceeded" ? 429 : 403,
        message,
        retryable: true,
      });
    }
  }
  const control = readHostedExecutionControlClientIfConfigured();
  if (!control) {
    throw hostedOnboardingError({
      code: "ENVIRONMENT_VOICE_STORAGE_UNAVAILABLE",
      httpStatus: 503,
      message: "Murph cannot receive this recording right now.",
      retryable: true,
    });
  }

  const staged = await control.stageEnvironmentVoice({
    bytes: upload.bytes,
    captureId: upload.captureId,
    contentType: upload.contentType,
    sha256: upload.sha256,
    userId: auth.member.id,
  });
  const envelope = buildHostedExecutionEnvironmentVoiceCapturedWake({
    audioKey: staged.audioKey,
    byteLength: staged.byteLength,
    captureId: upload.captureId,
    capturedAt: upload.capturedAt,
    contentType: upload.contentType,
    durationMs: upload.durationMs,
    eventId,
    memberId: auth.member.id,
    occurredAt: upload.capturedAt,
    sha256: staged.sha256,
  });
  let appended: Awaited<
    ReturnType<typeof appendHostedEnvironmentVoiceMailboxEnvelopeTx>
  >;
  try {
    appended = await prisma.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, auth.member.id);
      const member = await tx.hostedMember.findUnique({
        select: { suspendedAt: true },
        where: { id: auth.member.id },
      });
      if (!member || member.suspendedAt) {
        throw hostedOnboardingError({
          code: "HOSTED_MEMBER_ACCESS_INACTIVE",
          httpStatus: 403,
          message: "Your Murph access is not active.",
        });
      }
      const existing = await readHostedMailboxWakeAfterDedupeLockTx({
        dedupeKey: eventId,
        tx,
        userId: auth.member.id,
      });
      if (
        !isExactEnvironmentVoiceRetry(existing, upload)
        && await hasPendingHostedEnvironmentVoiceMailboxItemTx({
          tx,
          userId: auth.member.id,
        })
      ) {
        throw hostedOnboardingError({
          code: "ENVIRONMENT_VOICE_ALREADY_PROCESSING",
          httpStatus: 409,
          message:
            "Murph is still processing your previous environment recording.",
          retryable: true,
        });
      }
      return await appendHostedEnvironmentVoiceMailboxEnvelopeTx({
        envelope,
        tx,
      });
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
    if (appended.dedupeConflict) {
      throw invalidEnvironmentVoiceUpload(
        "This recording conflicts with an earlier upload.",
      );
    }
  } catch (error) {
    await deleteUnclaimedEnvironmentVoice({
      audioKey: staged.audioKey,
      deleteAudio: () =>
        control.deleteEnvironmentVoice({
          audioKey: staged.audioKey,
          userId: auth.member.id,
        }),
      eventId,
      prisma,
      userId: auth.member.id,
    });
    throw error;
  }

  if (appended.claimedAudioKey !== staged.audioKey) {
    await deleteEnvironmentVoiceOrRetain(() =>
      control.deleteEnvironmentVoice({
        audioKey: staged.audioKey,
        userId: auth.member.id,
      })
    );
  }

  await signalHostedMailboxAppendRuntime({
    expectedUserId: auth.member.id,
    mailboxItemId: appended.item.id,
  });

  return jsonOk({
    accepted: true,
    captureId: upload.captureId,
    duplicate: appended.duplicate,
  }, 202);
});

async function readEnvironmentVoiceUpload(request: Request): Promise<{
  bytes: Uint8Array;
  captureId: string;
  capturedAt: string;
  contentType: (typeof HOSTED_EXECUTION_ENVIRONMENT_VOICE_CONTENT_TYPES)[number];
  durationMs: number;
  sha256: string;
}> {
  const requestedContentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  const contentType = HOSTED_EXECUTION_ENVIRONMENT_VOICE_CONTENT_TYPES.find(
    (candidate) => candidate === requestedContentType,
  );
  if (!contentType) {
    throw unsupportedEnvironmentVoiceUpload();
  }

  const captureId = request.headers.get(CAPTURE_ID_HEADER)?.trim() ?? "";
  if (!/^[a-f0-9]{64}$/u.test(captureId)) {
    throw invalidEnvironmentVoiceUpload("The recording identity is invalid.");
  }
  const durationMs = Number.parseInt(
    request.headers.get(DURATION_MS_HEADER) ?? "",
    10,
  );
  if (
    !Number.isSafeInteger(durationMs)
    || durationMs < 1_000
    || durationMs > 3 * 60 * 1_000
  ) {
    throw invalidEnvironmentVoiceUpload("The recording duration is invalid.");
  }
  const capturedAt = request.headers.get(CAPTURED_AT_HEADER)?.trim() ?? "";
  const capturedAtMs = Date.parse(capturedAt);
  if (
    !Number.isFinite(capturedAtMs)
    || capturedAtMs - Date.now() > CAPTURE_TIME_TOLERANCE_MS
  ) {
    throw invalidEnvironmentVoiceUpload("The recording time is invalid.");
  }

  let body: Buffer;
  try {
    body = await readRawBodyBuffer(request, {
      limitBytes: HOSTED_EXECUTION_ENVIRONMENT_VOICE_MAX_BYTES,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      throw hostedOnboardingError({
        code: "ENVIRONMENT_VOICE_TOO_LARGE",
        httpStatus: 413,
        message: "The recording is too large. Keep it under three minutes.",
      });
    }
    throw error;
  }
  const bytes = Uint8Array.from(body);
  if (
    bytes.byteLength === 0
    || !environmentVoiceSignatureMatches(bytes, contentType)
  ) {
    throw invalidEnvironmentVoiceUpload("The recording file is invalid.");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (captureId !== sha256) {
    throw invalidEnvironmentVoiceUpload("The recording identity does not match.");
  }

  return {
    bytes,
    captureId,
    capturedAt: new Date(capturedAtMs).toISOString(),
    contentType,
    durationMs,
    sha256,
  };
}

function isExactEnvironmentVoiceRetry(
  wake: Awaited<
    ReturnType<typeof readHostedMailboxWakeAfterDedupeLockTx>
  >,
  upload: {
    bytes: Uint8Array;
    captureId: string;
    capturedAt: string;
    contentType:
      (typeof HOSTED_EXECUTION_ENVIRONMENT_VOICE_CONTENT_TYPES)[number];
    durationMs: number;
    sha256: string;
  },
): boolean {
  if (!wake || wake.kind !== "environment-voice.captured") {
    return false;
  }
  const existing = wake.environmentVoice;
  return existing.byteLength === upload.bytes.byteLength
    && existing.captureId === upload.captureId
    && existing.capturedAt === upload.capturedAt
    && existing.contentType === upload.contentType
    && existing.durationMs === upload.durationMs
    && existing.sha256 === upload.sha256;
}

function environmentVoiceSignatureMatches(
  bytes: Uint8Array,
  contentType: (typeof HOSTED_EXECUTION_ENVIRONMENT_VOICE_CONTENT_TYPES)[number],
): boolean {
  if (contentType === "audio/webm") {
    return bytes.byteLength >= 4
      && bytes[0] === 0x1a
      && bytes[1] === 0x45
      && bytes[2] === 0xdf
      && bytes[3] === 0xa3;
  }
  if (contentType === "audio/ogg") {
    return bytes.byteLength >= 4
      && bytes[0] === 0x4f
      && bytes[1] === 0x67
      && bytes[2] === 0x67
      && bytes[3] === 0x53;
  }
  return bytes.byteLength >= 12
    && bytes[4] === 0x66
    && bytes[5] === 0x74
    && bytes[6] === 0x79
    && bytes[7] === 0x70;
}

async function deleteUnclaimedEnvironmentVoice(input: {
  audioKey: string;
  deleteAudio: () => Promise<void>;
  eventId: string;
  prisma: ReturnType<typeof getPrisma>;
  userId: string;
}): Promise<void> {
  try {
    const claimed = await input.prisma.$transaction(
      async (tx) =>
        await readHostedMailboxWakeAfterDedupeLockTx({
          dedupeKey: input.eventId,
          tx,
          userId: input.userId,
        }),
      HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
    );
    if (
      claimed?.kind === "environment-voice.captured"
      && claimed.environmentVoice.audioKey === input.audioKey
    ) {
      return;
    }
  } catch {
    console.warn(
      "Environment voice staging ownership was ambiguous; lifecycle cleanup retained it.",
    );
    return;
  }
  await deleteEnvironmentVoiceOrRetain(input.deleteAudio);
}

async function deleteEnvironmentVoiceOrRetain(
  deleteAudio: () => Promise<void>,
): Promise<void> {
  try {
    await deleteAudio();
  } catch {
    console.warn(
      "Environment voice staging cleanup failed; lifecycle cleanup retained it.",
    );
  }
}

function invalidEnvironmentVoiceUpload(message: string) {
  return hostedOnboardingError({
    code: "ENVIRONMENT_VOICE_INVALID",
    httpStatus: 400,
    message,
  });
}

function unsupportedEnvironmentVoiceUpload() {
  return hostedOnboardingError({
    code: "ENVIRONMENT_VOICE_FORMAT_UNSUPPORTED",
    httpStatus: 415,
    message: "This browser's recording format is not supported.",
  });
}
