import { createComputerUseService } from "@/src/lib/computer-use/service";
import {
  jsonOk,
  readSignedComputerPauseForUserRequest,
  resolveDecodedRouteParam,
  withJsonError,
} from "@/src/lib/computer-use/http";
import { withHostedComputerToolFailureRuntimeLog } from "@/src/lib/computer-use/runtime-log";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ runId: string }> },
) => {
  const { body, memberId } = await readSignedComputerPauseForUserRequest(request);
  const runId = await resolveDecodedRouteParam(context.params, "runId");
  const service = createComputerUseService();
  const handoffPurpose = body.handoffPurpose === "screen_inspection"
    ? "manual_browser_help"
    : body.handoffPurpose;

  return jsonOk(await withHostedComputerToolFailureRuntimeLog({
    memberId,
    operation: "pause-for-user",
    run: () => service.pauseForUser({
      handoffPurpose,
      memberId,
      pauseDeliveryContext: body.pauseDeliveryContext,
      reason: body.reason,
      runId,
      suggestedReply: body.suggestedReply,
    }),
  }));
});
