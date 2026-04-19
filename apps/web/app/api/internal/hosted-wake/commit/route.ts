import { Prisma } from "@prisma/client";
import { parseHostedWakeCommitRequest } from "@murphai/hosted-execution/parsers";

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
  const body = parseHostedWakeCommitRequest(await readOptionalJsonObject(request));
  const committedSeq = BigInt(body.committedSeq);
  const expectedVersion = BigInt(body.expectedVersion);
  const snapshotRef = parseSnapshotRef(body);
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

function parseSnapshotRef(
  body: ReturnType<typeof parseHostedWakeCommitRequest>,
): Prisma.InputJsonObject | null | undefined {
  if (!("snapshotRef" in body)) {
    return undefined;
  }

  const snapshotRef = body.snapshotRef;

  if (!snapshotRef) {
    return null;
  }

  return {
    hash: snapshotRef.hash,
    key: snapshotRef.key,
    size: snapshotRef.size,
    updatedAt: snapshotRef.updatedAt,
  };
}
