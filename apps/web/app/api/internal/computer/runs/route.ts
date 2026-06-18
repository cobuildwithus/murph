import { createComputerUseService } from "@/src/lib/computer-use/service";
import {
  jsonOk,
  readSignedComputerStartRunRequest,
  withJsonError,
} from "@/src/lib/computer-use/http";

export const POST = withJsonError(async (request: Request) => {
  const { body, memberId } = await readSignedComputerStartRunRequest(request);
  const service = createComputerUseService();

  return jsonOk(await service.startRun({
    memberId,
    profileKey: body.profileKey,
    resumeAfterMailboxItemId: body.resumeAfterMailboxItemId,
    resumeDeliveryContext: body.resumeDeliveryContext,
    resumeRunId: body.resumeRunId,
    startUrl: body.startUrl,
  }));
});
