import { after } from "next/server";

import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import {
  jsonOk,
  readOptionalJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  parseHostedLinqTypingDiagnosticRequest,
  prepareHostedLinqTypingDiagnostic,
  runHostedLinqTypingDiagnosticBurst,
} from "@/src/lib/hosted-onboarding/linq-typing-diagnostic";
import { deriveHostedOnboardingTimingErrorName } from "@/src/lib/hosted-onboarding/logging";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const parsedRequest = parseHostedLinqTypingDiagnosticRequest(
    await readOptionalJsonObject(request),
  );
  const plan = await prepareHostedLinqTypingDiagnostic({
    prisma: getPrisma(),
    request: parsedRequest,
  });

  if (parsedRequest.mode === "inline") {
    const result = await runHostedLinqTypingDiagnosticBurst({
      plan,
      signal: request.signal,
    });

    return jsonOk({
      ...result,
      mode: parsedRequest.mode,
      scheduled: false,
    });
  }

  after(async () => {
    try {
      await runHostedLinqTypingDiagnosticBurst({
        plan,
      });
    } catch (error) {
      console.error("Hosted Linq typing diagnostic deferred burst failed.", {
        errorName: deriveHostedOnboardingTimingErrorName(error),
      });
    }
  });

  return jsonOk({
    mode: parsedRequest.mode,
    ok: true,
    scheduled: true,
    target: plan.target,
    totalAttempts: plan.delaysMs.length + (plan.stop ? 1 : 0),
  }, 202);
});
