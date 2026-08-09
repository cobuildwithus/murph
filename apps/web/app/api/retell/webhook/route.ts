import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readRawBodyBuffer } from "@/src/lib/http";
import { retellWebhookPayloadSchema } from "@/src/lib/phone-calls/retell-payloads";
import {
  handleRetellCallAnalyzed,
  handleRetellCallEnded,
} from "@/src/lib/phone-calls/result";
import { accountRetellPhoneCallUsage } from "@/src/lib/phone-calls/usage";
import { verifyRetellSignature } from "@/src/lib/phone-calls/retell-signature";
import { signalHostedMailboxAppendRuntime } from "@/src/lib/hosted-orchestration/signal-runtime";

const RETELL_WEBHOOK_MAX_BODY_BYTES = 4 * 1024 * 1024;
const RETELL_RESULT_SIGNAL_FAILURE_TEST_ENV =
  "MURPH_HOSTED_LOCAL_E2E_FAIL_FIRST_RETELL_RESULT_RUNTIME_SIGNAL";
let failedFirstRetellResultSignalForHostedLocalE2e = false;

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
      await settleRetellWebhookBranches([
        () => accountRetellPhoneCallUsage({ call: payload.call }),
        async () => {
          const result = await handleRetellCallAnalyzed({ call: payload.call });
          if (result.notificationMailboxItemId) {
            await signalRetellResultMailboxAppendRuntime({
              expectedUserId: result.notificationUserId,
              mailboxItemId: result.notificationMailboxItemId,
            });
          }
        },
      ]);
      break;
    }
    case "transfer_ended":
      await accountRetellPhoneCallUsage({ call: payload.call });
      break;
  }

  return new Response(null, { status: 204 });
});

async function signalRetellResultMailboxAppendRuntime(input: {
  expectedUserId: string | null;
  mailboxItemId: string;
}): Promise<void> {
  // This hosted-local-only seam proves replay after a durable append and failed
  // Temporal signal without adding a production request surface.
  if (
    process.env.MURPH_HOSTED_LOCAL_PROFILE?.startsWith("e2e:")
    && process.env[RETELL_RESULT_SIGNAL_FAILURE_TEST_ENV] === "1"
    && !failedFirstRetellResultSignalForHostedLocalE2e
  ) {
    failedFirstRetellResultSignalForHostedLocalE2e = true;
    throw new Error("Hosted-local Retell result runtime signal fault injection.");
  }

  await signalHostedMailboxAppendRuntime(input);
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
