import { createHostedLinqControlPlane } from "../../../src/lib/linq/control-plane";
import { jsonOk, withJsonError } from "../../../src/lib/linq/http";

export const GET = withJsonError(async (request: Request) => {
    const controlPlane = createHostedLinqControlPlane(request);
    return jsonOk(controlPlane.info());
});
