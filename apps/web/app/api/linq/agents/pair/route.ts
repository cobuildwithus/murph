import { createHostedLinqControlPlane } from "../../../../../src/lib/linq/control-plane";
import { jsonOk, readOptionalJsonObject } from "../../../../../src/lib/http";
import { withJsonError } from "../../../../../src/lib/linq/http";

export const POST = withJsonError(async (request: Request) => {
    const controlPlane = createHostedLinqControlPlane(request);
    const body = await readOptionalJsonObject(request);
    return jsonOk(await controlPlane.pairAgent(body));
});
