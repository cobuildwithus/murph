import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import {
  recordHostedWakeTerminalTx,
} from "@/src/lib/hosted-wake/store";

export const POST = withJsonError(async (request: Request) => {
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
