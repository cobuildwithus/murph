import { createComputerUseService } from "@/src/lib/computer-use/service";
import {
  jsonOk,
  readSignedComputerObserveRequest,
  resolveDecodedRouteParam,
  withJsonError,
} from "@/src/lib/computer-use/http";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ runId: string }> },
) => {
  const { memberId } = await readSignedComputerObserveRequest(request);
  const runId = await resolveDecodedRouteParam(context.params, "runId");
  const service = createComputerUseService();

  return jsonOk(await service.observe({
    memberId,
    runId,
  }));
});
