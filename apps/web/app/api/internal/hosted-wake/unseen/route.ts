import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";
import {
  listHostedExecutableWakes,
} from "@/src/lib/hosted-wake/store";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const DEFAULT_WAKE_BATCH_LIMIT = 64;
const MAX_WAKE_BATCH_LIMIT = 256;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = await readOptionalJsonObject(request);
  rejectUnsupportedAfterSeq(body);
  const limit = parseOptionalLimit(body.limit);
  const response = await listHostedExecutableWakes({
    limit,
    prisma: getPrisma(),
    userId,
  });

  return jsonOk(response);
});

function rejectUnsupportedAfterSeq(body: Record<string, unknown>): void {
  if (!Object.prototype.hasOwnProperty.call(body, "afterSeq")) {
    return;
  }

  throw new TypeError(
    "afterSeq is not supported for executable hosted wake fetches.",
  );
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
