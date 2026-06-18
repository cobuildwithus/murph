import {
  parseHostedComputerActRequest,
  parseHostedComputerEvalRequest,
  parseHostedComputerFinishRunRequest,
  parseHostedComputerObserveRequest,
  parseHostedComputerPauseForUserRequest,
  parseHostedComputerStartRunRequest,
  type HostedComputerActRequest,
  type HostedComputerEvalRequest,
  type HostedComputerFinishRunRequest,
  type HostedComputerObserveRequest,
  type HostedComputerPauseForUserRequest,
  type HostedComputerStartRunRequest,
} from "@murphai/hosted-execution/computer-use";

import { requireHostedCloudflareCallbackRequest } from "../hosted-execution/cloudflare-callback-auth";
import {
  jsonOk,
  readHostedOnboardingRawBodyText,
  withJsonError,
} from "../hosted-onboarding/http";
import { resolveDecodedRouteParam } from "../http";
import { computerUseError } from "./errors";

const COMPUTER_USE_INTERNAL_BODY_LIMIT_BYTES = 256 * 1024;

export { jsonOk, resolveDecodedRouteParam, withJsonError };

export async function readSignedComputerStartRunRequest(
  request: Request,
): Promise<{ body: HostedComputerStartRunRequest; memberId: string }> {
  return readSignedComputerJson(request, parseHostedComputerStartRunRequest);
}

export async function readSignedComputerObserveRequest(
  request: Request,
): Promise<{ body: HostedComputerObserveRequest; memberId: string }> {
  return readSignedComputerJson(request, parseHostedComputerObserveRequest);
}

export async function readSignedComputerActRequest(
  request: Request,
): Promise<{ body: HostedComputerActRequest; memberId: string }> {
  return readSignedComputerJson(request, parseHostedComputerActRequest);
}

export async function readSignedComputerEvalRequest(
  request: Request,
): Promise<{ body: HostedComputerEvalRequest; memberId: string }> {
  return readSignedComputerJson(request, parseHostedComputerEvalRequest);
}

export async function readSignedComputerPauseForUserRequest(
  request: Request,
): Promise<{ body: HostedComputerPauseForUserRequest; memberId: string }> {
  return readSignedComputerJson(request, parseHostedComputerPauseForUserRequest);
}

export async function readSignedComputerFinishRunRequest(
  request: Request,
): Promise<{ body: HostedComputerFinishRunRequest; memberId: string }> {
  return readSignedComputerJson(request, parseHostedComputerFinishRunRequest);
}

async function readSignedComputerJson<TBody>(
  request: Request,
  parse: (value: unknown) => TBody,
): Promise<{ body: TBody; memberId: string }> {
  const payloadText = await readHostedOnboardingRawBodyText(request, {
    limitBytes: COMPUTER_USE_INTERNAL_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_COMPUTER_BODY_TOO_LARGE",
    tooLargeErrorMessage: "Computer request body is too large.",
  });
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: COMPUTER_USE_INTERNAL_BODY_LIMIT_BYTES,
    payloadText,
  });

  return {
    body: parseComputerRequestBody(parseComputerJsonPayload(payloadText), parse),
    memberId,
  };
}

function parseComputerJsonPayload(payloadText: string): unknown {
  if (!payloadText.trim()) {
    return {};
  }

  try {
    return JSON.parse(payloadText);
  } catch {
    throw computerUseError({
      code: "HOSTED_COMPUTER_INVALID_JSON",
      httpStatus: 400,
      message: "Computer request body must be valid JSON.",
    });
  }
}

function parseComputerRequestBody<TBody>(
  payload: unknown,
  parse: (value: unknown) => TBody,
): TBody {
  try {
    return parse(payload);
  } catch {
    throw computerUseError({
      code: "HOSTED_COMPUTER_INVALID_REQUEST",
      httpStatus: 400,
      message: "Computer request body is invalid.",
    });
  }
}
