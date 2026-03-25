import { createHostedLinqControlPlane } from "../../../../src/lib/linq/control-plane";
import { jsonOk } from "../../../../src/lib/http";
import { jsonError } from "../../../../src/lib/linq/http";

export async function GET(request: Request) {
  try {
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
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const controlPlane = createHostedLinqControlPlane(request);
    return jsonOk(await controlPlane.handleWebhook(), 202);
  } catch (error) {
    return jsonError(error);
  }
}
