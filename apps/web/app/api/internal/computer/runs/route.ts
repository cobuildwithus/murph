import { createComputerUseService } from "@/src/lib/computer-use/service";
import {
  jsonOk,
  readSignedComputerOpenRunRequest,
  withJsonError,
} from "@/src/lib/computer-use/http";
import { withHostedComputerToolFailureRuntimeLog } from "@/src/lib/computer-use/runtime-log";

export const POST = withJsonError(async (request: Request) => {
  const { body, memberId } = await readSignedComputerOpenRunRequest(request);
  const service = createComputerUseService();

  return jsonOk(await withHostedComputerToolFailureRuntimeLog({
    memberId,
    operation: "open",
    run: () => service.openRun({
      memberId,
      resumeAfterMailboxItemId: body.resumeAfterMailboxItemId,
      resumeDeliveryContext: body.resumeDeliveryContext,
      runId: body.runId,
      startUrl: body.startUrl,
    }),
  }));
});
