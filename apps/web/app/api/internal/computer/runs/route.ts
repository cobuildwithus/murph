import { createComputerUseService } from "@/src/lib/computer-use/service";
import {
  jsonOk,
  readSignedComputerStartRunRequest,
  withJsonError,
} from "@/src/lib/computer-use/http";
import { withHostedComputerToolFailureRuntimeLog } from "@/src/lib/computer-use/runtime-log";

export const POST = withJsonError(async (request: Request) => {
  const { body, memberId } = await readSignedComputerStartRunRequest(request);
  const service = createComputerUseService();

  return jsonOk(await withHostedComputerToolFailureRuntimeLog({
    memberId,
    operation: "start-run",
    run: () => service.startRun({
      memberId,
      resumeAfterMailboxItemId: body.resumeAfterMailboxItemId,
      resumeDeliveryContext: body.resumeDeliveryContext,
      startUrl: body.startUrl,
    }),
  }));
});
