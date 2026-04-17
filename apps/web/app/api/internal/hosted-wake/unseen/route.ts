import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";
import {
  listHostedWakesAfterSeq,
} from "@/src/lib/hosted-wake/store";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const DEFAULT_WAKE_BATCH_LIMIT = 64;
const MAX_WAKE_BATCH_LIMIT = 256;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = await readOptionalJsonObject(request);
  const afterSeq = parseOptionalBigInt(body.afterSeq, "afterSeq");
  const limit = parseOptionalLimit(body.limit);
  const response = await listHostedWakesAfterSeq({
    afterSeq,
    limit,
    prisma: getPrisma(),
    userId,
  });

  return jsonOk(response);
});

function parseOptionalBigInt(value: unknown, label: string): bigint | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a base-10 integer string.`);
  }

  try {
    return BigInt(value);
  } catch {
    throw new TypeError(`${label} must be a base-10 integer string.`);
  }
}

function parseOptionalLimit(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_WAKE_BATCH_LIMIT;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError("limit must be an integer.");
  }

  if (value < 1 || value > MAX_WAKE_BATCH_LIMIT) {
    throw new RangeError(`limit must be between 1 and ${MAX_WAKE_BATCH_LIMIT}.`);
  }

  return value;
}
