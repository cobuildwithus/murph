import { NextResponse } from "next/server";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject, withJsonErrorHandling } from "@/src/lib/http";
import { jsonError, jsonOk } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import {
  HostedWakeFetchProofStaleError,
  recordHostedWakeTerminalTx,
} from "@/src/lib/hosted-wake/store";
import { HOSTED_WAKE_FETCH_PROOF_STALE_ERROR_CODE } from "@murphai/hosted-execution/contracts";

export const POST = withJsonErrorHandling(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = await readOptionalJsonObject(request);
  const fetchProof = parseRequiredString(body.fetchProof, "fetchProof");
  const state = parseTerminalState(body.state);
  const wakeId = parseRequiredString(body.wakeId, "wakeId");
  const wakeSeq = parseRequiredBigInt(body.wakeSeq, "wakeSeq");
  const recorded = await getPrisma().$transaction((tx) => {
    return recordHostedWakeTerminalTx({
      fetchProof,
      state,
      tx,
      userId,
      wakeId,
      wakeSeq,
    });
  });

  return jsonOk({
    recorded,
  });
}, (error) => {
  if (isHostedWakeTerminalStaleFetchFenceError(error)) {
    return NextResponse.json({
      error: {
        code: HOSTED_WAKE_FETCH_PROOF_STALE_ERROR_CODE,
        message: "Hosted wake fetch proof is stale.",
      },
    }, {
      headers: {
        "Cache-Control": "no-store",
      },
      status: 409,
    });
  }

  return jsonError(error);
});

function parseRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function parseRequiredBigInt(value: unknown, label: string): bigint {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a base-10 integer string.`);
  }

  try {
    return BigInt(value);
  } catch {
    throw new TypeError(`${label} must be a base-10 integer string.`);
  }
}

function parseTerminalState(value: unknown): "completed" | "quarantined" {
  if (value === "completed" || value === "quarantined") {
    return value;
  }

  throw new TypeError("state must be a hosted wake callback terminal state.");
}

function isHostedWakeTerminalStaleFetchFenceError(error: unknown): boolean {
  return error instanceof HostedWakeFetchProofStaleError;
}
