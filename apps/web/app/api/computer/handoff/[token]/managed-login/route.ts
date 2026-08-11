import { NextResponse } from "next/server";

import {
  withHostedComputerToolFailureRuntimeLog,
} from "@/src/lib/computer-use/runtime-log";
import { createComputerUseService } from "@/src/lib/computer-use/service";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const token = await resolveDecodedRouteParam(context.params, "token");
  const session = await requireActiveHostedAppSessionFromRequest(request);
  const handoffUrl = new URL(
    `/computer/handoff/${encodeURIComponent(token)}`,
    request.url,
  );

  try {
    const service = createComputerUseService();
    const result = await withHostedComputerToolFailureRuntimeLog({
      memberId: session.member.id,
      operation: "managed-login",
      run: async () => await service.continueManagedLoginHandoff({
        memberId: session.member.id,
        token,
      }),
    });

    switch (result.kind) {
      case "redirect":
        return noStoreRedirect(result.url);
      case "completed":
        return noStoreRedirect(handoffUrl);
      case "checkpointing":
        handoffUrl.searchParams.set("managed", "waiting");
        return noStoreRedirect(handoffUrl);
      case "expired":
        return noStoreRedirect(handoffUrl);
    }
  } catch (error) {
    if (!isRetryableManagedLoginError(error)) {
      throw error;
    }
    handoffUrl.searchParams.set("managed", "retry");
    return noStoreRedirect(handoffUrl);
  }
}

function noStoreRedirect(url: string | URL): NextResponse {
  const response = NextResponse.redirect(url, 303);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function isRetryableManagedLoginError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string" &&
      error.code.startsWith("HOSTED_COMPUTER_") &&
      "retryable" in error &&
      error.retryable === true,
  );
}
