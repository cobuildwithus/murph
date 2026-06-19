import { createComputerUseService } from "@/src/lib/computer-use/service";
import {
  jsonOk,
  readSignedComputerPauseForUserRequest,
  resolveDecodedRouteParam,
  withJsonError,
} from "@/src/lib/computer-use/http";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ runId: string }> },
) => {
  const { body, memberId } = await readSignedComputerPauseForUserRequest(request);
  const runId = await resolveDecodedRouteParam(context.params, "runId");
  const service = createComputerUseService();

  return jsonOk(await service.pauseForUser({
    handoffPurpose: body.handoffPurpose,
    memberId,
    message: body.message,
    pauseDeliveryContext: body.pauseDeliveryContext,
    reason: body.reason,
    runId,
    suggestedReply: body.suggestedReply,
  }));
});
