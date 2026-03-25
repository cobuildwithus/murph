import { createHostedLinqControlPlane } from "../../../../../src/lib/linq/control-plane";
import { jsonOk } from "../../../../../src/lib/http";
import { jsonError } from "../../../../../src/lib/linq/http";

export async function GET(request: Request) {
  try {
    const controlPlane = createHostedLinqControlPlane(request);
    return jsonOk(await controlPlane.listAgentEvents(new URL(request.url)));
  } catch (error) {
    return jsonError(error);
  }
}
