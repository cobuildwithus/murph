import { createComputerUseService } from "@/src/lib/computer-use/service";
import {
  jsonOk,
  readSignedComputerFinishRunRequest,
  resolveDecodedRouteParam,
  withJsonError,
} from "@/src/lib/computer-use/http";
import { withHostedComputerToolFailureRuntimeLog } from "@/src/lib/computer-use/runtime-log";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ runId: string }> },
) => {
  const { body, memberId } = await readSignedComputerFinishRunRequest(request);
  const runId = await resolveDecodedRouteParam(context.params, "runId");
  const service = createComputerUseService();

  return jsonOk(await withHostedComputerToolFailureRuntimeLog({
    memberId,
    operation: "finish",
    run: () => service.finishRun({
      memberId,
      outcome: body.outcome,
      runId,
    }),
  }));
});
