import { createComputerUseService } from "@/src/lib/computer-use/service";
import {
  jsonOk,
  readSignedComputerActRequest,
  resolveDecodedRouteParam,
  withJsonError,
} from "@/src/lib/computer-use/http";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ runId: string }> },
) => {
  const { body, memberId } = await readSignedComputerActRequest(request);
  const runId = await resolveDecodedRouteParam(context.params, "runId");
  const service = createComputerUseService();

  return jsonOk(await service.act({
    ...body,
    memberId,
    runId,
  }));
});
