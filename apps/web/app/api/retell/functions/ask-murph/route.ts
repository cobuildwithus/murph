import { NextResponse } from "next/server";

import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { readRawBodyBuffer } from "@/src/lib/http";
import {
  consultPhoneCall,
  getHostedPhoneCallForConsultation,
} from "@/src/lib/phone-calls/consult";
import {
  hasRetellBasicAttributesOnlyStorage,
  retellAskMurphPayloadSchema,
  readRetellMurphPhoneCallId,
} from "@/src/lib/phone-calls/retell-payloads";
import { verifyRetellSignature } from "@/src/lib/phone-calls/retell-signature";

const RETELL_ASK_MURPH_MAX_BODY_BYTES = 2 * 1024 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const rawBody = (await readRawBodyBuffer(request, {
    limitBytes: RETELL_ASK_MURPH_MAX_BODY_BYTES,
  })).toString("utf8");

  verifyRetellSignature({
    rawBody,
    signature: request.headers.get("x-retell-signature"),
  });

  const payload = retellAskMurphPayloadSchema.parse(JSON.parse(rawBody));
  const storageMode = payload.call.data_storage_setting?.trim().toLowerCase() || null;
  if (storageMode !== null && !hasRetellBasicAttributesOnlyStorage(payload.call)) {
    throw hostedOnboardingError({
      code: "RETELL_STORAGE_MODE_MISMATCH",
      details: {
        code: "retell_storage_mode_mismatch",
        operationName: "retell.function.ask_murph",
        type: storageMode,
      },
      httpStatus: 409,
      message: "Retell phone call storage mode does not permit consultation.",
      retryable: true,
    });
  }
  const murphCallId = readRetellMurphPhoneCallId(payload.call);
  if (!murphCallId) {
    return NextResponse.json(
      {
        error: {
          code: "RETELL_MURPH_CALL_ID_REQUIRED",
          message: "Missing Murph phone call id.",
        },
      },
      { status: 400 },
    );
  }

  const call = await getHostedPhoneCallForConsultation({
    callId: murphCallId,
    providerCallId: payload.call.call_id,
    providerStorageVerified: hasRetellBasicAttributesOnlyStorage(payload.call),
    signal: request.signal,
  });
  const advice = await consultPhoneCall({
    call,
    memberId: call.memberId,
    question: payload.args.question,
    transcript: payload.call.transcript ?? "",
  });

  return NextResponse.json(advice);
});
