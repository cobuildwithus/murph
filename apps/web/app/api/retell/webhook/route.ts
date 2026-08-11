import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readRawBodyBuffer } from "@/src/lib/http";
import {
  retellWebhookPayloadSchema,
} from "@/src/lib/phone-calls/retell-payloads";
import {
  prepareRetellCallResult,
  type PreparedRetellCallResult,
} from "@/src/lib/phone-calls/retell-result-lifecycle";
import {
  handleRetellCallAnalyzed,
  handleRetellCallEnded,
} from "@/src/lib/phone-calls/result";
import { accountRetellPhoneCallUsage } from "@/src/lib/phone-calls/usage";
import { verifyRetellSignature } from "@/src/lib/phone-calls/retell-signature";
import { signalHostedMailboxAppendRuntime } from "@/src/lib/hosted-orchestration/signal-runtime";

const RETELL_WEBHOOK_MAX_BODY_BYTES = 4 * 1024 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const rawBody = (await readRawBodyBuffer(request, {
    limitBytes: RETELL_WEBHOOK_MAX_BODY_BYTES,
  })).toString("utf8");

  verifyRetellSignature({
    rawBody,
    signature: request.headers.get("x-retell-signature"),
  });

  const payload = retellWebhookPayloadSchema.parse(JSON.parse(rawBody));
  switch (payload.event) {
    case "call_ended":
      await settleRetellWebhookBranches([
        () => accountRetellPhoneCallUsage({ call: payload.call }),
        () => handleRetellCallEnded({ call: payload.call }),
      ]);
      break;
    case "call_analyzed": {
      const resultCall = prepareRetellCallResult({
        call: payload.call,
        event: "call_analyzed",
      });
      await settleRetellWebhookBranches([
        () => accountRetellPhoneCallUsage({ call: payload.call }),
        ...(resultCall
          ? [() => handleRetellResult(resultCall)]
          : []),
      ]);
      break;
    }
    case "transfer_ended": {
      const resultCall = prepareRetellCallResult({
        call: payload.call,
        event: "transfer_ended",
      });
      await settleRetellWebhookBranches([
        () => accountRetellPhoneCallUsage({ call: payload.call }),
        () => handleRetellResult(resultCall),
      ]);
      break;
    }
  }

  return new Response(null, { status: 204 });
});

async function handleRetellResult(
  prepared: PreparedRetellCallResult,
): Promise<void> {
  const result = await handleRetellCallAnalyzed({
    call: prepared.call,
    ...(prepared.requiresTransferFollowUp
      ? { requiresTransferFollowUp: true }
      : {}),
  });
  if (!result.notificationMailboxItemId) {
    return;
  }
  await signalHostedMailboxAppendRuntime({
    expectedUserId: result.notificationUserId,
    mailboxItemId: result.notificationMailboxItemId,
  });
}

async function settleRetellWebhookBranches(
  branches: ReadonlyArray<() => Promise<unknown>>,
): Promise<void> {
  const results = await Promise.allSettled(
    branches.map((run) => Promise.resolve().then(run)),
  );
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) {
    throw failure.reason;
  }
}
