import {
  parseHostedCodexAuthSeedRequest,
  parseHostedCodexAuthSeedResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_CODEX_AUTH_SEED_RESPONSE_MAX_BYTES,
  type HostedCodexAuthSeedResponse,
} from "@murphai/hosted-execution/runtime-control";

import { readHostedCodexAuthAccessSeedForRuntime } from "@/src/lib/codex-auth/store";
import { requireHostedCloudflareCallbackRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readHostedRuntimeWriteFence } from "@/src/lib/hosted-execution/runtime-write-fence";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import { readRawBodyBuffer } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_CODEX_AUTH_SEED_REQUEST_BODY_LIMIT_BYTES = 4 * 1_024;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
} as const;

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

// This route can return credential plaintext. Keep it on the signed POST-only
// control plane and do not wrap it with a logger that may inspect errors or
// response bodies.
export async function POST(request: Request): Promise<Response> {
  try {
    if (!readHostedRuntimeWriteFence(request)) {
      throw hostedOnboardingError({
        code: "HOSTED_CODEX_AUTH_SEED_WRITE_FENCE_REQUIRED",
        httpStatus: 401,
        message: "Hosted Codex auth seed read requires the active runtime write fence.",
      });
    }

    const payloadText = (await readRawBodyBuffer(request, {
      limitBytes: HOSTED_CODEX_AUTH_SEED_REQUEST_BODY_LIMIT_BYTES,
    })).toString("utf8");
    const memberId = await requireHostedCloudflareCallbackRequest(request, {
      maxBodyBytes: HOSTED_CODEX_AUTH_SEED_REQUEST_BODY_LIMIT_BYTES,
      payloadText,
    });
    const seedRequest = parseHostedCodexAuthSeedRequest(
      payloadText.trim() ? JSON.parse(payloadText) : {},
    );
    const response = await readHostedCodexAuthAccessSeedForRuntime({
      includeCredentials: seedRequest.includeCredentials,
      knownConnectionVersion: seedRequest.knownConnectionVersion,
      memberId,
      prisma: getPrisma(),
    });

    return sensitiveHostedCodexAuthSeedJson(parseHostedCodexAuthSeedResponse(response));
  } catch (error) {
    return sensitiveHostedCodexAuthSeedError(error);
  }
}

function sensitiveHostedCodexAuthSeedJson(
  response: HostedCodexAuthSeedResponse,
): Response {
  const body = JSON.stringify(response);
  if (new TextEncoder().encode(body).byteLength > HOSTED_CODEX_AUTH_SEED_RESPONSE_MAX_BYTES) {
    return sensitiveHostedCodexAuthSeedError(new Error("Hosted Codex auth seed response too large."));
  }
  return new Response(body, {
    headers: NO_STORE_HEADERS,
    status: 200,
  });
}

function sensitiveHostedCodexAuthSeedError(error: unknown): Response {
  if (isHostedOnboardingError(error)) {
    return sensitiveHostedCodexAuthSeedErrorResponse({
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      status: error.httpStatus,
    });
  }
  if (error instanceof RangeError) {
    return sensitiveHostedCodexAuthSeedErrorResponse({
      code: "HOSTED_CODEX_AUTH_SEED_BODY_TOO_LARGE",
      message: "Hosted Codex auth seed request body is too large.",
      retryable: false,
      status: 413,
    });
  }
  if (error instanceof SyntaxError || error instanceof TypeError) {
    return sensitiveHostedCodexAuthSeedErrorResponse({
      code: "HOSTED_CODEX_AUTH_SEED_REQUEST_INVALID",
      message: "Hosted Codex auth seed request is invalid.",
      retryable: false,
      status: 400,
    });
  }
  return sensitiveHostedCodexAuthSeedErrorResponse({
    code: "INTERNAL_ERROR",
    message: "Internal error.",
    retryable: false,
    status: 500,
  });
}

function sensitiveHostedCodexAuthSeedErrorResponse(input: {
  code: string;
  message: string;
  retryable: boolean;
  status: number;
}): Response {
  return new Response(JSON.stringify({
    error: {
      code: input.code,
      message: input.message,
      retryable: input.retryable,
    },
  }), {
    headers: NO_STORE_HEADERS,
    status: input.status,
  });
}
