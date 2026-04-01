import { createHostedLinqControlPlane } from "../../../../src/lib/linq/control-plane";
import { jsonOk } from "../../../../src/lib/http";
import { withJsonError } from "../../../../src/lib/linq/http";

export const GET = withJsonError(async (request: Request) => {
    const controlPlane = createHostedLinqControlPlane(request);
    const info = controlPlane.info();
    return jsonOk(
      {
        ok: true,
        webhookPath: info.routes.webhookPath,
        webhookUrl: info.routes.webhookUrl,
      },
      200,
    );
});

export const POST = withJsonError(async (request: Request) => {
    const controlPlane = createHostedLinqControlPlane(request);
    return jsonOk(await controlPlane.handleWebhook(), 202);
});
