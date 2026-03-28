import {
  readHostedSharePackByReference,
  requireHostedShareInternalToken,
} from "@/src/lib/hosted-share/service";
import { requireHostedExecutionInternalToken } from "@/src/lib/hosted-execution/internal";
import { getPrisma } from "@/src/lib/prisma";
import { jsonError, jsonOk } from "@/src/lib/hosted-onboarding/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ shareId: string }> },
) {
  try {
    authorizeHostedSharePayloadRequest(request);
    const { shareId } = await context.params;
    const url = new URL(request.url);
    const shareCode = url.searchParams.get("shareCode") ?? "";

    return jsonOk(await readHostedSharePackByReference({
      prisma: getPrisma(),
      shareCode,
      shareId,
    }));
  } catch (error) {
    return jsonError(error);
  }
}

function authorizeHostedSharePayloadRequest(request: Request): void {
  try {
    requireHostedShareInternalToken(request);
  } catch {
    requireHostedExecutionInternalToken(request);
  }
}
