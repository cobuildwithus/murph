import {
  parseHostedMailboxFetchRequest,
  parseHostedMailboxFetchResponse,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  fetchHostedMailboxItemsAfterLaneCursors,
  readHostedMailboxMaxSeqByLane,
} from "@/src/lib/hosted-mailbox/store";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = parseHostedMailboxFetchRequest(await readOptionalJsonObject(request));
  const [itemsResult, maxSeqByLane] = await Promise.all([
    fetchHostedMailboxItemsAfterLaneCursors({
      lanes: body.lanes.map((laneCursor) => ({
        afterSeq: laneCursor.importedSeq,
        lane: laneCursor.lane,
      })),
      limitPerLane: body.limitPerLane,
      userId,
    }),
    readHostedMailboxMaxSeqByLane({
      lanes: body.lanes.map((laneCursor) => laneCursor.lane),
      userId,
    }),
  ]);

  return jsonOk(parseHostedMailboxFetchResponse({
    fetchedAt: new Date().toISOString(),
    items: itemsResult.items,
    maxSeqByLane,
    userId,
  }));
});
