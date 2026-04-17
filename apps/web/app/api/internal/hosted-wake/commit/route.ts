import { Prisma } from "@prisma/client";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import {
  commitHostedExecutionCursorTx,
} from "@/src/lib/hosted-wake/store";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = await readOptionalJsonObject(request);
  const committedSeq = parseRequiredBigInt(body.committedSeq, "committedSeq");
  const expectedVersion = parseRequiredBigInt(body.expectedVersion, "expectedVersion");
  const snapshotRef = parseSnapshotRef(body, "snapshotRef");
  const response = await getPrisma().$transaction((tx) => {
    return commitHostedExecutionCursorTx({
      committedSeq,
      expectedVersion,
      snapshotRef,
      tx,
      userId,
    });
  });

  return jsonOk(response);
});

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

function parseSnapshotRef(
  body: Record<string, unknown>,
  key: string,
): Prisma.InputJsonValue | null | undefined {
  if (!(key in body)) {
    return undefined;
  }

  const value = body[key];

  if (value === null) {
    return null;
  }

  if (
    typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
    || Array.isArray(value)
    || isPlainJsonObject(value)
  ) {
    return value as Prisma.InputJsonValue;
  }

  throw new TypeError("snapshotRef must be valid JSON.");
}

function isPlainJsonObject(value: unknown): value is Record<string, Prisma.InputJsonValue> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
